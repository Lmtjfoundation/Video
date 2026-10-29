// Offline answer engine: matches a question to knowledge-base entries with
// synonym expansion, light stemming and IDF-weighted keyword scoring.
import { ENTRIES, CHEAT_CODES } from './knowledge.js';

const STOP = new Set(('a an the is are was were be been am do does did i me my you your it its this that these those of to in on at for with ' +
  'and or but if so can could would should will how what which who whom where when why there here please tell show give get got ' +
  'about any some have has had just like want need know game play playing does don t s im i\'m whats what\'s').split(' '));

// map everyday words onto the vocabulary used in the knowledge base
const SYNONYMS = {
  gun: 'weapon', guns: 'weapon', firearm: 'weapon', cops: 'police', cop: 'police', officer: 'police', heat: 'wanted',
  chopper: 'helicopter', helo: 'helicopter', copter: 'helicopter', plane: 'helicopter', fly: 'helicopter', flying: 'helicopter',
  cash: 'money', dollars: 'money', rich: 'money', bucks: 'money',
  code: 'cheat', codes: 'cheat', hack: 'cheat', hacks: 'cheat', trainer: 'cheat',
  quickest: 'fastest', quick: 'fastest', speedy: 'fastest', fast: 'fastest',
  auto: 'car', automobile: 'car', ride: 'car', motorcycle: 'bike', motorbike: 'bike',
  quest: 'mission', job: 'mission', jobs: 'mission', robbery: 'heist', rob: 'heist', bank: 'heist',
  die: 'wasted', died: 'wasted', death: 'wasted', dead: 'wasted', arrested: 'busted', arrest: 'busted', jail: 'busted',
  fps: 'performance', laggy: 'lag', lagging: 'lag', choppy: 'lag',
  ue5: 'unreal', ue: 'unreal', unreal5: 'unreal',
  nola: 'orleans', atl: 'atlanta', dfw: 'dallas', big: 'big',
  keys: 'control', keybinds: 'control', hotkeys: 'control', controls: 'control',
  music: 'radio', songs: 'radio', godmode: 'invincible', invincibility: 'invincible',
  strongest: 'best', powerful: 'best', top: 'best', op: 'best', toughest: 'durable', tankiest: 'durable',
};

