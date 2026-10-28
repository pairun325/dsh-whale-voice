/**
 * `dsh-whale-voice` — Host half.
 *
 * 把鲸鱼娘说的话变成两样东西：
 *  1. 屏幕底部的字幕投影（常驻 Python/Tk 窗口，无边框、置顶、穿透、不抢焦点）；
 *  2. 声音（常驻 PowerShell + System.Speech，默认 Microsoft Huihui）。
 *
 * 文本来源：`session/event` 里的 `assistant/message`，只念纯文本回复，
 * 带 tool-call 的中间步骤默认跳过。也可以用 `voice_say` 手动让她说一句。
 *
 * @module dsh-whale-voice
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HELPER_DIR = path.join(PACKAGE_ROOT, 'helper');
const PROJECTOR = path.join(HELPER_DIR, 'projector.py');
const SPEAKER = path.join(HELPER_DIR, 'speak.ps1');
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const STORAGE = path.join(DSH_HOME, 'storages', 'whale-voice');
const CONFIG_PATH = path.join(STORAGE, 'config.json');
const ROUTE_PREFIX = '/whale-voice';
const DEFAULT_VOICE = 'Microsoft Huihui Desktop';

const DEFAULTS = {
  enabled: true,
  speak: true,
  subtitle: true,
  speakToolNarration: false,
  engine: 'winrt',
  voice: DEFAULT_VOICE,
  rate: 0,
  volume: 100,
  fontSize: 30,
  width: 1180,
  bottom: 120,
  alpha: 0.9,
  ttl: 9000,
  maxSpeechChars: 500,
  sovitsPython: 'E:\\dswork\\voice\\venv\\Scripts\\python.exe',
  sovitsRoot: 'E:\\dswork\\voice\\GPT-SoVITS',
  sovitsRef: 'E:\\dswork\\voice\\tts\\ref.wav',
  sovitsAux: 'E:\\dswork\\voice\\tts\\aux1.wav;E:\\dswork\\voice\\tts\\aux2.wav',
  sovitsRefText: 'E:\\dswork\\voice\\tts\\ref_text.txt',
  sovitsMaxChars: 120,
  sovitsSpeed: 1.0,
};

function findPython() {
  const candidates = [];
  if (process.env.TENTACLE_PYTHON) candidates.push(process.env.TENTACLE_PYTHON);
  const runtimes = path.join(DSH_HOME, 'dsh-runtimes');
  try {
    for (const name of fs.readdirSync(runtimes).sort().reverse()) {
      candidates.push(path.join(runtimes, name, 'dependencies', 'python', 'python.exe'));
    }
  } catch {
    /* 没有运行时目录就退回 PATH */
  }
  candidates.push('python.exe', 'python3', 'python');
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) return candidate;
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'python';
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const value = JSON.parse(raw);
    if (value !== null && typeof value === 'object') return { ...DEFAULTS, ...value };
  } catch {
    /* 首次运行 */
  }
  return { ...DEFAULTS };
}

function saveConfig(config) {
  try {
    fs.mkdirSync(STORAGE, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  } catch {
    /* 写不进去也不影响说话 */
  }
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readJsonBody(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (parsed === null || typeof parsed !== 'object') throw new Error('body must be an object');
  return parsed;
}

/** 列出系统 SAPI 音色（面板的下拉框用），结果缓存 10 分钟。 */
let voiceCache = { at: 0, list: [] };
function listVoices() {
  if (Date.now() - voiceCache.at < 600000 && voiceCache.list.length > 0) {
    return Promise.resolve(voiceCache.list);
  }
  return new Promise((resolve) => {
    let out = '';
    try {
      const proc = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          'Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }',
        ],
        { windowsHide: true },
      );
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk) => {
        out += chunk;
      });
      proc.on('exit', () => {
        const list = out
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line !== '');
        voiceCache = { at: Date.now(), list };
        resolve(list);
      });
    } catch {
      resolve([]);
    }
  });
}

