'use strict';

const GAME_SEC = 60;
const STORE_KEY = 'genso-time-trial-v1';

/* ---------- 保存データ ---------- */
let save = { best: {}, unlocked: 1, sound: true };
try {
  const s = JSON.parse(localStorage.getItem(STORE_KEY));
  if (s) save = Object.assign(save, s);
} catch (e) { /* 保存できない環境でも遊べる */ }
function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(save)); } catch (e) { /* noop */ }
}

/* ---------- ユーティリティ ---------- */
const $ = (s) => document.querySelector(s);
const rand = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rand(a.length)];
const uniq = (a) => [...new Set(a)];
function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 化学式をHTMLに（数字は下つき、^のあとは電荷として上つき）
function fm(s) {
  const i = s.indexOf('^');
  const base = i < 0 ? s : s.slice(0, i);
  const ch = i < 0 ? '' : s.slice(i + 1);
  let h = esc(base).replace(/(\d+)/g, '<sub>$1</sub>');
  if (ch) h += '<sup>' + ch.replace('-', '−') + '</sup>';
  return '<span class="f">' + h + '</span>';
}
// 係数つきの項（例：2H2O）
function term(s) {
  const m = s.match(/^(\d+)(\D.*)$/);
  return m ? '<span class="t"><span class="coef">' + m[1] + '</span>' + fm(m[2]) + '</span>' : fm(s);
}
function equation(r, blankIndex) {
  let k = 0;
  const side = (arr) => arr.map((t) => (k++ === blankIndex ? '<span class="blank">？</span>' : term(t))).join('<span class="op">+</span>');
  return side(r.l) + '<span class="op arrow">→</span>' + side(r.r);
}

// 同じものが続かないように、シャッフルした袋から順番に取り出す
function bag(list) {
  let q = [], last = null;
  return () => {
    if (!q.length) {
      q = shuffle(list);
      if (q.length > 1 && q[q.length - 1] === last) q.unshift(q.pop());
    }
    last = q.pop();
    return last;
  };
}

/* ---------- 問題づくり ---------- */
const BASIC = ELEMENTS.filter((e) => e.basic);

function choiceQ({ key, prompt, sub, correct, wrongs, explain, small }) {
  const w = uniq(wrongs.filter((x) => x !== correct)).slice(0, 3);
  const options = shuffle([correct, ...w]);
  return { type: 'choice', key, prompt, sub, options, answer: options.indexOf(correct), explain, small };
}

// 記号の文字が似ている元素を先に並べる（まぎらわしい選択肢を作るため）
function similar(e, pool) {
  const letters = new Set(e.sym.toLowerCase());
  const score = (x) => ([...x.sym.toLowerCase()].some((c) => letters.has(c)) ? 1 : 0);
  return shuffle(pool.filter((x) => x !== e)).sort((a, b) => score(b) - score(a));
}

// 「○○」を元素名でうめる（解説・ずかん用）
const fill = (p, e) => p.replace(/○+/g, e.name);

const elLabel = (e) => fm(e.sym) + '<small>' + e.name + '</small>';
const big = (html) => '<div class="q-big">' + html + '</div>';

function genNameToSym(pool, useFakes) {
  const next = bag(pool);
  return () => {
    const e = next();
    const real = (useFakes ? similar(e, pool) : shuffle(pool.filter((x) => x !== e))).slice(0, 3).map((x) => x.sym);
    const cands = useFakes ? shuffle(real.slice(0, 2).concat(shuffle(e.fake || []).slice(0, 1), real.slice(2))) : real;
    return choiceQ({
      key: 'ns' + e.sym, prompt: big(e.name), sub: 'の元素記号は？',
      correct: fm(e.sym), wrongs: cands.map(fm),
      explain: e.name + ' ＝ ' + fm(e.sym),
    });
  };
}

function genSymToName(pool) {
  const next = bag(pool);
  return () => {
    const e = next();
    return choiceQ({
      key: 'sn' + e.sym, prompt: big(fm(e.sym)), sub: 'はどの元素？',
      correct: e.name, wrongs: similar(e, pool).slice(0, 3).map((x) => x.name),
      explain: fm(e.sym) + ' ＝ ' + e.name,
    });
  };
}

function genTyping(pool) {
  const next = bag(pool);
  return () => {
    const e = next();
    return {
      type: 'input', key: 'ty' + e.sym, prompt: big(e.name), sub: 'の元素記号を入力しよう',
      accept: e.sym, explain: e.name + ' ＝ ' + fm(e.sym),
    };
  };
}

