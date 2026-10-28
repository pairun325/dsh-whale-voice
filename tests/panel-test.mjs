/**
 * GUI 面板的 Host 路由冒烟测试：假 ctx + 假 req/res，不碰真实配置、不出声。
 * 用临时 DSH_HOME，避免把主人的 voice 设置改掉。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-voice-test-'));
process.env.DSH_HOME = tempHome;

const { apply } = await import('../lib/index.js');

const tools = new Map();
let route = null;

const ctx = {
  tools: {
    register(definition) {
      tools.set(definition.name, definition);
      return () => tools.delete(definition.name);
    },
  },
  webServer: {
    register(definition) {
      route = definition;
      return () => {
        route = null;
      };
    },
  },
  on() {
    return () => {};
  },
  logger: { warn: (message) => console.warn('[warn]', message), info: () => {} },
};

function makeReq(method, url, body) {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')];
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      for (const chunk of payload) yield chunk;
    },
  };
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(value) {
      this.body = value === undefined ? '' : String(value);
    },
    json() {
      return JSON.parse(this.body);
    },
  };
}

async function call(method, url, body) {
  const res = makeRes();
  await route.handler(makeReq(method, url, body), res);
  return res;
}

function check(label, condition, detail) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  ${detail}`}`);
  if (!condition) process.exitCode = 1;
}

const dispose = apply(ctx);

try {
  check('路由已注册', route !== null && route.path === '/whale-voice');

  const state = await call('GET', '/whale-voice/state');
  check('GET /state 200', state.statusCode === 200 && state.json().ok === true, state.body);
  check('默认开启', state.json().config.enabled === true);

  const patched = await call('POST', '/whale-voice/config', { rate: 3, volume: 55 });
  check('改语速/音量', patched.json().config.rate === 3 && patched.json().config.volume === 55, patched.body);
  check('写着盘上', JSON.parse(fs.readFileSync(path.join(tempHome, 'storages', 'whale-voice', 'config.json'), 'utf8')).rate === 3);

  const clamped = await call('POST', '/whale-voice/config', { rate: 99 });
  check('语速被夹紧', clamped.json().config.rate === 10);

  const empty = await call('POST', '/whale-voice/say', { text: '   ' });
  check('空台词 400', empty.statusCode === 400, empty.body);

  const voices = await call('GET', '/whale-voice/voices');
  check('音色列表 200', voices.statusCode === 200 && Array.isArray(voices.json().voices));
  console.log(`      ${voices.json().voices.length} 个音色`);

  const tool = await tools.get('voice_config').execute({ enabled: false }, {});
  const afterTool = await call('GET', '/whale-voice/state');
  check('工具和面板共用设置', tool.config.enabled === false && afterTool.json().config.enabled === false);

  const missing = await call('GET', '/whale-voice/nope');
  check('未知路径 404', missing.statusCode === 404);
} finally {
  dispose?.();
  fs.rmSync(tempHome, { recursive: true, force: true });
}