/** Markdown → 适合朗读/字幕的纯文本。 */
function cleanText(markdown) {
  let text = String(markdown ?? '');
  text = text.replace(/```[\s\S]*?```/g, ' ');
  text = text.replace(/`([^`]*)`/g, '$1');
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  text = text.replace(/https?:\/\/\S+/g, ' ');
  text = text.replace(/^#{1,6}\s*/gm, '');
  text = text.replace(/^\s*[-+*]\s+/gm, '');
  text = text.replace(/[*_~>|]/g, ' ');
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\s*\n\s*/g, ' ');
  return text.trim();
}

/** 按句子边界截断，避免半句话说完。 */
function truncateAtSentence(text, limit) {
  if (text.length <= limit) return text;
  const head = text.slice(0, limit);
  const cut = Math.max(head.lastIndexOf('。'), head.lastIndexOf('！'), head.lastIndexOf('？'), head.lastIndexOf('，'));
  return (cut > limit * 0.6 ? head.slice(0, cut + 1) : head) + '……';
}

export const name = 'dsh-whale-voice';
export const inject = ['tools', 'webServer', 'connection'];

export function apply(ctx) {
  const config = loadConfig();
  const disposers = [];

  /** 字幕投影进程 */
  let projectorProc = null;
  let projectorReady = false;
  let lastProjectorError = '';

  /** 语音进程 */
  let speakerProc = null;
  let speakerSignature = '';
  let speakerQueue = 0;
  let lastSpeakerError = '';

  function ensureProjector() {
    if (projectorProc !== null && projectorProc.exitCode === null) return projectorProc;
    try {
      projectorProc = spawn(findPython(), [PROJECTOR], {
        cwd: PACKAGE_ROOT,
        stdio: ['pipe', 'ignore', 'pipe'],
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
      });
    } catch (error) {
      lastProjectorError = String(error?.message ?? error);
      return null;
    }
    projectorReady = true;
    projectorProc.stderr?.on('data', (chunk) => {
      lastProjectorError = chunk.toString('utf8').trim().slice(0, 400);
    });
    projectorProc.on('exit', () => {
      projectorProc = null;
    });
    sendProjector({ op: 'config', settings: projectorSettings() });
    return projectorProc;
  }

  function projectorSettings() {
    return {
      fontSize: config.fontSize,
      width: config.width,
      bottom: config.bottom,
      alpha: config.alpha,
      ttl: config.ttl,
    };
  }

  function sendProjector(payload) {
    const proc = projectorProc;
    if (proc === null || proc.exitCode !== null) return false;
    try {
      proc.stdin.write(`${JSON.stringify(payload)}\n`);
      return true;
    } catch {
      return false;
    }
  }

  function showSubtitle(text, force = false) {
    if (!config.enabled && !force) return;
    if (!config.subtitle && !force) return;
    if (!ensureProjector()) return;
    const ttl = Math.max(4000, Math.min(30000, text.length * 170));
    if (!sendProjector({ op: 'show', text, ttl })) {
      // 进程可能刚崩，重来一次
      projectorProc = null;
      if (ensureProjector()) sendProjector({ op: 'show', text, ttl });
    }
  }

  function ensureSpeaker() {
    const signature = `${config.voice}|${config.rate}|${config.volume}`;
    if (speakerProc !== null && speakerProc.exitCode === null && speakerSignature === signature) {
      return speakerProc;
    }
    if (speakerProc !== null) {
      try {
        speakerProc.stdin.end();
        speakerProc.kill();
      } catch {
        /* ignore */
      }
      speakerProc = null;
    }
    try {
      speakerProc = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          SPEAKER,
          '-Voice',
          config.voice,
          '-Rate',
          String(config.rate),
          '-Volume',
          String(config.volume),
        ],
        { cwd: PACKAGE_ROOT, stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true },
      );
    } catch (error) {
      lastSpeakerError = String(error?.message ?? error);
      return null;
    }
    speakerSignature = signature;
    speakerProc.stderr?.on('data', (chunk) => {
      lastSpeakerError = chunk.toString('utf8').trim().slice(0, 400);
    });
    speakerProc.on('exit', () => {
      speakerProc = null;
      speakerQueue = 0;
    });
    return speakerProc;
  }

  /** 大肥鱼音色工人：GPT-SoVITS 常驻进程，合成完自己播放。 */
  let sovitsProc = null;
  let sovitsReady = false;
  let sovitsLastError = '';
  let sovitsQueue = 0;
  let sovitsSeq = 1;
  let sovitsBuffer = '';
  let sovitsStats = null;

  function ensureSovits() {
    if (sovitsProc !== null && sovitsProc.exitCode === null) return sovitsProc;
    try {
      sovitsProc = spawn(config.sovitsPython, [path.join(HELPER_DIR, 'sovits_worker.py')], {
        cwd: config.sovitsRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: {
          ...process.env,
          SOVITS_ROOT: config.sovitsRoot,
          SOVITS_REF: config.sovitsRef,
          SOVITS_AUX: config.sovitsAux,
          SOVITS_REF_TEXT: config.sovitsRefText,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUNBUFFERED: '1',
        },
      });
    } catch (error) {
      sovitsLastError = String(error?.message ?? error);
      return null;
    }
    sovitsReady = false;
    sovitsBuffer = '';
    sovitsProc.stdout.setEncoding('utf8');
    sovitsProc.stdout.on('data', (chunk) => {
      sovitsBuffer += chunk;
      let index;
      while ((index = sovitsBuffer.indexOf('\n')) >= 0) {
        const line = sovitsBuffer.slice(0, index).trim();
        sovitsBuffer = sovitsBuffer.slice(index + 1);
        if (line === '') continue;
        try {
          const message = JSON.parse(line);
          if (message.ready === true) {
            sovitsReady = true;
            continue;
          }
          if (message.ok === false) sovitsLastError = String(message.error ?? '合成失败');
          else if (message.ok === true) {
            sovitsStats = { ms: message.ms, duration: message.duration, synth: message.synth, cached: message.cached };
          }
          sovitsQueue = Math.max(0, sovitsQueue - 1);
        } catch {
          /* 非协议输出忽略 */
        }
      }
    });
    sovitsProc.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8').trim();
      // tqdm 进度条也会走 stderr，别把进度当成报错
      if (text !== '' && /(Error|Traceback|Exception|失败)/.test(text)) {
        sovitsLastError = text.slice(-400);
      }
    });
    sovitsProc.on('exit', () => {
      sovitsProc = null;
      sovitsReady = false;
      sovitsQueue = 0;
    });
    return sovitsProc;
  }

  function stopSovits() {
    if (sovitsProc === null) return;
    try {
      sovitsProc.stdin.end();
      sovitsProc.kill();
    } catch {
      /* ignore */
    }
    sovitsProc = null;
    sovitsReady = false;
    sovitsQueue = 0;
  }

  function speakSovits(text) {
    const speech = truncateAtSentence(text, Math.min(config.sovitsMaxChars, config.maxSpeechChars));
    if (speech === '') return;
    const proc = ensureSovits();
    if (proc === null) return;
    try {
      proc.stdin.write(`${JSON.stringify({ id: sovitsSeq++, text: speech, speed: config.sovitsSpeed })}\n`);
      sovitsQueue += 1;
      const timer = setTimeout(() => {
        sovitsQueue = Math.max(0, sovitsQueue - 1);
      }, 90000);
      if (typeof timer.unref === 'function') timer.unref();
    } catch (error) {
      sovitsLastError = String(error?.message ?? error);
    }
  }

  function speak(text, force = false) {
    if (!config.enabled && !force) return;
    if (!config.speak && !force) return;
    if (config.engine === 'sovits') {
      speakSovits(text);
      return;
    }
    const speech = truncateAtSentence(text, config.maxSpeechChars);
    if (speech === '') return;
    const proc = ensureSpeaker();
    if (proc === null) return;
    try {
      proc.stdin.write(`${speech}\n`);
      speakerQueue += 1;
      const timer = setTimeout(() => {
        speakerQueue = Math.max(0, speakerQueue - 1);
      }, 1200 + speech.length * 220);
      if (typeof timer.unref === 'function') timer.unref();
    } catch {
      speakerQueue = Math.max(0, speakerQueue - 1);
    }
  }

  /** 外部可见的统一出口：显示 + 朗读。 */
  function say(text, options = {}) {
    const cleaned = cleanText(text);
    if (cleaned === '') return { shown: false, spoken: false, text: '' };
    showSubtitle(cleaned, options.subtitle === true);
    speak(cleaned, options.speak === true);
    return {
      shown: cleaned !== '' && (options.subtitle === true || (config.enabled && config.subtitle)),
      spoken: options.speak === true || (config.enabled && config.speak),
      text: cleaned,
    };
  }

  /** 统一的设置入口：工具和 GUI 面板都走这里。 */
  function applyPatches(raw) {
    const booleans = ['enabled', 'speak', 'subtitle', 'speakToolNarration'];
    const numbers = [
      ['rate', -10, 10],
      ['volume', 0, 100],
      ['fontSize', 12, 72],
      ['width', 320, 2400],
      ['bottom', 0, 600],
      ['alpha', 0.2, 1],
      ['ttl', 2000, 60000],
      ['maxSpeechChars', 40, 2000],
      ['sovitsMaxChars', 20, 400],
      ['sovitsSpeed', 0.6, 1.6],
    ];
    for (const key of booleans) {
      if (typeof raw[key] === 'boolean') config[key] = raw[key];
    }
    for (const [key, min, max] of numbers) {
      const value = Number(raw[key]);
      if (Number.isFinite(value)) config[key] = Math.min(max, Math.max(min, value));
    }
    if (typeof raw.voice === 'string' && raw.voice.trim() !== '') config.voice = raw.voice.trim();
    if (typeof raw.sovitsAux === 'string') config.sovitsAux = raw.sovitsAux.trim();
    if (typeof raw.sovitsRef === 'string' && raw.sovitsRef.trim() !== '') config.sovitsRef = raw.sovitsRef.trim();
    if (raw.engine === 'sovits' || raw.engine === 'winrt') {
      const changed = config.engine !== raw.engine;
      config.engine = raw.engine;
      if (changed && raw.engine === 'winrt') stopSovits();
    }

    saveConfig(config);
    if (projectorProc !== null) sendProjector({ op: 'config', settings: projectorSettings() });
    if (speakerProc !== null) ensureSpeaker(); // voice/rate 变了就重启
    return { ...config };
  }

  function stateSnapshot() {
    return {
      config: { ...config },
      engine: config.engine,
      projector: projectorProc !== null && projectorProc.exitCode === null ? 'running' : 'stopped',
      speaker: speakerProc !== null && speakerProc.exitCode === null ? 'running' : 'stopped',
      sovits: sovitsProc !== null && sovitsProc.exitCode === null ? 'running' : 'stopped',
      sovitsReady,
      sovitsStats,
      queue: speakerQueue + sovitsQueue,
      lastProjectorError,
      lastSpeakerError: sovitsLastError || lastSpeakerError,
    };
  }

  // --- 自动朗读 assistant/message ---------------------------------------
  let lastText = '';
  let lastAt = 0;
  const seenMessages = new Map();

  function alreadySaid(key) {
    const at = seenMessages.get(key);
    if (at !== undefined && Date.now() - at < 15000) return true;
    seenMessages.set(key, Date.now());
    if (seenMessages.size > 300) {
      const cutoff = Date.now() - 60000;
      for (const [oldKey, at] of seenMessages) {
        if (at < cutoff) seenMessages.delete(oldKey);
      }
    }
    return false;
  }

  function onSessionEvent(_session, event) {
    if (!config.enabled) return;
    if (event?.type !== 'assistant/message') return;
    const message = event.data?.message;
    if (message === null || typeof message !== 'object') return;
    const content = Array.isArray(message.content) ? message.content : [];
    const hasToolCall = content.some((block) => block?.type === 'tool-call');
    if (hasToolCall && !config.speakToolNarration) return;
    const text = content
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n');
    const cleaned = cleanText(text);
    if (cleaned.length < 2) return;

    const now = Date.now();
    if (cleaned === lastText && now - lastAt < 4000) return;
    lastText = cleaned;
    lastAt = now;

    if (alreadySaid(`${cleaned.length}:${cleaned.slice(0, 60)}`)) return;

    say(cleaned);
  }

  if (typeof ctx.on === 'function') {
    ctx.on('session/event', onSessionEvent);
  } else {
    ctx.logger?.warn?.('dsh-whale-voice: ctx.on 不可用，自动朗读不会触发');
  }

  // --- 工具 -------------------------------------------------------------
  disposers.push(
    ctx.tools.register({
      name: 'voice_say',
      description:
        'Make the whale girl actually speak and project a desktop subtitle. Text goes through markdown cleanup, is shown in the always-on-top subtitle window and spoken with the configured system voice. Use it sparingly — normal replies are already spoken automatically.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['text'],
        properties: {
          text: { type: 'string', description: 'What to say. Plain text; markdown is stripped.' },
          subtitle: { type: 'boolean', description: 'Force-show the subtitle even if subtitles are off.' },
          speak: { type: 'boolean', description: 'Force speaking even if speech is muted.' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok'],
          properties: { ok: { type: 'boolean' }, text: { type: 'string' } },
        },
        render: (_args, value) => [{ type: 'text', text: `说出口了：${String(value?.text ?? '').slice(0, 80)}` }],
      },
      async execute(args) {
        const raw = args ?? {};
        const text = cleanText(String(raw.text ?? ''));
        if (text === '') throw new Error('voice_say: text 不能为空');
        const result = say(text, { subtitle: raw.subtitle === true, speak: raw.speak === true });
        return { ok: true, text: result.text };
      },
      presentCall() {
        return { card: 'generic', title: 'voice_say', kind: 'write' };
      },
    }),
  );

  disposers.push(
    ctx.tools.register({
      name: 'voice_config',
      description:
        'Read or change the voice/subtitle settings: enabled, speak, subtitle, voice name, rate (-10..10), volume (0..100), fontSize, width, bottom, alpha, ttl, maxSpeechChars. Omitted fields stay unchanged.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          enabled: { type: 'boolean', description: 'Master switch for voice + subtitle.' },
          speak: { type: 'boolean' },
          subtitle: { type: 'boolean' },
          speakToolNarration: { type: 'boolean', description: 'Also speak assistant messages that contain tool calls.' },
          voice: { type: 'string', description: 'A system SAPI voice name, e.g. "Microsoft Huihui Desktop".' },
          engine: { type: 'string', enum: ['winrt', 'sovits'], description: 'winrt = system voice; sovits = the local GPT-SoVITS 大肥鱼 voice.' },
          sovitsMaxChars: { type: 'number' },
          sovitsSpeed: { type: 'number' },
          sovitsAux: { type: 'string', description: 'Semicolon-separated auxiliary reference wav paths for tone fusion.' },
          sovitsRef: { type: 'string', description: 'Primary reference wav path.' },
          rate: { type: 'number' },
          volume: { type: 'number' },
          fontSize: { type: 'number' },
          width: { type: 'number' },
          bottom: { type: 'number' },
          alpha: { type: 'number' },
          ttl: { type: 'number' },
          maxSpeechChars: { type: 'number' },
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true, required: ['ok'], properties: { ok: { type: 'boolean' } } },
        render: (_args, value) => [
          {
            type: 'text',
            text: `声音 ${value?.config?.enabled !== false ? '开' : '关'}（说话 ${value?.config?.speak ? '开' : '关'}，字幕 ${value?.config?.subtitle ? '开' : '关'}），引擎 ${value?.config?.engine === 'sovits' ? '大肥鱼（本地 GPT-SoVITS）' : `系统音色 ${String(value?.config?.voice ?? '')}`}，语速 ${value?.config?.rate ?? 0}，音量 ${value?.config?.volume ?? 100}`,
          },
        ],
      },
      async execute(args) {
        return { ok: true, config: applyPatches(args ?? {}) };
      },
      presentCall() {
        return { card: 'generic', title: 'voice_config', kind: 'write' };
      },
    }),
  );

  disposers.push(
    ctx.tools.register({
      name: 'voice_state',
      description:
        'Report the voice/subtitle plugin state: config, whether the projector/TTS processes are alive, pending speech queue and the last error.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        schema: { type: 'object', additionalProperties: true, required: ['ok'], properties: { ok: { type: 'boolean' } } },
        render: (_args, value) => [
          {
            type: 'text',
            text: `字幕框 ${value?.projector === 'running' ? '在线' : '未启动'}，引擎 ${value?.engine === 'sovits' ? `大肥鱼（${value?.sovits === 'running' ? (value?.sovitsReady ? '就绪' : '加载中') : '未启动'}）` : `系统音色（${value?.speaker === 'running' ? '在线' : '未启动'}）`}，待说 ${value?.queue ?? 0} 句${value?.sovitsStats ? `；上一句 ${(value.sovitsStats.ms / 1000).toFixed(1)}s（合成 ${value.sovitsStats.synth} 段、命中缓存 ${value.sovitsStats.cached} 段）` : ''}${value?.lastSpeakerError ? `；报错：${value.lastSpeakerError}` : ''}`,
          },
        ],
      },
      async execute() {
        return { ok: true, ...stateSnapshot() };
      },
      presentCall() {
        return { card: 'generic', title: 'voice_state', kind: 'read' };
      },
    }),
  );

  // --- HTTP 路由（GUI 开关面板用） -------------------------------------
  if (ctx.webServer !== undefined && ctx.webServer !== null) {
    disposers.push(
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: async (req, res) => {
          const connection = ctx.connection;
          if (connection !== undefined && connection !== null && typeof connection.requestRejection === 'function') {
            const rejection = connection.requestRejection(req);
            if (rejection !== undefined) {
              res.statusCode = rejection;
              res.end();
              return;
            }
          }

          const url = new URL(String(req.url ?? '/'), 'http://localhost');
          const pathname = url.pathname;

          try {
            if (pathname === `${ROUTE_PREFIX}/state` && req.method === 'GET') {
              sendJson(res, 200, { ok: true, ...stateSnapshot() });
              return;
            }
            if (pathname === `${ROUTE_PREFIX}/voices` && req.method === 'GET') {
              sendJson(res, 200, { ok: true, voices: await listVoices() });
              return;
            }
            if (pathname === `${ROUTE_PREFIX}/config` && req.method === 'POST') {
              const body = await readJsonBody(req);
              sendJson(res, 200, { ok: true, ...stateSnapshot(), config: applyPatches(body) });
              return;
            }
            if (pathname === `${ROUTE_PREFIX}/say` && req.method === 'POST') {
              const body = await readJsonBody(req);
              const text = cleanText(String(body.text ?? ''));
              if (text === '') {
                sendJson(res, 400, { ok: false, message: 'text 不能为空' });
                return;
              }
              say(text, { subtitle: body.subtitle === true, speak: body.speak === true });
              sendJson(res, 200, { ok: true, text });
              return;
            }
            sendJson(res, 404, { ok: false, message: `no route for ${pathname}` });
          } catch (error) {
            sendJson(res, 500, { ok: false, message: String(error?.message ?? error) });
          }
        },
      }),
    );
  } else {
    ctx.logger?.warn?.('dsh-whale-voice: ctx.webServer 不可用，GUI 面板拉不到设置');
  }

  return () => {
    try {
      sendProjector({ op: 'quit' });
      projectorProc?.stdin.end();
      projectorProc?.kill();
    } catch {
      /* ignore */
    }
    try {
      speakerProc?.stdin.end();
      speakerProc?.kill();
    } catch {
      /* ignore */
    }
    stopSovits();
    for (const dispose of disposers.reverse()) {
      try {
        dispose?.();
      } catch {
        /* ignore */
      }
    }
  };
}