function genProps() {
  const items = ELEMENTS.flatMap((e) => e.props.map((p) => ({ e, p })));
  const next = bag(items);
  const group = (e) => (e.state === '気体' ? 'g' : e.metal ? 'm' : 'n');
  return () => {
    const { e, p } = next();
    const same = shuffle(ELEMENTS.filter((x) => x !== e && group(x) === group(e)));
    const other = shuffle(ELEMENTS.filter((x) => x !== e && group(x) !== group(e)));
    const wrongs = same.slice(0, 2).concat(other, same.slice(2));
    return choiceQ({
      key: 'pr' + p, prompt: '<div class="q-text">' + esc(p) + '</div>', sub: 'この元素はどれ？',
      correct: elLabel(e), wrongs: wrongs.map(elLabel), small: true,
      explain: esc(fill(p, e)) + ' → <b>' + e.name + '</b> ' + fm(e.sym),
    });
  };
}

function genFormula(list, kind) {
  const next = bag(list);
  return () => {
    const it = next();
    const others = shuffle(list.filter((x) => x !== it));
    const note = it.note || ionNote(it);
    const explain = it.name + ' ＝ ' + fm(it.f) + (note ? '<br><small>' + esc(note) + '</small>' : '');
    if (Math.random() < 0.6) {
      return choiceQ({
        key: 'nf' + it.f, prompt: big(it.name), sub: 'の' + kind + 'は？',
        correct: fm(it.f),
        wrongs: shuffle(it.x).slice(0, 2).concat(others.map((x) => x.f)).map(fm),
        explain,
      });
    }
    return choiceQ({
      key: 'fn' + it.f, prompt: big(fm(it.f)), sub: 'の名前は？',
      correct: it.name,
      wrongs: shuffle(it.nf || []).slice(0, 1).concat(others.map((x) => x.name)),
      explain,
    });
  };
}

function ionNote(it) {
  const m = it.f.match(/\^(\d*)([+-])$/);
  if (!m) return '';
  const n = m[1] || '1';
  return m[2] === '+' ? '陽イオン：電子を' + n + '個失ってできる' : '陰イオン：電子を' + n + '個受けとってできる';
}

// まちがいの化学式（反応式の選択肢づくりに使う）
const FAKES = {};
[...MOLECULES, ...COMPOUNDS1, ...COMPOUNDS2, ...IONS].forEach((it) => { FAKES[it.f] = it.x; });

function genReaction() {
  const next = bag(REACTIONS);
  const split = (t) => { const m = t.match(/^(\d+)(\D.*)$/); return m ? [+m[1], m[2]] : [1, t]; };
  const mk = (c, f) => (c === 1 ? '' : c) + f;
  return () => {
    const r = next();
    const terms = [...r.l, ...r.r];
    const k = rand(terms.length);
    const target = terms[k];
    const [coef, f] = split(target);
    const coefs = shuffle([1, 2, 3, 4].filter((c) => c !== coef).map((c) => mk(c, f)));
    const fakes = shuffle((FAKES[f] || []).map((x) => mk(coef, x)));
    const others = shuffle(terms.filter((t, j) => j !== k));
    const groups = [coefs, fakes, others];
    const wrongs = [];
    groups.forEach((g) => { if (g.length) wrongs.push(g.shift()); });
    wrongs.push(...shuffle(groups.flat()));
    return choiceQ({
      key: 're' + r.note + k,
      prompt: '<div class="q-note">' + esc(r.note) + '</div><div class="q-eq">' + equation(r, k) + '</div>',
      sub: '？に入るのは？',
      correct: term(target), wrongs: wrongs.filter((x) => x !== target).map(term),
      explain: '<span class="eq-inline">' + equation(r, -1) + '</span><br><small>' + esc(r.note) + '</small>',
    });
  };
}

function genMix(gens) {
  return () => pick(gens)();
}

