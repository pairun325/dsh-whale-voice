# dsh-whale-voice

给 DSH 里的鲸鱼娘一张嘴。

- **字幕投影**：屏幕底部浮一条无边框、置顶、鼠标穿透的字幕窗，她说什么就显示什么；不抢焦点，不挡你点东西。
- **声音**：用 Windows 自带语音（默认 `Microsoft Huihui Desktop`）把回复念出来，只用系统 SAPI，不联网。
- **来源**：自动朗读 `assistant/message`；带 tool-call 的中间步骤默认跳过，不念代码块、链接、markdown 符号。
- **开关**：右下角「鲸鱼之声」面板（总开关、朗读、字幕、引擎、音色、语速音量、字幕样式、试听），或者让 AI 调 `voice_config`，两边共用同一份设置。

只支持 Windows（Tk 置顶窗 + SAPI）。

## 工具

| 工具 | 作用 |
| --- | --- |
| `voice_say(text)` | 让她现在说一句（可选强制出字幕/发声） |
| `voice_config({...})` | 改设置：enabled / speak / subtitle / speakToolNarration / voice / rate / volume / fontSize / width / bottom / alpha / ttl / maxSpeechChars |
| `voice_state()` | 查看配置、字幕框和语音进程是否在线、待说几句、最近报错 |

配置存在 `$DSH_HOME/storages/whale-voice/config.json`。

## 组成

| 文件 | 作用 |
| --- | --- |
| `lib/index.js` | 订阅 `session/event`，清洗文本，转发给字幕窗和 TTS；注册三个工具和 `/whale-voice` 路由 |
| `lib/client.js` | 浏览器里的「鲸鱼之声」面板，走 `/whale-voice/config` 读写设置 |
| `helper/projector.py` | 常驻 Tk 窗口：无边框、置顶、`WS_EX_TRANSPARENT` 穿透、`WS_EX_NOACTIVATE` 不抢焦点，`MoveWindow` 移进移出 |
| `helper/speak.ps1` | 常驻 PowerShell + System.Speech，逐行念，读完一句再读下一句 |
| `helper/sovits_worker.py` | 大肥鱼音色（GPT-SoVITS）常驻合成工人，合成完自己播 |

## 安装

桌面版没有 `dsh` 命令行（`E:\ds` 下只有 exe），所以桌面版走这两条路：

**A. 应用内装（推荐）**：设置 → 插件市场，搜 `dsh-whale-voice`，点安装，重启应用。

**B. 手动改 profile**：编辑 `%USERPROFILE%\.dsh\profiles\desktop\package.json`

```jsonc
{
  "dependencies": { "dsh-whale-voice": "link:E:/dswork/plugins/dsh-whale-voice" },
  "dsh": { "profile": { "bundles": [ /* ……原样保留……, */ "dsh-whale-voice" ] } }
}
```

然后在 `%USERPROFILE%\.dsh\profiles\desktop` 里跑一次 `pnpm install`（用 DSH 自带的 pnpm：`E:\ds\resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs`），再重启 DeepSeek Harness。

命令行版（`dsh web`）才可以：`dsh plugin --profile web add github:pairun325/dsh-whale-voice`。

## 说明

- 字幕窗只在你说话时出现，默认停留 `文字长度 × 170ms`，最长 30 秒。
- 语速 `rate` 是 SAPI 的 -10~10；中文默认 0 就够。
- 声音是系统语音，音色取决于你机器上装了什么。用 `voice_config({voice:"Microsoft Zira Desktop"})` 可以换英文音色。
- 关掉整段功能：`voice_config({enabled:false})`。

## 限制

- 只支持 Windows。
- SAPI 的中文音色机械感比较重；想要更自然的声音，得接在线 TTS（未做）。
- 自动朗读的是模型回复，不朗读用户消息、工具输出和思考过程。
