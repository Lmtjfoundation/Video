import { createApp, ref, computed, nextTick, onMounted, watch } from '../lib/vue.esm-browser.prod.js';
import { answer, byId, TOPICS } from './engine.js';
import { STARTERS } from './knowledge.js';

const STORE = 'chatvue-v1';
const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } };

// tiny WebAudio UI sounds: a soft "send" tick and a two-note "reply" chime
let actx = null;
function tone(freqs, { dur = 0.12, gap = 0.07, type = 'sine', vol = 0.05 } = {}) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    freqs.forEach((f, i) => {
      const t = actx.currentTime + i * gap, o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.02);
    });
  } catch (e) { /* audio unavailable */ }
}

createApp({
  setup() {
    const messages = ref(load(STORE, []));
    const draft = ref('');
    const typing = ref(false);
    const sound = ref(load(STORE + '-sound', true));
    const theme = ref(load(STORE + '-theme', 'auto'));
    const sidebar = ref(false);
    const openTopic = ref(load(STORE + '-topic', 'Start'));
    const log = ref(null), input = ref(null);
    const copied = ref(null);

    watch(messages, (m) => save(STORE, m.slice(-80)), { deep: true });
    watch(sound, (v) => save(STORE + '-sound', v));
    watch(openTopic, (v) => save(STORE + '-topic', v));
    watch(theme, (v) => { save(STORE + '-theme', v); applyTheme(); });
    function applyTheme() {
      if (theme.value === 'auto') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', theme.value);
    }

    const scrollDown = () => nextTick(() => { if (log.value) log.value.scrollTo({ top: log.value.scrollHeight, behavior: 'smooth' }); });

    let uid = Date.now();
    function ask(text, viaId) {
      const q = (text ?? draft.value).trim();
      if (!q || typing.value) return;
      messages.value.push({ id: uid++, role: 'user', text: q });
      draft.value = '';
      if (input.value) input.value.style.height = '';
      sidebar.value = false;
      if (sound.value) tone([660], { dur: 0.08, type: 'triangle', vol: 0.04 });
      typing.value = true;
      scrollDown();
      const res = viaId ? fromId(viaId) : answer(q);
      // brief, length-scaled "thinking" pause so replies don't snap in
      const delay = 380 + Math.min(700, (res?.html.length || 0) / 6);
      setTimeout(() => {
        typing.value = false;
        messages.value.push({ id: uid++, role: 'bot', ...res });
        if (sound.value) tone(res.confidence > 0 ? [784, 1175] : [523, 392], { type: 'sine' });
        scrollDown();
        nextTick(() => input.value?.focus());
      }, delay);
    }
    function fromId(id) {
      const e = byId[id];
      return { id: e.id, title: e.title, html: e.answer, source: e.source, confidence: 1, followups: (e.followups || []).filter((f) => byId[f]).slice(0, 4) };
    }
    const pick = (id) => ask(byId[id].title, id);
    const titleOf = (id) => byId[id]?.title || id;

    function onKey(e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(); }
    }
    function autosize(e) { const t = e.target; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 160) + 'px'; }

    function clearChat() { messages.value = []; typing.value = false; }
    async function copy(m) {
      const tmp = document.createElement('div'); tmp.innerHTML = m.html;
      const text = `${m.title}\n\n${tmp.innerText.trim()}${m.source ? `\n\nSource: ${m.source}` : ''}`;
      try { await navigator.clipboard.writeText(text); copied.value = m.id; setTimeout(() => { if (copied.value === m.id) copied.value = null; }, 1400); } catch (e) { /* clipboard blocked */ }
    }
    const cycleTheme = () => { theme.value = { auto: 'dark', dark: 'light', light: 'auto' }[theme.value]; };
    const themeLabel = computed(() => ({ auto: 'Auto', dark: 'Dark', light: 'Light' }[theme.value]));

    onMounted(() => { applyTheme(); scrollDown(); input.value?.focus(); });

    return { messages, draft, typing, sound, theme, themeLabel, sidebar, openTopic, log, input, copied, TOPICS, STARTERS,
      ask, pick, titleOf, onKey, autosize, clearChat, copy, cycleTheme };
  },
}).mount('#app');