/* ---------- レベル ---------- */
// goal: 次のレベルが解放される正解数 / ranks: [S, A, B] に必要な正解数
const LEVELS = [
  { id: 1,  icon: '🔰', title: '元素記号 にゅうもん', desc: 'よく出る10種類。元素名 → 元素記号', goal: 10, ranks: [24, 16, 10],
    make: () => genNameToSym(BASIC, false) },
  { id: 2,  icon: '⚛️', title: '元素記号 マスター', desc: '18種類。名前 ⇄ 記号 の両方向', goal: 10, ranks: [22, 15, 10],
    make: () => genMix([genNameToSym(ELEMENTS, true), genSymToName(ELEMENTS)]) },
  { id: 3,  icon: '⌨️', title: '元素記号 タイピング', desc: '記号を自分で入力！大文字・小文字に注意', goal: 8, ranks: [20, 14, 8],
    make: () => genTyping(ELEMENTS) },
  { id: 4,  icon: '🔍', title: '元素のせいしつ', desc: 'ヒントから元素を当てよう', goal: 8, ranks: [18, 12, 8],
    make: () => genProps() },
  { id: 5,  icon: '💧', title: '分子の化学式', desc: 'H₂O、CO₂、NH₃ など', goal: 10, ranks: [22, 15, 10],
    make: () => genFormula(MOLECULES, '化学式') },
  { id: 6,  icon: '🧪', title: '化合物の化学式 ①', desc: '酸化物・硫化物・塩化物', goal: 9, ranks: [20, 14, 9],
    make: () => genFormula(COMPOUNDS1, '化学式') },
  { id: 7,  icon: '⚗️', title: '化合物の化学式 ②', desc: '酸・アルカリ・炭酸の化合物', goal: 8, ranks: [18, 12, 8],
    make: () => genFormula(COMPOUNDS2, '化学式') },
  { id: 8,  icon: '⚡', title: 'イオンの化学式', desc: 'Na⁺、Cu²⁺、SO₄²⁻ など', goal: 9, ranks: [20, 14, 9],
    make: () => genFormula(IONS, 'イオン式') },
  { id: 9,  icon: '🔥', title: '化学反応式', desc: '反応式・電離式の？をうめよう', goal: 6, ranks: [14, 9, 6],
    make: () => genReaction() },
  { id: 10, icon: '👑', title: 'ファイナルチャレンジ', desc: 'これまでの全レベルからランダム出題', goal: 0, ranks: [18, 12, 8],
    make: () => genMix([genNameToSym(ELEMENTS, true), genSymToName(ELEMENTS), genProps(),
      genFormula(MOLECULES, '化学式'), genFormula(COMPOUNDS1, '化学式'), genFormula(COMPOUNDS2, '化学式'),
      genFormula(IONS, 'イオン式'), genReaction()]) },
];

function rankOf(lv, score) {
  const [s, a, b] = lv.ranks;
  return score >= s ? 'S' : score >= a ? 'A' : score >= b ? 'B' : 'C';
}
const RANK_MSG = {
  S: 'すごい！元素マスターだ！',
  A: 'すばらしい！あと少しで S ランク！',
  B: 'いい調子！もっと速く答えられるかな？',
  C: 'まずは「ずかん」で確認してから再チャレンジ！',
};

/* ---------- 効果音 ---------- */
let actx = null;
function beep(freq, dur, type = 'sine', vol = 0.12, when = 0) {
  if (!save.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime + when;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(actx.destination);
    o.start(t);
    o.stop(t + dur);
  } catch (e) { /* 音が出せない環境 */ }
}
const sfx = {
  ok: () => { beep(880, 0.08, 'triangle'); beep(1320, 0.12, 'triangle', 0.12, 0.06); },
  ng: () => beep(170, 0.28, 'sawtooth', 0.07),
  tick: () => beep(1000, 0.05, 'square', 0.04),
  count: () => beep(660, 0.12, 'triangle'),
  go: () => beep(1046, 0.3, 'triangle'),
  end: () => [523, 659, 784, 1046].forEach((f, i) => beep(f, 0.2, 'triangle', 0.12, i * 0.1)),
};

/* ---------- 画面切りかえ ---------- */
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  window.scrollTo(0, 0);
}

/* ---------- ホーム ---------- */
function renderHome() {
  const list = $('#levels');
  list.innerHTML = '';
  LEVELS.forEach((lv) => {
    const locked = lv.id > save.unlocked;
    const best = save.best[lv.id];
    const btn = document.createElement('button');
    btn.className = 'level' + (locked ? ' locked' : '');
    btn.disabled = locked;
    const prev = LEVELS[lv.id - 2];
    btn.innerHTML =
      '<span class="lv-num">Lv.' + lv.id + '</span>' +
      '<span class="lv-icon" aria-hidden="true">' + (locked ? '🔒' : lv.icon) + '</span>' +
      '<span class="lv-body"><span class="lv-title">' + lv.title + '</span>' +
      '<span class="lv-desc">' + (locked ? 'Lv.' + prev.id + ' で ' + prev.goal + '問以上正解すると解放' : lv.desc) + '</span></span>' +
      (best != null && !locked
        ? '<span class="lv-best"><span class="rank r' + rankOf(lv, best) + '">' + rankOf(lv, best) + '</span><span>' + best + '問</span></span>'
        : '');
    btn.addEventListener('click', () => startLevel(lv.id));
    list.appendChild(btn);
  });
  $('#sound-btn').textContent = save.sound ? '🔊 音あり' : '🔇 音なし';
}

