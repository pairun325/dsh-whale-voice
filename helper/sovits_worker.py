#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""dsh-whale-voice 的大肥鱼音色工人（带语音缓存）。

常驻进程：加载一次 GPT-SoVITS，之后按行读 JSON 请求、合成、播放、回一行 JSON。
缓存：按“短句”存 wav（voicebank/），同一句再出现直接播，不重新合成；
      整句会拆成短句，能拼就拼，只合成缺失的那几段。
  {"id":1,"text":"要说的话"}
  -> {"id":1,"ok":true,"ms":4300,"duration":4.3,"synth":2,"cached":1}

路径可用环境变量覆盖；stdout 只走协议，其余输出丢弃。
"""

import hashlib
import json
import os
import re
import sys
import time
import uuid

ROOT = os.environ.get("SOVITS_ROOT", r"E:\dswork\voice\GPT-SoVITS")
REF_WAV = os.environ.get("SOVITS_REF", r"E:\dswork\voice\tts\ref.wav")
AUX_REFS = [p for p in os.environ.get("SOVITS_AUX", "").split(";") if p.strip()]
REF_TEXT_PATH = os.environ.get("SOVITS_REF_TEXT", r"E:\dswork\voice\tts\ref_text.txt")
CACHE = os.environ.get("SOVITS_CACHE", r"E:\dswork\voice\tts\cache")
BANK = os.environ.get("SOVITS_BANK", r"E:\dswork\voice\tts\voicebank")
BANK_INDEX = os.path.join(BANK, "index.json")
BANK_LIMIT = 600

os.environ.setdefault("MPLCONFIGDIR", r"E:\dswork\voice\tts\mplcache")
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "GPT_SoVITS"))
os.chdir(ROOT)

# 协议通道先抓住，其余输出直接丢掉，避免 tqdm / print 污染 JSON
protocol = sys.stdout
sys.stdout = open(os.devnull, "w", encoding="utf-8")

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
import torch  # noqa: E402

torch.set_num_threads(max(4, min(16, os.cpu_count() or 8)))
try:
    torch.set_num_interop_threads(4)
except Exception:
    pass

from GPT_SoVITS.TTS_infer_pack.TTS import TTS, TTS_Config  # noqa: E402

for path in (CACHE, BANK):
    os.makedirs(path, exist_ok=True)

ref_text = open(REF_TEXT_PATH, encoding="utf-8").read().strip()

# 参考音变了，缓存就该失效
signature = hashlib.sha1(
    ("|".join([REF_WAV] + AUX_REFS) + "|" + str(os.path.getmtime(REF_WAV)) + "|" + ref_text).encode("utf-8")
).hexdigest()[:10]


def load_index():
    try:
        with open(BANK_INDEX, encoding="utf-8") as handle:
            data = json.load(handle)
        if data.get("signature") == signature:
            return data.get("items", {})
    except Exception:
        pass
    return {}


def save_index(items):
    try:
        with open(BANK_INDEX, "w", encoding="utf-8") as handle:
            json.dump({"signature": signature, "items": items}, handle, ensure_ascii=False)
    except Exception:
        pass


index = load_index()


def normalize(text):
    return re.sub(r"\s+", "", text.strip())


def cache_key(text):
    return hashlib.sha1((signature + "|" + normalize(text)).encode("utf-8")).hexdigest()[:20]


def split_clauses(text):
    parts = re.split(r"(?<=[，。！？；：、,.!?;:])", text)
    clauses = [p.strip() for p in parts if p and p.strip()]
    if not clauses:
        return [text]
    return clauses


config = TTS_Config("GPT_SoVITS/configs/tts_infer.yaml")
config.device = "cpu"
config.is_half = False
tts = TTS(config)

protocol.write(json.dumps({"ready": True}) + "\n")
protocol.flush()


def synthesize(text, speed):
    inputs = {
        "text": text,
        "text_lang": "zh",
        "ref_audio_path": REF_WAV,
        "aux_ref_audio_paths": AUX_REFS,
        "prompt_text": ref_text,
        "prompt_lang": "zh",
        "top_k": 15,
        "top_p": 1.0,
        "temperature": 1.0,
        "text_split_method": "cut5",
        "speed_factor": float(speed),
        "return_fragment": False,
        "parallel_infer": False,
    }
    final = None
    for sample_rate, audio in tts.run(inputs):
        final = (sample_rate, audio)
    return final


def prune_bank():
    if len(index) <= BANK_LIMIT:
        return
    ordered = sorted(index.items(), key=lambda kv: kv[1].get("at", 0))
    for key, entry in ordered[: max(0, len(ordered) - BANK_LIMIT)]:
        path = os.path.join(BANK, entry["file"])
        try:
            os.remove(path)
        except OSError:
            pass
        index.pop(key, None)


def get_segment(text, speed):
    """返回 (sr, audio, 是否命中缓存)。"""
    key = cache_key(text)
    entry = index.get(key)
    if entry is not None:
        path = os.path.join(BANK, entry["file"])
        if os.path.exists(path):
            audio, sr = sf.read(path, dtype="float32")
            return sr, audio, True
    sr, audio = synthesize(text, speed)
    file_name = f"{key}.wav"
    path = os.path.join(BANK, file_name)
    sf.write(path, audio, sr)
    index[key] = {"file": file_name, "at": time.time(), "text": text}
    return sr, audio, False


def main():
    for line in sys.stdin.buffer:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line.decode("utf-8"))
        except Exception:
            continue
        request_id = request.get("id")
        text = str(request.get("text", "")).strip()
        if not text:
            continue
        speed = float(request.get("speed", 1.0))
        started = time.time()
        try:
            clauses = split_clauses(text)
            segments = []
            synth_count = 0
            cached_count = 0
            sample_rate = 32000
            for clause in clauses:
                sr, audio, hit = get_segment(clause, speed)
                sample_rate = sr
                segments.append(audio)
                if hit:
                    cached_count += 1
                else:
                    synth_count += 1
            if len(segments) == 1:
                merged = segments[0]
            else:
                gap = np.zeros(int(sample_rate * 0.12), dtype=np.float32)
                chunks = []
                for audio in segments:
                    chunks.append(audio)
                    chunks.append(gap)
                merged = np.concatenate(chunks[:-1])
            out = os.path.join(CACHE, f"{uuid.uuid4().hex}.wav")
            sf.write(out, merged, sample_rate)
            import winsound

            winsound.PlaySound(out, winsound.SND_FILENAME)
            try:
                os.remove(out)
            except OSError:
                pass
            prune_bank()
            save_index(index)
            protocol.write(
                json.dumps(
                    {
                        "id": request_id,
                        "ok": True,
                        "ms": int((time.time() - started) * 1000),
                        "duration": round(len(merged) / sample_rate, 2),
                        "synth": synth_count,
                        "cached": cached_count,
                    }
                )
                + "\n"
            )
            protocol.flush()
        except Exception as exc:
            protocol.write(json.dumps({"id": request_id, "ok": False, "error": f"{type(exc).__name__}: {exc}"}) + "\n")
            protocol.flush()


if __name__ == "__main__":
    main()