function stem(w) {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 3 && w.endsWith('es') && !w.endsWith('ses')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export function tokenize(text) {
  const out = [];
  for (let w of text.toLowerCase().replace(/[’']/g, '').replace(/c\+\+/g, 'cpp').split(/[^a-z0-9]+/)) {
    if (!w || STOP.has(w)) continue;
    const syn = SYNONYMS[w];
    out.push(w);
    if (syn) out.push(syn);
    const s = stem(w);
    if (s !== w) out.push(s);
  }
  return out;
}

// index: token -> set of entry ids, and each entry's weighted token bag
const index = ENTRIES.map((e) => {
  const bag = new Map();
  const add = (toks, wgt) => { for (const t of toks) bag.set(t, Math.max(bag.get(t) || 0, wgt)); };
  // cheat entries only match strongly on the code itself, so "run" or "rain" find the real topic first
  if (e.code) { add(e.keywords.slice(1).flatMap((k) => [k, stem(k)]), 1.2); add([e.code.toLowerCase()], 3); }
  else add(e.keywords.flatMap((k) => [k, stem(k)]), 3);
  add(tokenize(e.title), 2.5);
  add(tokenize(e.answer.replace(/<[^>]+>/g, ' ')), 0.6);
  return { e, bag };
});
const df = new Map();
for (const { bag } of index) for (const t of bag.keys()) df.set(t, (df.get(t) || 0) + 1);
const idf = (t) => Math.log(1 + index.length / (df.get(t) || index.length));

export const byId = Object.fromEntries(ENTRIES.map((e) => [e.id, e]));

// a few high-precision intents that keyword overlap alone gets wrong
const INTENTS = [
  [/\b(fastest|quickest|top speed)\b.*\b(car|vehicle|ride)\b|\b(car|vehicle)\b.*\b(fastest|quickest)\b/, 'vehicle-sports'],
  [/\b(best|strongest|most powerful|op)\b.*\b(gun|weapon)\b|\b(gun|weapon)\b.*\b(best|strongest)\b/, 'weapons'],
  [/\b(get|make|earn|more|infinite|free|lots of|give|gives|cheat|cheats)\b.*\b(money|cash|rich)\b|\bget rich\b/, 'cheat-hesoyam'],
  [/\b(god ?mode|invincib|immortal|can'?t die)\b/, 'cheat-painkiller'],
  [/\b(lose|escape|evade|get rid of|shake)\b.*\b(cops?|police|wanted|stars?)\b/, 'wanted'],
  [/\b(tank)\b.*\b(where|find|get|spawn)\b|\b(where|find|get|spawn)\b.*\btank\b/, 'vehicle-tank'],
  [/\b(heli|helicopter|chopper)\b.*\b(where|find|get|spawn)\b|\b(where|find|get|spawn)\b.*\b(heli|helicopter|chopper)\b/, 'controls-heli'],
  [/\b(run|start|launch|open|host|serve|install)\b.*\b(game|it|project|locally|server|browser)\b/, 'run'],
  [/^(what is|what's|whats) (this|it|that)\b|\b(this|the) (project|repo)\b/, 'overview'],
  [/\b(hi|hello|hey|yo|sup)\b[!. ]*$/, '__greet'],
  [/\b(thanks|thank you|thx|cheers)\b/, '__thanks'],
  [/\b(who are you|what are you|what can you do|help)\b\??$/, '__help'],
];

export function answer(question) {
  const q = question.trim();
  if (!q) return null;
  const lower = q.toLowerCase();

  // a cheat code typed on its own, in capitals, or asked about as a cheat ("what does rhino do").
  // Codes like MONSTER or ROCKET are also ordinary words, so lowercase prose falls through to scoring.
  const cheatish = /\b(cheat|code)\b|\bwhat does \w+ do\b/i.test(q);
  for (const c of CHEAT_CODES) {
    const m = q.match(new RegExp(`\\b${c}\\b`, 'i'));
    if (m && (m[0] === c || cheatish || lower.replace(/[^a-z]/g, '') === c.toLowerCase())) return result(byId['cheat-' + c.toLowerCase()], 1);
  }

  for (const [re, id] of INTENTS) if (re.test(lower)) {
    if (id.startsWith('__')) return special(id);
    return result(byId[id], 1);
  }

  const toks = [...new Set(tokenize(q))];
  if (!toks.length) return special('__fallback');
  const scored = index.map(({ e, bag }) => {
    let s = 0, hits = 0;
    for (const t of toks) { const w = bag.get(t); if (w) { s += w * idf(t); hits++; } }
    // reward covering more of the question; slightly prefer focused (hidden, specific) entries on ties
    s *= 0.5 + hits / toks.length;
    if (e.hidden) s *= 1.05;
    return { e, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);

  if (!scored.length || scored[0].s < 2.2) return special('__fallback', toks);
  const top = scored[0];
  const related = scored.slice(1, 4).filter((x) => x.s > top.s * 0.55).map((x) => x.e.id);
  return result(top.e, Math.min(1, top.s / 12), related);
}

function result(e, confidence, related = []) {
  const follow = [...new Set([...(e.followups || []), ...related])].filter((id) => id !== e.id && byId[id]).slice(0, 4);
  return { id: e.id, title: e.title, html: e.answer, source: e.source, confidence, followups: follow };
}

function special(kind) {
  const base = { id: kind, source: null, confidence: 1 };
  if (kind === '__greet') return { ...base, title: 'Hey!', html: '<p>Hey! Ask me anything about <b>Grand Theft: Southern Heat</b>: controls, cheats, missions, weapons, vehicles, the three cities, or how to build the Unreal version.</p>', followups: ['run', 'cheats', 'missions'] };
  if (kind === '__thanks') return { ...base, title: 'Anytime', html: '<p>Anytime. Have fun out there, and watch out for the tank at 5 stars.</p>', followups: ['wanted', 'cheats'] };
  if (kind === '__help') return { ...base, title: 'What I can do', html: `<p>I'm <b>ChatVue</b>, an offline guide to this project. Every answer comes from the project's READMEs and game source, and each one names its source file. I can help with:</p>
<ul><li>Running the game, URL options, performance and mobile</li><li>Controls on foot, driving and flying</li><li>All ${CHEAT_CODES.length} cheat codes</li><li>The six missions, plus weapons and vehicle stats</li><li>Dallas, New Orleans and Atlanta</li><li>The code layout and the Unreal Engine 5 build</li></ul>`, followups: ['overview', 'run', 'cheats'] };
  return { ...base, id: '__fallback', title: 'Not sure', confidence: 0,
    html: '<p>I couldn\'t find that in the project\'s documentation or code, and I won\'t guess. Try rephrasing, or pick a topic below.</p>',
    followups: ['overview', 'controls-foot', 'cheats', 'missions'] };
}

// topic list for the sidebar
export const TOPICS = (() => {
  const map = new Map();
  for (const e of ENTRIES) if (!e.hidden) { if (!map.has(e.topic)) map.set(e.topic, []); map.get(e.topic).push(e); }
  return [...map].map(([name, entries]) => ({ name, entries }));
})();