/* ---------- ゲーム ---------- */
let G = null;

function startLevel(id) {
  stopGame();
  const lv = LEVELS.find((l) => l.id === id);
  G = { lv, gen: lv.make(), score: 0, combo: 0, maxCombo: 0, miss: 0, mistakes: [], busy: true, ended: false, lastKey: null, lastSec: null };
  $('#g-level').textContent = 'Lv.' + lv.id + ' ' + lv.title;
  $('#g-score').textContent = '0';
  $('#g-combo').textContent = '';
  $('#g-time').textContent = GAME_SEC;
  $('#g-bar').style.width = '100%';
  $('#game').classList.remove('hurry');
  $('#q-card').hidden = true;
  $('#feedback').className = 'feedback';
  $('#feedback').innerHTML = '';
  show('game');
  countdown(3);
}

function countdown(n) {
  const el = $('#countdown');
  el.hidden = false;
  if (n > 0) {
    el.textContent = n;
    sfx.count();
  } else {
    el.textContent = 'スタート！';
    sfx.go();
  }
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
  G.timer = setTimeout(() => {
    if (n > 0) return countdown(n - 1);
    el.hidden = true;
    $('#q-card').hidden = false;
    G.endAt = performance.now() + GAME_SEC * 1000;
    G.clock = setInterval(tick, 100);
    tick();
    nextQ();
  }, n > 0 ? 700 : 500);
}

function tick() {
  if (!G || G.ended) return;
  const left = Math.max(0, G.endAt - performance.now());
  const sec = Math.ceil(left / 1000);
  $('#g-bar').style.width = (left / (GAME_SEC * 10)) + '%';
  if (sec !== G.lastSec) {
    G.lastSec = sec;
    $('#g-time').textContent = sec;
    $('#game').classList.toggle('hurry', sec <= 10);
    if (sec <= 5 && sec > 0) sfx.tick();
  }
  if (left <= 0) finish();
}

function nextQ() {
  if (!G || G.ended) return;
  let q;
  for (let t = 0; t < 6; t++) {
    q = G.gen();
    if (q.key !== G.lastKey) break;
  }
  G.lastKey = q.key;
  G.q = q;
  $('#q-prompt').innerHTML = q.prompt;
  $('#q-sub').textContent = q.sub;
  $('#feedback').className = 'feedback';
  $('#feedback').innerHTML = '';

  const choices = $('#choices');
  const form = $('#type-form');
  if (q.type === 'choice') {
    form.hidden = true;
    choices.hidden = false;
    choices.classList.toggle('small', !!q.small);
    choices.innerHTML = '';
    q.options.forEach((html, i) => {
      const b = document.createElement('button');
      b.className = 'choice';
      b.innerHTML = '<span class="key">' + (i + 1) + '</span><span class="label">' + html + '</span>';
      b.addEventListener('click', () => answerChoice(i));
      choices.appendChild(b);
    });
  } else {
    choices.hidden = true;
    form.hidden = false;
    const input = $('#type-input');
    input.value = '';
    input.classList.remove('ok', 'ng');
    input.focus();
  }
  G.busy = false;
}

function answerChoice(i) {
  if (!G || G.busy || G.ended) return;
  G.busy = true;
  const q = G.q;
  const btns = [...document.querySelectorAll('#choices .choice')];
  btns[q.answer].classList.add('correct');
  if (i === q.answer) {
    correct();
  } else {
    btns[i].classList.add('wrong');
    wrong(q);
  }
}

function submitTyping(force) {
  if (!G || G.busy || G.ended || G.q.type !== 'input') return;
  const input = $('#type-input');
  const v = input.value.trim();
  if (!v) return;
  if (v === G.q.accept) {
    G.busy = true;
    input.classList.add('ok');
    correct();
  } else if (force) {
    G.busy = true;
    input.classList.add('ng');
    const hint = v.toLowerCase() === G.q.accept.toLowerCase() ? '<b>大文字・小文字に注意！</b> 1文字目は大文字、2文字目は小文字だよ。<br>' : '';
    wrong(G.q, hint);
  }
}

