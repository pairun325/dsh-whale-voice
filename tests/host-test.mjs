/**
 * Host 半冒烟测试：假 ctx + 假 session/event，验证字幕与语音链路会动起来。
 * 运行后 6 秒内屏幕上应该出现字幕、音箱里应该有一句话。
 */

import fs from 'node:fs';
import path from 'node:path';
import { apply } from '../lib/index.js';

const tools = new Map();
let sessionHandler = null;

const ctx = {
  tools: {
    register(definition) {
      tools.set(definition.name, definition);
      return () => tools.delete(definition.name);
    },
  },
  on(event, handler) {
    if (event === 'session/event') sessionHandler = handler;
    return () => {
      sessionHandler = null;
    };
  },
  logger: { warn: (message) => console.warn('[warn]', message), info: () => {} },
};

function check(label, condition, detail) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  ${detail}`}`);
  if (!condition) process.exitCode = 1;
}

const dispose = apply(ctx);

try {
  check('三个工具注册', ['voice_say', 'voice_config', 'voice_state'].every((n) => tools.has(n)));
  check('session/event 已订阅', typeof sessionHandler === 'function');

  // 模拟一条带台词、带 markdown 的助手回复
  sessionHandler({ id: 'test-session' }, {
    type: 'assistant/message',
    data: {
      message: {
        content: [
          {
            type: 'text',
            text: '## 测试标题\n这句话应该出现在屏幕底部，也应该被念出来。\n\n```js\nconsole.log("这行不该被念")\n```\n[链接](https://example.com) 和 **加粗**。',
          },
        ],
      },
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 1500));

  const state = await tools.get('voice_state').execute({}, {});
  check('字幕进程已启动', state.projector === 'running', JSON.stringify({ projector: state.projector, error: state.lastProjectorError }));
  check('语音进程已启动', state.speaker === 'running', JSON.stringify({ speaker: state.speaker, queue: state.queue }));

  const said = await tools.get('voice_say').execute({ text: '手动说一句：鲸鱼娘上线。' }, {});
  check('voice_say 返回文本', said.ok === true && said.text.includes('手动说一句'), said.text);

  const config = await tools.get('voice_config').execute({ rate: 1, volume: 80 }, {});
  check('voice_config 改语速', config.config.rate === 1 && config.config.volume === 80);

  const disabled = await tools.get('voice_config').execute({ enabled: false }, {});
  check('可以关掉总开关', disabled.config.enabled === false);

  await new Promise((resolve) => setTimeout(resolve, 800));
  console.log('done（窗口里应该能看到字幕）');
} finally {
  await new Promise((resolve) => setTimeout(resolve, 3500));
  dispose?.();
}
