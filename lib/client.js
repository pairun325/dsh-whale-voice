/**
 * `dsh-whale-voice` — browser half.
 *
 * 右下角浮一个「鲸鱼之声」面板：总开关、朗读、字幕、引擎、音色、语速/音量、
 * 字幕样式，再加一个试听框。全部走 Host 的 /whale-voice 路由，和 voice_config
 * 工具共用同一份设置。不走 React，直接挂 DOM。
 */
window.__ModuleLoader__.load({
  id: 'dsh-whale-voice',
  factory: () => {
    const ROUTE = '/whale-voice';
    const STORAGE_KEY = 'dsh-whale-voice.panel.v1';
    const SLIDERS = [
      { key: 'rate', label: '语速', min: -10, max: 10, step: 1 },
      { key: 'volume', label: '音量', min: 0, max: 100, step: 5 },
      { key: 'fontSize', label: '字幕字号', min: 12, max: 72, step: 1 },
      { key: 'bottom', label: '字幕高度', min: 0, max: 600, step: 10 },
      { key: 'alpha', label: '字幕透明度', min: 0.2, max: 1, step: 0.05 },
    ];

    const CSS = `
.dsh-whale-voice-panel {
  position: fixed; z-index: 2147481900; right: 16px; bottom: 100px;
  width: 300px; max-height: calc(100vh - 140px); display: flex; flex-direction: column;
  color: #e8f1ff; font-size: 12px;
  font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  background: linear-gradient(180deg, rgba(16,29,48,.97), rgba(9,16,28,.97));
  border: 1px solid rgba(120,180,255,.24); border-radius: 16px;
  box-shadow: 0 18px 50px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.03) inset;
  -webkit-app-region: no-drag;
}
.dsh-wv-head {
  display: flex; align-items: center; gap: 8px; padding: 9px 12px; user-select: none;
  background: rgba(30,52,86,.55); border-bottom: 1px solid rgba(120,180,255,.14);
  border-radius: 16px 16px 0 0;
}
.dsh-wv-dot { width: 8px; height: 8px; border-radius: 50%; background: #4ea1ff; box-shadow: 0 0 10px #4ea1ff; flex: none; }
.dsh-wv-panel.is-off .dsh-wv-dot { background: #7d8fa8; box-shadow: none; }
.dsh-wv-title { font-weight: 600; letter-spacing: .02em; }
.dsh-wv-spacer { flex: 1; }
.dsh-wv-mini {
  background: transparent; color: #9fb6d4; border: none; cursor: pointer; font-size: 14px;
  line-height: 1; padding: 2px 4px; border-radius: 6px;
}
.dsh-wv-mini:hover { background: rgba(100,160,240,.22); color: #e8f1ff; }
.dsh-wv-body { padding: 10px 12px 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 9px; }
.dsh-wv-row { display: flex; align-items: center; gap: 8px; }
.dsh-wv-row > span { flex: none; width: 66px; color: #a8bcdb; }
.dsh-wv-toggle {
  flex: 1; display: flex; align-items: center; justify-content: space-between; gap: 8px;
  background: rgba(90,140,210,.13); color: #cfe2ff; border: 1px solid rgba(120,180,255,.2);
  border-radius: 9px; padding: 5px 9px; cursor: pointer; font-size: 11px;
}
.dsh-wv-toggle:hover { background: rgba(100,160,240,.24); }
.dsh-wv-toggle .knob {
  width: 30px; height: 16px; border-radius: 999px; background: rgba(140,170,210,.3); position: relative; flex: none;
  transition: background .15s;
}
.dsh-wv-toggle .knob::after {
  content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%;
  background: #dce9ff; transition: transform .15s;
}
.dsh-wv-toggle.on .knob { background: #4ea1ff; }
.dsh-wv-toggle.on .knob::after { transform: translateX(14px); }
.dsh-wv-seg { flex: 1; display: flex; gap: 6px; }
.dsh-wv-seg button {
  flex: 1; background: rgba(90,140,210,.13); color: #cfe2ff; border: 1px solid rgba(120,180,255,.2);
  border-radius: 9px; padding: 5px 8px; cursor: pointer; font-size: 11px;
}
.dsh-wv-seg button.on { background: #4ea1ff; border-color: transparent; color: #04121f; font-weight: 600; }
.dsh-wv-select {
  flex: 1; min-width: 0; background: rgba(12,22,38,.9); color: #dbe8ff;
  border: 1px solid rgba(120,180,255,.2); border-radius: 9px; padding: 5px 6px; font-size: 11px;
}
.dsh-wv-slider { flex: 1; display: flex; align-items: center; gap: 8px; }
.dsh-wv-slider input[type=range] { flex: 1; accent-color: #4ea1ff; min-width: 0; }
.dsh-wv-value { flex: none; width: 40px; text-align: right; color: #8fd0ff; font-variant-numeric: tabular-nums; }
.dsh-wv-say { display: flex; gap: 6px; margin-top: 2px; }
.dsh-wv-say input {
  flex: 1; min-width: 0; background: rgba(12,22,38,.9); color: #dbe8ff;
  border: 1px solid rgba(120,180,255,.2); border-radius: 9px; padding: 6px 8px; font-size: 11px;
}
.dsh-wv-say button {
  flex: none; background: #6fb2ff; color: #04121f; border: none; border-radius: 9px;
  padding: 6px 11px; cursor: pointer; font-size: 11px; font-weight: 600;
}
.dsh-wv-say button:hover { background: #8cc4ff; }
.dsh-wv-foot { color: #8098b8; font-size: 10.5px; line-height: 1.5; word-break: break-all; }
.dsh-wv-chip {
  position: fixed; z-index: 2147481900; right: 16px; bottom: 100px;
  width: 42px; height: 42px; border-radius: 50%; cursor: pointer;
  background: linear-gradient(180deg, rgba(16,29,48,.97), rgba(9,16,28,.97));
  border: 1px solid rgba(120,180,255,.28); color: #cfe2ff; font-size: 17px;
  box-shadow: 0 8px 26px rgba(0,0,0,.45); -webkit-app-region: no-drag;
}
.dsh-wv-chip:hover { background: rgba(70,120,190,.5); }
@media (prefers-color-scheme: light) {
  .dsh-whale-voice-panel, .dsh-wv-chip {
    background: linear-gradient(180deg, rgba(248,251,255,.98), rgba(233,241,252,.98));
    color: #16324f; border-color: rgba(60,110,170,.25);
  }
  .dsh-wv-head { background: rgba(220,233,250,.85); }
  .dsh-wv-row > span, .dsh-wv-foot { color: #5a7594; }
  .dsh-wv-toggle, .dsh-wv-seg button { color: #16324f; background: rgba(120,160,210,.16); }
  .dsh-wv-select, .dsh-wv-say input { color: #16324f; background: rgba(255,255,255,.95); }
}
`;

    function el(tag, className) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      return node;
    }

    async function api(path, options) {
      const response = await fetch(`${ROUTE}${path}`, {
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        ...options,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.ok === false) throw new Error(body?.message || `HTTP ${response.status}`);
      return body;
    }

    function readLayout() {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      } catch {
        return {};
      }
    }

    function writeLayout(value) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      } catch {
        /* 无所谓 */
      }
    }

    return {
      apply() {
        const layout = readLayout();
        let collapsed = layout.collapsed === true;

        for (const node of Array.from(document.querySelectorAll('[data-dsh-whale-voice]'))) node.remove();
        for (const node of Array.from(document.querySelectorAll('style[data-dsh-whale-voice-css]'))) node.remove();

        const style = document.createElement('style');
        style.dataset.dshWhaleVoiceCss = 'true';
        style.textContent = CSS;
        document.head.appendChild(style);

        const chip = el('button', 'dsh-wv-chip');
        chip.dataset.dshWhaleVoice = 'chip';
        chip.type = 'button';
        chip.title = '鲸鱼之声';
        chip.textContent = '🐳';

        const panel = el('div', 'dsh-whale-voice-panel');
        panel.dataset.dshWhaleVoice = 'panel';

        const head = el('div', 'dsh-wv-head');
        const dot = el('span', 'dsh-wv-dot');
        const title = el('span', 'dsh-wv-title');
        title.textContent = '鲸鱼之声';
        const spacer = el('span', 'dsh-wv-spacer');
        const collapse = el('button', 'dsh-wv-mini');
        collapse.type = 'button';
        collapse.title = '收起';
        collapse.textContent = '—';
        head.append(dot, title, spacer, collapse);

        const body = el('div', 'dsh-wv-body');

        // 总开关 / 朗读 / 字幕
        const toggles = {};
        for (const [key, label] of [
          ['enabled', '总开关'],
          ['speak', '朗读'],
          ['subtitle', '字幕'],
        ]) {
          const row = el('div', 'dsh-wv-row');
          const rowLabel = el('span');
          rowLabel.textContent = label;
          const button = el('button', 'dsh-wv-toggle');
          button.type = 'button';
          const text = el('span');
          text.textContent = label;
          const knob = el('span', 'knob');
          button.append(text, knob);
          button.addEventListener('click', async () => {
            const next = !button.classList.contains('on');
            button.classList.toggle('on', next);
            try {
              const state = await api('/config', { method: 'POST', body: JSON.stringify({ [key]: next }) });
              sync(state.config);
              refreshFoot(state);
            } catch (error) {
              refreshFoot({ lastSpeakerError: String(error.message ?? error) });
              void refresh();
            }
          });
          toggles[key] = button;
          row.append(rowLabel, button);
          body.append(row);
        }

        // 引擎
        const engineRow = el('div', 'dsh-wv-row');
        const engineLabel = el('span');
        engineLabel.textContent = '引擎';
        const seg = el('div', 'dsh-wv-seg');
        const engineButtons = {};
        for (const [value, label] of [
          ['winrt', '系统音色'],
          ['sovits', '大肥鱼'],
        ]) {
          const button = el('button');
          button.type = 'button';
          button.textContent = label;
          button.addEventListener('click', async () => {
            try {
              const state = await api('/config', { method: 'POST', body: JSON.stringify({ engine: value }) });
              sync(state.config);
              refreshFoot(state);
            } catch (error) {
              refreshFoot({ lastSpeakerError: String(error.message ?? error) });
            }
          });
          engineButtons[value] = button;
          seg.append(button);
        }
        engineRow.append(engineLabel, seg);
        body.append(engineRow);

        // 音色
        const voiceRow = el('div', 'dsh-wv-row');
        const voiceLabel = el('span');
        voiceLabel.textContent = '音色';
        const voiceSelect = el('select', 'dsh-wv-select');
        voiceSelect.addEventListener('change', async () => {
          try {
            const state = await api('/config', { method: 'POST', body: JSON.stringify({ voice: voiceSelect.value }) });
            refreshFoot(state);
          } catch (error) {
            refreshFoot({ lastSpeakerError: String(error.message ?? error) });
          }
        });
        voiceRow.append(voiceLabel, voiceSelect);
        body.append(voiceRow);

        // 滑杆
        const sliderValues = {};
        for (const item of SLIDERS) {
          const row = el('div', 'dsh-wv-row');
          const rowLabel = el('span');
          rowLabel.textContent = item.label;
          const wrap = el('div', 'dsh-wv-slider');
          const range = el('input');
          range.type = 'range';
          range.min = String(item.min);
          range.max = String(item.max);
          range.step = String(item.step);
          const value = el('span', 'dsh-wv-value');
          let timer = null;
          range.addEventListener('input', () => {
            value.textContent = String(range.value);
            if (timer !== null) clearTimeout(timer);
            timer = setTimeout(async () => {
              try {
                const state = await api('/config', { method: 'POST', body: JSON.stringify({ [item.key]: Number(range.value) }) });
                refreshFoot(state);
              } catch (error) {
                refreshFoot({ lastSpeakerError: String(error.message ?? error) });
              }
            }, 260);
          });
          wrap.append(range, value);
          row.append(rowLabel, wrap);
          body.append(row);
          sliderValues[item.key] = { range, value };
        }

        // 试听
        const sayRow = el('div', 'dsh-wv-say');
        const input = el('input');
        input.placeholder = '试听一句…';
        const sayButton = el('button');
        sayButton.type = 'button';
        sayButton.textContent = '说';
        sayButton.addEventListener('click', async () => {
          const text = input.value.trim();
          if (text === '') return;
          sayButton.disabled = true;
          try {
            await api('/say', { method: 'POST', body: JSON.stringify({ text, speak: true, subtitle: true }) });
          } catch (error) {
            refreshFoot({ lastSpeakerError: String(error.message ?? error) });
          } finally {
            sayButton.disabled = false;
          }
        });
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') sayButton.click();
        });
        sayRow.append(input, sayButton);
        body.append(sayRow);

        const foot = el('div', 'dsh-wv-foot');
        body.append(foot);

        panel.append(head, body);
        document.body.append(panel, chip);

        function sync(config) {
          if (config === null || typeof config !== 'object') return;
          panel.classList.toggle('is-off', config.enabled === false);
          for (const key of Object.keys(toggles)) toggles[key].classList.toggle('on', config[key] === true);
          for (const [value, button] of Object.entries(engineButtons)) {
            button.classList.toggle('on', config.engine === value);
          }
          if (typeof config.voice === 'string') {
            if (voiceSelect.value !== config.voice && voiceSelect.options.length === 0) voiceSelect.value = '';
            if (Array.from(voiceSelect.options).some((option) => option.value === config.voice)) {
              voiceSelect.value = config.voice;
            } else {
              const option = el('option');
              option.value = config.voice;
              option.textContent = config.voice;
              voiceSelect.append(option);
              voiceSelect.value = config.voice;
            }
          }
          for (const item of SLIDERS) {
            const entry = sliderValues[item.key];
            if (typeof config[item.key] === 'number') {
              entry.range.value = String(config[item.key]);
              entry.value.textContent = String(config[item.key]);
            }
          }
        }

        function refreshFoot(state) {
          const parts = [];
          if (state?.projector !== undefined) parts.push(state.projector === 'running' ? '字幕框在线' : '字幕框未启动');
          if (state?.engine === 'sovits') {
            parts.push(state.sovits === 'running' ? (state.sovitsReady ? '大肥鱼就绪' : '大肥鱼加载中') : '大肥鱼未启动');
          } else if (state?.speaker !== undefined) {
            parts.push(state.speaker === 'running' ? '系统音色在线' : '系统音色未启动');
          }
          if (typeof state?.queue === 'number' && state.queue > 0) parts.push(`待说 ${state.queue} 句`);
          if (typeof state?.lastSpeakerError === 'string' && state.lastSpeakerError !== '') {
            parts.push(`报错：${state.lastSpeakerError.slice(0, 60)}`);
          }
          foot.textContent = parts.join(' · ') || '就绪';
        }

        async function refresh() {
          try {
            const state = await api('/state');
            sync(state.config ?? state);
            refreshFoot(state);
          } catch (error) {
            foot.textContent = `连不上 Host：${String(error.message ?? error).slice(0, 60)}`;
          }
        }

        async function loadVoices() {
          try {
            const result = await api('/voices');
            const current = voiceSelect.value;
            voiceSelect.textContent = '';
            for (const name of result.voices ?? []) {
              const option = el('option');
              option.value = name;
              option.textContent = name;
              voiceSelect.append(option);
            }
            if (current !== '') voiceSelect.value = current;
          } catch {
            /* Host 慢或者列表拉不到，不影响其它开关 */
          }
        }

        function applyCollapsed() {
          panel.style.display = collapsed ? 'none' : 'flex';
          chip.style.display = collapsed ? 'block' : 'none';
        }

        collapse.addEventListener('click', () => {
          collapsed = true;
          writeLayout({ ...readLayout(), collapsed });
          applyCollapsed();
        });
        chip.addEventListener('click', () => {
          collapsed = false;
          writeLayout({ ...readLayout(), collapsed });
          applyCollapsed();
          void refresh();
        });

        applyCollapsed();
        void refresh();
        void loadVoices();

        return () => {
          style.remove();
          panel.remove();
          chip.remove();
        };
      },
    };
  },
});