function correct() {
  G.score++;
  G.combo++;
  G.maxCombo = Math.max(G.maxCombo, G.combo);
  sfx.ok();
  $('#g-score').textContent = G.score;
  bump($('#g-score'));
  $('#g-combo').textContent = G.combo >= 3 ? G.combo + ' コンボ！' : '';
  if (G.combo >= 3) bump($('#g-combo'));
  const fb = $('#feedback');
  fb.className = 'feedback ok';
  fb.innerHTML = '⭕ 正解！';
  G.timer = setTimeout(nextQ, 260);
}

function wrong(q, hint = '') {
  G.combo = 0;
  G.miss++;
  sfx.ng();
  $('#g-combo').textContent = '';
  if (!G.mistakes.some((m) => m.key === q.key)) G.mistakes.push({ key: q.key, explain: q.explain });
  const fb = $('#feedback');
  fb.className = 'feedback ng';
  fb.innerHTML = '❌ ' + hint + '<span class="fb-answer">' + q.explain + '</span>';
  $('#q-card').classList.remove('shake');
  void $('#q-card').offsetWidth;
  $('#q-card').classList.add('shake');
  G.timer = setTimeout(nextQ, 1400);
}

function bump(el) {
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

function stopGame() {
  if (!G) return;
  G.ended = true;
  clearTimeout(G.timer);
  clearInterval(G.clock);
}

function finish() {
  stopGame();
  $('#type-input').blur();
  sfx.end();
  const lv = G.lv;
  const score = G.score;
  const rank = rankOf(lv, score);
  const prevBest = save.best[lv.id];
  const newRecord = prevBest == null || score > prevBest;
  if (newRecord) save.best[lv.id] = score;
  let unlockMsg = '';
  if (lv.goal && score >= lv.goal && save.unlocked <= lv.id && lv.id < LEVELS.length) {
    save.unlocked = lv.id + 1;
    unlockMsg = '🎉 Lv.' + (lv.id + 1) + '「' + LEVELS[lv.id].title + '」が解放されました！';
  } else if (lv.goal && score < lv.goal && save.unlocked <= lv.id) {
    unlockMsg = 'あと ' + (lv.goal - score) + '問 正解で次のレベルが解放されるよ！';
  }
  persist();

  const total = score + G.miss;
  $('#r-level').textContent = 'Lv.' + lv.id + ' ' + lv.title;
  $('#r-rank').className = 'big-rank r' + rank;
  $('#r-rank').textContent = rank;
  $('#r-msg').textContent = RANK_MSG[rank];
  $('#r-score').textContent = score;
  $('#r-acc').textContent = total ? Math.round((score / total) * 100) + '%' : '-';
  $('#r-combo').textContent = G.maxCombo;
  $('#r-best').textContent = save.best[lv.id] + '問';
  $('#r-new').hidden = !(newRecord && score > 0);
  $('#r-unlock').hidden = !unlockMsg;
  $('#r-unlock').textContent = unlockMsg;
  $('#r-unlock').classList.toggle('good', unlockMsg.startsWith('🎉'));
  const ml = $('#r-mistakes');
  ml.innerHTML = G.mistakes.length
    ? G.mistakes.map((m) => '<li>' + m.explain + '</li>').join('')
    : '<li class="none">ミスなし！パーフェクト！</li>';
  const nextBtn = $('#r-next');
  nextBtn.hidden = !(lv.id < LEVELS.length && save.unlocked > lv.id);
  show('result');
  if (rank === 'S' || (newRecord && score > 0)) confetti();
}

function confetti() {
  const colors = ['#ff5a5f', '#ffb400', '#00c2a8', '#4f7cff', '#b45cff'];
  const wrap = document.createElement('div');
  wrap.className = 'confetti';
  for (let i = 0; i < 70; i++) {
    const p = document.createElement('i');
    p.style.left = Math.random() * 100 + '%';
    p.style.background = pick(colors);
    p.style.animationDelay = Math.random() * 0.6 + 's';
    p.style.animationDuration = 1.8 + Math.random() * 1.4 + 's';
    p.style.transform = 'rotate(' + rand(360) + 'deg)';
    wrap.appendChild(p);
  }
  document.body.appendChild(wrap);
  setTimeout(() => wrap.remove(), 3600);
}

/* ---------- ずかん ---------- */
const ZUKAN_TABS = [
  { id: 'el', label: '元素' },
  { id: 'mol', label: '分子' },
  { id: 'cmp', label: '化合物' },
  { id: 'ion', label: 'イオン' },
  { id: 'rx', label: '反応式' },
];
let zukanTab = 'el';

function renderZukan() {
  $('#z-tabs').innerHTML = ZUKAN_TABS.map((t) =>
    '<button class="tab' + (t.id === zukanTab ? ' active' : '') + '" data-tab="' + t.id + '">' + t.label + '</button>').join('');
  const body = $('#z-body');
  const rows = (list) => '<div class="z-list">' + list.map((it) =>
    '<div class="z-row"><span class="z-f">' + fm(it.f) + '</span><span class="z-name">' + it.name +
    '<small>' + esc(it.note || ionNote(it)) + '</small></span></div>').join('') + '</div>';
  if (zukanTab === 'el') {
    body.innerHTML = '<div class="z-grid">' + ELEMENTS.map((e) =>
      '<div class="z-card ' + (e.metal ? 'metal' : 'nonmetal') + '">' +
      '<div class="z-head"><span class="z-sym"><span class="z-n">' + e.n + '</span>' + e.sym + '</span>' +
      '<span class="z-nm">' + e.name + '<small>' + e.yomi + '</small></span>' +
      '<span class="z-tags"><span>' + (e.metal ? '金属' : '非金属') + '</span><span>' + e.state + '</span></span></div>' +
      '<ul>' + e.props.map((p) => '<li>' + esc(fill(p, e)) + '</li>').join('') + '</ul></div>').join('') + '</div>';
  } else if (zukanTab === 'mol') {
    body.innerHTML = '<p class="z-lead">分子＝いくつかの原子が結びついた、物質の性質を示す最小の粒子。</p>' + rows(MOLECULES);
  } else if (zukanTab === 'cmp') {
    body.innerHTML = '<h3>酸化物・硫化物・塩化物</h3>' + rows(COMPOUNDS1) + '<h3>酸・アルカリ・炭酸の化合物</h3>' + rows(COMPOUNDS2);
  } else if (zukanTab === 'ion') {
    body.innerHTML = '<p class="z-lead">陽イオン（＋）は電子を失った原子、陰イオン（－）は電子を受けとった原子。</p>' +
      '<h3>陽イオン</h3>' + rows(IONS.filter((i) => i.f.endsWith('+'))) +
      '<h3>陰イオン</h3>' + rows(IONS.filter((i) => i.f.endsWith('-')));
  } else {
    body.innerHTML = '<p class="z-lead">反応の前と後で、原子の種類と数は変わらない！</p><div class="z-list">' +
      REACTIONS.map((r) => '<div class="z-row rx"><span class="z-name">' + esc(r.note) + '</span><span class="eq-inline">' + equation(r, -1) + '</span></div>').join('') + '</div>';
  }
}

/* ---------- イベント ---------- */
$('#zukan-btn').addEventListener('click', () => { renderZukan(); show('zukan'); });
$('#z-tabs').addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]');
  if (!t) return;
  zukanTab = t.dataset.tab;
  renderZukan();
});
document.querySelectorAll('[data-home]').forEach((b) => b.addEventListener('click', () => { stopGame(); renderHome(); show('home'); }));
$('#sound-btn').addEventListener('click', () => { save.sound = !save.sound; persist(); renderHome(); });
$('#unlock-all').addEventListener('click', () => {
  if (confirm('すべてのレベルを解放しますか？（先生・確認用）')) { save.unlocked = LEVELS.length; persist(); renderHome(); }
});
$('#reset-btn').addEventListener('click', () => {
  if (confirm('ベスト記録と解放状況をすべてリセットしますか？')) { save.best = {}; save.unlocked = 1; persist(); renderHome(); }
});
$('#r-retry').addEventListener('click', () => startLevel(G.lv.id));
$('#r-next').addEventListener('click', () => startLevel(G.lv.id + 1));
$('#type-form').addEventListener('submit', (e) => { e.preventDefault(); submitTyping(true); });
$('#type-input').addEventListener('input', () => submitTyping(false));
document.addEventListener('keydown', (e) => {
  if (!G || G.ended || !$('#game').classList.contains('active')) return;
  if (G.q && G.q.type === 'choice' && /^[1-4]$/.test(e.key)) answerChoice(+e.key - 1);
});

renderHome();
