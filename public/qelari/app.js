/* =========================================================
   Qelari AI — client application
   ========================================================= */
'use strict';

const $ = (id) => document.getElementById(id);
const DESKTOP = matchMedia('(hover: hover) and (pointer: fine)').matches;
const ACCOUNT_SCOPE = encodeURIComponent(String(window.QELARI_ACCOUNT_ID || ''));
if (!ACCOUNT_SCOPE) throw new Error('Qelari requires an authenticated Zunari account.');

const STORE = {
  conversations: `qelari.${ACCOUNT_SCOPE}.conversations.v1`,
  images: `qelari.${ACCOUNT_SCOPE}.images.v1`,
  theme: `qelari.${ACCOUNT_SCOPE}.theme.v1`,
  lastConv: `qelari.${ACCOUNT_SCOPE}.lastConv.v1`,
  preferences: `qelari.${ACCOUNT_SCOPE}.preferences.v1`,
  inferred: `qelari.${ACCOUNT_SCOPE}.inferred.v1`,
};

/* ---------------- Utilities ---------------- */
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}
function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}
function qelariHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-CSRF-Token': window.QELARI_CSRF_TOKEN,
  };
}

function inferredPreferenceNotes() {
  if (!state.preferences.enabled) return '';
  const counts = state.inferred?.counts || {};
  const learned = [];
  if ((counts.concise || 0) >= 2) learned.push('Prefer concise answers.');
  if ((counts.detailed || 0) >= 2) learned.push('Prefer detailed explanations.');
  if ((counts.examples || 0) >= 2) learned.push('Examples are helpful.');
  if ((counts.formal || 0) >= 2) learned.push('Prefer a more formal tone.');
  if ((counts.casual || 0) >= 2) learned.push('Prefer a relaxed, conversational tone.');
  return learned.length ? `Learned from repeated explicit requests: ${learned.join(' ')}` : '';
}

function combinedPreferenceNotes() {
  return [state.preferences.notes, inferredPreferenceNotes()].filter(Boolean).join('\n').slice(0, 1200);
}

function recordPersonalizationSignals(text) {
  if (!state.preferences.enabled || !text) return;
  const signals = {
    concise: /\b(?:keep|make|answer|respond|write|explain)\b.{0,32}\b(?:brief|concise|short)\b|\b(?:brief|concise)\s+(?:answers|responses)\b/i,
    detailed: /\b(?:keep|make|answer|respond|write|explain)\b.{0,32}\b(?:detailed|thorough|in depth|step by step)\b|\b(?:detailed|step-by-step)\s+(?:answers|explanations)\b/i,
    examples: /\b(?:include|show|give|use)\b.{0,24}\b(?:an example|examples)\b|\bexamples?\s+(?:help|are helpful)\b/i,
    formal: /\b(?:use|keep|prefer)\b.{0,24}\bformal\b|\bformal tone\b/i,
    casual: /\b(?:use|keep|prefer)\b.{0,24}\b(?:casual|conversational|relaxed)\b|\bcasual tone\b/i,
  };
  for (const [name, pattern] of Object.entries(signals)) {
    if (pattern.test(text)) {
      state.inferred.counts[name] = Math.min(20, (state.inferred.counts[name] || 0) + 1);
    }
  }
  writeStore(STORE.inferred, state.inferred);
}

let toastTimer = [];
function toast(message, kind = 'info', ms = 2600) {
  const icons = {
    ok: '<path d="m20 6-11 11-5-5"/>',
    err: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.01"/>',
  };
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = '<svg viewBox="0 0 24 24">' + (icons[kind] || icons.info) + '</svg><span>' + esc(message) + '</span>';
  $('toasts').appendChild(el);
  const t = setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
  }, ms);
  toastTimer.push(t);
  if (toastTimer.length > 12) clearTimeout(toastTimer.shift());
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }
}

const timeLabel = (ts) => {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};
function relativeTime(ts) {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return min + 'm ago';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + 'h ago';
  const day = Math.floor(hr / 24);
  if (day < 7) return day + 'd ago';
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function dayGroup(ts) {
  const d = new Date(ts);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (ts >= startOfToday) return 'Today';
  if (ts >= startOfToday - 86400000) return 'Yesterday';
  if (ts >= startOfToday - 7 * 86400000) return 'Previous 7 days';
  if (ts >= startOfToday - 30 * 86400000) return 'Previous 30 days';
  return 'Older';
}

/* ---------------- Theme ---------------- */
const themeOrder = ['dark', 'light', 'system'];
function systemTheme() {
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
function applyTheme(theme) {
  const resolved = theme === 'system' ? systemTheme() : theme;
  document.documentElement.setAttribute('data-theme', resolved);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'light' ? '#f6f7fb' : '#08090c');
  const icon = $('themeIcon');
  if (icon) {
    const isLight = resolved === 'light';
    icon.innerHTML = isLight
      ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'
      : '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>';
  }
  $('themeBtn').title = 'Theme: ' + theme;
}
function initTheme() {
  let theme = readStore(STORE.theme, 'system');
  if (!themeOrder.includes(theme)) theme = 'system';
  applyTheme(theme);
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (readStore(STORE.theme, 'system') === 'system') applyTheme('system');
  });
  $('themeBtn').addEventListener('click', () => {
    const current = readStore(STORE.theme, 'system');
    const next = themeOrder[(themeOrder.indexOf(current) + 1) % themeOrder.length];
    writeStore(STORE.theme, next);
    applyTheme(next);
    toast('Theme: ' + next, 'info', 1500);
  });
}

/* ---------------- Maths rendering ---------------- */
/* A small, dependency-free maths renderer — no CDN, no build step.
   Understands:
     • $inline$ · $$display$$ · \(inline\) · \[display\]
     • \frac{a}{b} · \sqrt{x} · \sum · \int · \pi · \alpha · \times · \leq · …
     • plain notation such as (a+b)^2, x^2, x_1, sqrt(2)
     • spoken maths such as "a plus b whole square" → (a + b)²                */

const MATH_SYMBOLS = {
  times: '×', div: '÷', pm: '±', mp: '∓', cdot: '·', ast: '∗', oplus: '⊕', ominus: '⊖',
  leq: '≤', le: '≤', leqslant: '≤', geq: '≥', ge: '≥', geqslant: '≥',
  neq: '≠', ne: '≠', approx: '≈', equiv: '≡', sim: '∼', simeq: '≃', cong: '≅',
  propto: '∝', ll: '≪', gg: '≫', infty: '∞', partial: '∂', nabla: '∇',
  sum: '∑', prod: '∏', int: '∫', oint: '∮', iint: '∬',
  forall: '∀', exists: '∃', nexists: '∄', in: '∈', notin: '∉', ni: '∋',
  subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇',
  cup: '∪', cap: '∩', setminus: '∖', emptyset: '∅', varnothing: '∅',
  neg: '¬', lnot: '¬', land: '∧', wedge: '∧', lor: '∨', vee: '∨',
  to: '→', rightarrow: '→', leftarrow: '←', Leftarrow: '⇐', Rightarrow: '⇒',
  leftrightarrow: '↔', lefteq: '≤', doteq: '≐', circ: '∘', bullet: '∙',
  angle: '∠', perp: '⊥', parallel: '∥', therefore: '∴', because: '∵',
  degree: '°', prime: '′', ldots: '…', dots: '…', cdots: '⋯',
  langle: '⟨', rangle: '⟩', lvert: '|', rvert: '|', lVert: '‖', rVert: '‖',
  hbar: 'ℏ', aleph: 'ℵ', Re: 'ℜ', Im: 'ℑ', wp: '℘', surd: '√'
};

const MATH_GREEK = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ',
  pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ',
  psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ',
  Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω', vartheta: 'ϑ', varphi: 'ϕ'
};

/* Every LaTeX command we know how to draw — used to spot bare maths. */
const MATH_COMMANDS = Object.keys(MATH_SYMBOLS).concat(Object.keys(MATH_GREEK));
const MATH_COMMAND_RE = new RegExp('\\\\(' + MATH_COMMANDS.join('|') + ')(?![A-Za-z])', 'g');
const BARE_COMMAND_RE = new RegExp(
  '\\\\(?:' + MATH_COMMANDS.join('|') + ')(?![A-Za-z])' +
  '(?:[ \\t]*[+\\-−=<>×÷*/^,][ \\t]*\\\\(?:' + MATH_COMMANDS.join('|') + ')(?![A-Za-z]))*',
  'g');

function findClosingBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
/* Read a {...} group, returning its inner content and where it ends. */
function readBraced(text, i) {
  while (text[i] === ' ') i++;
  if (text[i] !== '{') return null;
  const close = findClosingBrace(text, i);
  if (close < 0) return null;
  return { content: text.slice(i + 1, close), end: close + 1 };
}
/* Read a complete \frac{..}{..} or \sqrt{..} command, honouring nested braces. */
function readMathCommand(s, i) {
  if (s.startsWith('\\frac', i)) {
    const a = readBraced(s, i + 5);
    const b = a ? readBraced(s, a.end) : null;
    if (a && b) return { text: s.slice(i, b.end), end: b.end };
    return null;
  }
  if (s.startsWith('\\sqrt', i)) {
    let j = i + 5;
    if (s[j] === '[') { const k = s.indexOf(']', j); if (k > 0) j = k + 1; }
    const r = readBraced(s, j);
    if (r) return { text: s.slice(i, r.end), end: r.end };
    return null;
  }
  return null;
}

function mathRadical(inner) {
  return '<span class="sqrt"><span class="sign">√</span><span class="rad">' + inner + '</span></span>';
}

/* Replace \frac{..}{..} and \sqrt{..} (braces may nest), recursing into them. */
function replaceMathCommands(s) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s.startsWith('\\frac', i)) {
      const a = readBraced(s, i + 5);
      const b = a ? readBraced(s, a.end) : null;
      if (a && b) {
        out += '<span class="frac"><span class="num">' + mathHtml(a.content) +
          '</span><span class="den">' + mathHtml(b.content) + '</span></span>';
        i = b.end;
        continue;
      }
    }
    if (s.startsWith('\\sqrt', i)) {
      let j = i + 5;
      if (s[j] === '[') {                       // \sqrt[n]{x}
        const k = s.indexOf(']', j);
        if (k > 0) j = k + 1;
      }
      const r = readBraced(s, j);
      if (r) {
        out += mathRadical(mathHtml(r.content));
        i = r.end;
        continue;
      }
    }
    out += s[i];
    i++;
  }
  return out;
}

/* Fallback renderer retained for offline or partially cached visits. */
function legacyMathHtml(expr) {
  let s = replaceMathCommands(String(expr));
  s = s.replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\s*\{([^{}]*)\}/g, '$1');
  s = s.replace(/\\(?:left|right|displaystyle|limits|nolimits)\b/g, '');
  s = s.replace(/\\([a-zA-Z]+)/g, (m, name) => MATH_SYMBOLS[name] || MATH_GREEK[name] || name);
  s = s.replace(/\^\{([^{}]*)\}/g, '<sup>$1</sup>');
  s = s.replace(/\^(-?\d{1,3}|[A-Za-z])/g, '<sup>$1</sup>');
  s = s.replace(/_\{([^{}]*)\}/g, '<sub>$1</sub>');
  s = s.replace(/_([A-Za-z0-9])/g, '<sub>$1</sub>');
  s = s.replace(/\\([%&#_{}$])/g, '$1');
  s = s.replace(/\\([,;:!])/g, ' $1');
  return s;
}

function decodeMathEscapes(value) {
  return String(value).replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ({
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
  })[entity] || entity);
}

function mathHtml(expr, displayMode) {
  if (!window.katex) return legacyMathHtml(expr);
  const tex = decodeMathEscapes(expr)
    .replace(/\\begin\{align\*?\}/g, '\\begin{aligned}')
    .replace(/\\end\{align\*?\}/g, '\\end{aligned}')
    .replace(/\\begin\{gather\*?\}/g, '\\begin{gathered}')
    .replace(/\\end\{gather\*?\}/g, '\\end{gathered}');
  return window.katex.renderToString(tex, {
    displayMode: Boolean(displayMode),
    throwOnError: false,
    strict: 'ignore',
    trust: false,
  });
}

/* ---------------- spoken maths ---------------- */
const SPOKEN_OP_RE = /(multiplied\s+by|divided\s+by|square\s+root\s+of|plus|minus|times|over|equals)(?![\w])/iy;
const SPOKEN_OP_MAP = {
  'plus': '+', 'minus': '−', 'times': '×', 'multiplied by': '×',
  'divided by': '÷', 'over': '÷', 'equals': '=', 'square root of': '√'
};
const SPOKEN_POW_RE = /(squared|cubed|to\s+the\s+power\s+of\s+(\d+))(?![\w])/iy;
const SPOKEN_WHOLE_POW_RE = /(whole\s+square|whole\s+cube)(?![\w])/iy;

const skipWs = (text, i) => { while (i < text.length && /\s/.test(text[i])) i++; return i; };
const isMathLikeGroup = (s) => s.length > 0 && s.length <= 24 && /^[A-Za-z0-9\s+\-*/^_().,]*$/.test(s) && /[A-Za-z0-9]/.test(s);

function findCloseParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/* One operand: a number, a single letter or a maths-like parenthesised group. */
function parseMathAtom(text, i) {
  let m = /^\d+(?:\.\d+)?/.exec(text.slice(i));
  if (m) return { html: m[0], end: i + m[0].length };

  if (text[i] === '(') {
    const close = findCloseParen(text, i);
    if (close > i) {
      const inner = text.slice(i + 1, close);
      if (isMathLikeGroup(inner)) {
        return { html: '(' + mathHtml(inner) + ')', end: close + 1 };
      }
    }
    return null;
  }

  m = /^[A-Za-z]/.exec(text.slice(i));
  if (m) return { html: m[0], end: i + 1 };
  return null;
}

function matchSpokenOp(text, i) {
  SPOKEN_OP_RE.lastIndex = i;
  const m = SPOKEN_OP_RE.exec(text);
  if (!m) return null;
  const key = m[1].replace(/\s+/g, ' ');
  return { value: SPOKEN_OP_MAP[key] || key, end: i + m[1].length };
}
function matchSpokenPower(text, i) {
  SPOKEN_POW_RE.lastIndex = i;
  const m = SPOKEN_POW_RE.exec(text);
  if (!m) return null;
  const key = m[1].replace(/\s+/g, ' ');
  const value = key === 'squared' ? '2' : key === 'cubed' ? '3' : m[2];
  return { value: value, end: i + m[1].length };
}
function matchWholePower(text, i) {
  SPOKEN_WHOLE_POW_RE.lastIndex = i;
  const m = SPOKEN_WHOLE_POW_RE.exec(text);
  if (!m) return null;
  const value = m[1].replace(/\s+/g, ' ') === 'whole square' ? '2' : '3';
  return { value: value, end: i + m[1].length };
}

/* Parse a spoken expression starting at `start`.
   Returns { html, start, end } or null when the text is not maths. */
function parseSpokenMath(text, start) {
  /* Must begin on a word boundary — otherwise the tail of a word ("squared")
     would be mistaken for a variable. */
  if (start > 0 && /[A-Za-z0-9]/.test(text[start - 1])) return null;

  let i = start;
  const segments = [];
  let hasOperator = false;
  let hasPower = false;
  let realStart = start;

  /* "square root of x" — a prefix rather than a binary operator. */
  const leadPos = skipWs(text, i);
  const lead = matchSpokenOp(text, leadPos);
  if (lead && lead.value === '√') {
    segments.push({ type: 'op', html: '√' });
    hasOperator = true;
    realStart = leadPos;
    i = lead.end;
  }

  const atomPos = skipWs(text, i);
  const first = parseMathAtom(text, atomPos);
  if (!first) return null;
  if (!lead) realStart = atomPos;
  i = first.end;
  segments.push({ type: 'atom', html: first.html });

  const pow = matchSpokenPower(text, skipWs(text, i));
  if (pow) {
    segments[segments.length - 1].html += '<sup>' + pow.value + '</sup>';
    hasPower = true;
    i = pow.end;
  }

  for (;;) {
    const op = matchSpokenOp(text, skipWs(text, i));
    if (!op) break;
    const operand = parseMathAtom(text, skipWs(text, op.end));
    if (!operand) break;                      // dangling operator — stop before it
    segments.push({ type: 'op', html: op.value });
    segments.push({ type: 'atom', html: operand.html });
    hasOperator = true;
    i = operand.end;
    const p2 = matchSpokenPower(text, skipWs(text, i));
    if (p2) {
      segments[segments.length - 1].html += '<sup>' + p2.value + '</sup>';
      hasPower = true;
      i = p2.end;
    }
  }

  const whole = matchWholePower(text, skipWs(text, i));
  let wholePower = null;
  if (whole) { wholePower = whole.value; i = whole.end; }

  if (!hasOperator && !wholePower && !hasPower) return null;

  /* The expression must not run straight into another word. */
  const after = text.slice(i).match(/^\s*(\S)/);
  if (after && /[A-Za-z]/.test(after[1])) return null;

  let html = '';
  let inRadical = false;
  for (const seg of segments) {
    if (seg.type === 'op') {
      if (seg.html === '√') { html += '<span class="sqrt"><span class="sign">√</span><span class="rad">'; inRadical = true; }
      else html += ' ' + seg.html + ' ';
    } else {
      html += inRadical ? seg.html + '</span></span>' : seg.html;
      inRadical = false;
    }
  }
  if (inRadical) html += '</span></span>';

  if (wholePower) {
    html = (hasOperator ? '(' + html + ')' : html) + '<sup>' + wholePower + '</sup>';
  }

  return { html: html, start: realStart, end: i };
}

/* Turn spoken maths inside a string into maths spans. */
function applySpokenMath(text, put) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const res = parseSpokenMath(text, i);
    if (res && res.start >= i) {
      out += text.slice(i, res.start);          // keep any leading spacing outside
      out += put('<span class="math">' + res.html + '</span>');
      i = res.end;
    } else {
      out += text[i];
      i++;
    }
  }
  return out;
}

/* Find maths inside a line of already-escaped text and wrap it. */
function mathify(text) {
  const stash = [];
  const put = (html) => { stash.push(html); return '\uE000' + (stash.length - 1) + '\uE001'; };
  let s = String(text);

  /* 1. Explicit delimiters must be protected before scanning bare commands,
        otherwise a command inside them is replaced with a placeholder that
        KaTeX then receives as if it were part of the TeX source. */
  s = s.replace(/\$([^$\n]{1,400})\$/g, (m, inner) => put('<span class="math">' + mathHtml(inner) + '</span>'));
  s = s.replace(/\\\(([^\\)]{1,400})\\\)/g, (m, inner) => put('<span class="math">' + mathHtml(inner) + '</span>'));

  /* 2. unambiguous LaTeX commands (\frac, \sqrt) with balanced braces, so
        nested commands are handled together inside mathHtml. */
  {
    let out = '';
    let i = 0;
    while (i < s.length) {
      if (s[i] === '\\') {
        const span = readMathCommand(s, i);
        if (span) {
          out += put('<span class="math">' + mathHtml(span.text) + '</span>');
          i = span.end;
          continue;
        }
      }
      out += s[i];
      i++;
    }
    s = out;
  }

  /* 3. plain notation — x^2, (a+b)^2, x_1 */
  s = s.replace(/(^|[^\w\\])((?:[A-Za-z]|\([^()]{1,24}\)))\s*(\^(?:\{[^{}]*\}|-?\d{1,3}|[A-Za-z]))/g,
    (m, pre, base, sup) => pre + put('<span class="math">' + mathHtml(base + sup) + '</span>'));
  s = s.replace(/(^|[^\w\\])((?:[A-Za-z]|\([^()]{1,24}\)))\s*(?:_\{([^{}]*)\}|_([A-Za-z0-9]))/g,
    (m, pre, base, sub, sub2) => pre + put('<span class="math">' + mathHtml(base + '_' + (sub || sub2)) + '</span>'));

  /* 4. bare LaTeX symbols such as \alpha or \sum (grouped into one span) */
  s = s.replace(BARE_COMMAND_RE, (m) => put('<span class="math">' + mathHtml(m) + '</span>'));

  /* 5. spoken maths */
  s = applySpokenMath(s, put);

  /* Restore the stashed maths (a couple of passes, in case one contains another). */
  let out = s;
  for (let n = 0; n < 6; n++) {
    const next = out.replace(/\uE000(\d+)\uE001/g, (_, idx) => stash[+idx]);
    if (next === out) break;
    out = next;
  }
  return out;
}

/* ---------------- Markdown ---------------- */
function inline(t) {
  return t.split(/(`[^`]+`)/).map((p) =>
    p.length > 1 && p[0] === '`' && p.endsWith('`')
      ? '<code>' + p.slice(1, -1) + '</code>'
      : mathify(p.replace(/&lt;br\s*\/?&gt;/gi, '<br>')
        .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*\w])\*(?![\s*])([^*]+?)\*(?!\*)/g, '$1<em>$2</em>')
        .replace(/~~(.+?)~~/g, '<del>$1</del>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'))
  ).join('');
}

const cells = (l) => {
  l = l.trim();
  if (l[0] === '|') l = l.slice(1);
  if (l.endsWith('|')) l = l.slice(0, -1);
  return l.split('|').map((c) => c.trim());
};
const isSep = (l) => !!l && l.includes('|') && l.includes('-') && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);

function renderMD(src) {
  const blocks = [];
  const sourceLines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const markdownLines = [];
  for (let i = 0; i < sourceLines.length;) {
    const opening = sourceLines[i].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!opening || (opening[1][0] === '`' && opening[2].includes('`'))) {
      markdownLines.push(sourceLines[i++]);
      continue;
    }

    const fence = opening[1];
    const info = opening[2].trim();
    const lang = info.split(/\s+/, 1)[0] || '';
    let end = i + 1;
    while (end < sourceLines.length) {
      const closing = sourceLines[end].match(/^ {0,3}(`+|~+)[ \t]*$/);
      if (closing && closing[1][0] === fence[0] && closing[1].length >= fence.length) break;
      end++;
    }

    const code = sourceLines.slice(i + 1, end).join('\n').replace(/\n$/, '');
    blocks.push('<div class="code"><div class="code-head"><span>' + esc(lang || 'code') +
      '</span><button type="button" class="copy" aria-label="Copy code">Copy</button></div><pre><code' +
      (lang ? ' class="language-' + esc(lang) + '"' : '') + '>' +
      esc(code) + '</code></pre></div>');
    markdownLines.push('\u0000' + (blocks.length - 1) + '\u0000');
    i = end < sourceLines.length ? end + 1 : end;
  }
  let text = markdownLines.join('\n');

  /* Display maths: $$...$$ and \[...\] become their own centred block. */
  const mathBlocks = [];
  const stashMathBlock = (expr) => {
    mathBlocks.push('<div class="math-block">' + mathHtml(esc(expr.trim()), true) + '</div>');
    return '\n\u0001' + (mathBlocks.length - 1) + '\u0001\n';
  };
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => stashMathBlock(m));
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => stashMathBlock(m));

  const lines = esc(text).split('\n');
  const out = [];
  let para = [], list = null;

  const flushPara = () => { if (para.length) { out.push('<p>' + inline(para.join('<br>')) + '</p>'); para = []; } };
  const flushList = () => {
    if (!list) return;
    const attr = list.tag === 'ol' && list.start !== 1 ? ' start="' + list.start + '"' : '';
    out.push('<' + list.tag + attr + '>' + list.items.map((i) =>
      '<li' + (i.lvl ? ' style="margin-left:' + i.lvl * 1.4 + 'em"' : '') +
      (i.task !== null ? ' class="task"' : '') + '>' + inline(i.t) + '</li>').join('') + '</' + list.tag + '>');
    list = null;
  };
  const addItem = (tag, lvl, t, start) => {
    flushPara();
    if (!list || (list.tag !== tag && lvl === 0)) { flushList(); list = { tag, start: start || 1, items: [] }; }
    let task = null;
    const tm = t.match(/^\[([ xX])\]\s*(.*)$/);
    if (tm) { task = tm[1].toLowerCase() === 'x'; t = tm[2]; }
    list.items.push({ lvl: Math.min(lvl, 3), t, task });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if ((m = line.match(/^\u0000(\d+)\u0000$/))) { flushPara(); flushList(); out.push(blocks[+m[1]]); }
    else if ((m = line.match(/^\u0001(\d+)\u0001$/))) { flushPara(); flushList(); out.push(mathBlocks[+m[1]]); }
    else if (line.includes('|') && isSep(lines[i + 1])) {
      flushPara(); flushList();
      const head = cells(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(cells(lines[i++]));
      i--;
      out.push('<div class="tbl"><table><thead><tr>' + head.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + head.map((_, k) => '<td>' + inline(r[k] || '') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>');
    }
    else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flushPara(); flushList(); out.push('<hr>'); }
    else if ((m = line.match(/^(#{1,6})\s+(.*)/))) { flushPara(); flushList(); out.push('<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>'); }
    else if ((m = line.match(/^(\s*)[-*•]\s+(.*)/))) addItem('ul', Math.floor(m[1].length / 2), m[2]);
    else if ((m = line.match(/^(\s*)(\d+)[.)]\s+(.*)/))) addItem('ol', Math.floor(m[1].length / 2), m[3], +m[2]);
    else if ((m = line.match(/^&gt;\s?(.*)/))) { flushPara(); flushList(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>'); }
    else if (!line.trim()) { flushPara(); flushList(); }
    else { flushList(); para.push(line); }
  }
  flushPara(); flushList();
  return out.join('');
}

/* ---------------- State ---------------- */
const state = {
  conversations: readStore(STORE.conversations, []),
  images: readStore(STORE.images, []),
  currentId: readStore(STORE.lastConv, null),
  view: 'chat',
  quality: 'standard',
  ratio: '1:1',
  busy: false,
  controller: null,
  filter: 'all',
  search: '',
  selectMode: false,
  selected: new Set(),
  pendingRender: null,
  preferences: readStore(STORE.preferences, { enabled: true, notes: '' }),
  inferred: readStore(STORE.inferred, { counts: {} }),
  pendingAttachments: [],
  imageGenerating: false,
};

if (!Array.isArray(state.conversations)) state.conversations = [];
if (!Array.isArray(state.images)) state.images = [];
if (!state.preferences || typeof state.preferences !== 'object' || Array.isArray(state.preferences)) {
  state.preferences = { enabled: true, notes: '' };
}
state.preferences = {
  enabled: state.preferences.enabled === true,
  notes: typeof state.preferences.notes === 'string' ? state.preferences.notes.slice(0, 1200) : '',
};
if (!state.inferred || typeof state.inferred !== 'object' || Array.isArray(state.inferred)) {
  state.inferred = { counts: {} };
}
if (!state.inferred.counts || typeof state.inferred.counts !== 'object' || Array.isArray(state.inferred.counts)) {
  state.inferred.counts = {};
}

function currentConv() {
  return state.conversations.find((c) => c.id === state.currentId) || null;
}
function ensureConv() {
  let conv = currentConv();
  if (!conv) {
    conv = { id: uid(), title: 'New chat', createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    state.conversations.unshift(conv);
    state.currentId = conv.id;
    persistConversations();
  }
  return conv;
}
function persistConversations() {
  if (
    !writeStore(STORE.conversations, state.conversations.slice(0, 80)) ||
    !writeStore(STORE.lastConv, state.currentId)
  ) toast('Conversation storage is full or unavailable. Export your Qelari data before leaving this page.', 'err', 5000);
}
function persistImages() {
  if (!writeStore(STORE.images, state.images.slice(0, 300))) {
    toast('Image metadata could not be saved in this browser. Export your Qelari data before leaving this page.', 'err', 5000);
  }
}

/* Conversation metadata and image bytes remain in this account-scoped browser store. */
const MEDIA_DB_NAME = `qelari.media.v1.${ACCOUNT_SCOPE}`;
const MEDIA_MAX_ITEMS = 300;
const MEDIA_MAX_BYTES = 180 * 1024 * 1024;
const MEDIA_MAX_UPLOAD_BYTES = 60 * 1024 * 1024;
const imageObjectUrls = new Map();
const imageBlobs = new Map();
const imageSourcePromises = new Map();

function openMediaDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('This browser does not support local image storage.'));
      return;
    }
    const request = indexedDB.open(MEDIA_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open local image storage.'));
  });
}

async function saveMediaBlob(id, blob, createdAt, name) {
  if (!(blob instanceof Blob)) throw new Error('Invalid image data.');
  const record = { id, blob, createdAt: createdAt || Date.now(), name: name || '', bytes: blob.size };
  const db = await openMediaDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('images', 'readwrite');
      const store = tx.objectStore('images');
      const all = store.getAll();
      all.onsuccess = () => {
        const records = all.result.filter((item) => item.id !== id).concat(record);
        const uploads = records.filter((item) => item.id.startsWith('upload-'));
        const uploadBytes = uploads.reduce((total, item) => total + item.bytes, 0);
        if (uploadBytes > MEDIA_MAX_UPLOAD_BYTES) {
          tx.abort();
          reject(new Error('Local image attachments have reached the 60 MB storage limit.'));
          return;
        }
        const totalBytes = records.reduce((total, item) => total + Number(item.bytes || item.blob?.size || 0), 0);
        if (records.length > MEDIA_MAX_ITEMS || totalBytes > MEDIA_MAX_BYTES) {
          tx.abort();
          reject(new Error('Local image storage is full. Export your Qelari data or delete images before adding more.'));
          return;
        }
        store.put(record);
      };
      all.onerror = () => reject(all.error || new Error('Could not update local image storage.'));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Could not save this image locally.'));
      tx.onabort = () => reject(tx.error || new Error('Local image storage was interrupted.'));
    });
  } finally {
    db.close();
  }
}

async function readMediaBlob(id) {
  const db = await openMediaDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('images', 'readonly').objectStore('images').get(id);
      request.onsuccess = () => resolve(request.result ? request.result.blob : null);
      request.onerror = () => reject(request.error || new Error('Could not read local image storage.'));
    });
  } finally {
    db.close();
  }
}

async function readMediaRecords() {
  const db = await openMediaDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('images', 'readonly').objectStore('images').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not read local image storage.'));
    });
  } finally {
    db.close();
  }
}

async function removeUnusedUploadMedia() {
  const referenced = new Set(state.pendingAttachments.map((item) => item.id));
  state.conversations.forEach((conv) => {
    (conv.messages || []).forEach((message) => {
      (message.attachments || []).forEach((attachment) => referenced.add(attachment.id));
    });
  });
  try {
    const records = await readMediaRecords();
    for (const record of records) {
      if (record.id.startsWith('upload-') && !referenced.has(record.id)) {
        await deleteMediaBlob(record.id);
      }
    }
  } catch (error) {
    console.warn('Could not clean up unused local image attachments.', error);
  }
}

async function deleteMediaBlob(id) {
  const db = await openMediaDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('images', 'readwrite');
      tx.objectStore('images').delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Could not remove the local image.'));
    });
  } finally {
    db.close();
  }
  const objectUrl = imageObjectUrls.get(id);
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  imageObjectUrls.delete(id);
  imageBlobs.delete(id);
  imageSourcePromises.delete(id);
}

async function resolveImageSource(image) {
  if (imageObjectUrls.has(image.id)) return imageObjectUrls.get(image.id);
  if (imageSourcePromises.has(image.id)) return imageSourcePromises.get(image.id);
  const pending = (async () => {
    let blob = await readMediaBlob(image.id);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    imageObjectUrls.set(image.id, url);
    return url;
  })();
  imageSourcePromises.set(image.id, pending);
  try {
    return await pending;
  } finally {
    imageSourcePromises.delete(image.id);
  }
}

function showImageUnavailable(element, message) {
  element.removeAttribute('src');
  element.alt = message;
  const figure = element.closest('figure');
  const caption = figure && figure.querySelector('figcaption');
  if (caption) caption.textContent = message;
}

async function setImageSource(element, image) {
  element.onerror = () => {
    element.onerror = null;
    showImageUnavailable(element, 'Image could not be loaded. Check your connection and try again.');
  };
  try {
    const source = await resolveImageSource(image);
    if (source && element.isConnected) element.src = source;
    else if (!source && element.isConnected) {
      showImageUnavailable(
        element,
        image.cacheFailed ? 'This image was not cached and is no longer available.' : 'This image is missing from this device.',
      );
    }
  } catch (error) {
    console.warn('Could not load the locally cached image.', error);
    if (element.isConnected) showImageUnavailable(element, 'This image could not be loaded from this device.');
  }
}

/* ---------------- Markdown task list polish ---------------- */
function decorateTasks(root) {
  root.querySelectorAll('li.task').forEach((li) => {
    if (li.querySelector('.tick')) return;
    const box = document.createElement('span');
    box.className = 'tick';
    box.style.cssText = 'display:inline-block;width:14px;height:14px;border-radius:4px;border:1.5px solid var(--line-2);margin-right:8px;vertical-align:-2px;position:relative;flex-shrink:0';
    li.style.listStyle = 'none';
    li.style.marginLeft = '-22px';
    li.style.paddingLeft = '22px';
    li.insertBefore(box, li.firstChild);
  });
}

/* ---------------- Chat rendering ---------------- */
const chat = $('chat');
/* NOTE: #chatScroll is only the padded content wrapper — #chatView is the
   element that actually scrolls. All scrolling must target chatScroller. */
const chatScroller = $('chatView');

/* Auto-scroll behaviour.
   `stick` means "keep pinned to the newest message".
   It is only released when the visitor deliberately scrolls away from the
   bottom — a shrinking list (the chat is cleared) or content growing underneath
   must never cancel auto-scroll, otherwise streaming replies stop following
   along and the composer ends up covering the last message. */
let stick = true;
let lastScrollTop = 0;
let lastScrollHeight = 0;
let userIntent = false;
let intentTimer = null;

const ATTACH_PX = 24;   // how close to the bottom counts as "at the latest message"

function markIntent() {
  userIntent = true;
  clearTimeout(intentTimer);
  intentTimer = setTimeout(() => { userIntent = false; }, 300);
}

function updateScrollFab() {
  $('toBottom').classList.toggle('show', !stick && state.view === 'chat');
}

function scrollHandler() {
  const st = chatScroller.scrollTop;
  const sh = chatScroller.scrollHeight;
  const gap = sh - st - chatScroller.clientHeight;
  const shrank = sh < lastScrollHeight - 2;      // the list was replaced/reset
  const wentUp = st < lastScrollTop - 1;         // the scroll position moved up

  if (shrank) {
    stick = true;                                // stay pinned after a reset
  } else if (userIntent || wentUp) {
    stick = gap < ATTACH_PX;                     // a real gesture decides
  } else if (gap < ATTACH_PX) {
    stick = true;                                // back at the newest message
  }

  lastScrollTop = st;
  lastScrollHeight = sh;
  updateScrollFab();
}
chatScroller.addEventListener('scroll', scrollHandler, { passive: true });
chatScroller.addEventListener('wheel', markIntent, { passive: true });
chatScroller.addEventListener('touchmove', markIntent, { passive: true });
chatScroller.addEventListener('touchstart', markIntent, { passive: true });

const toBottom = (force) => {
  if (force) stick = true;
  if (!stick) return;
  requestAnimationFrame(() => {
    chatScroller.scrollTop = chatScroller.scrollHeight;
    lastScrollTop = chatScroller.scrollTop;
    lastScrollHeight = chatScroller.scrollHeight;
    updateScrollFab();
  });
};

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

const SUGGESTIONS = [
  { icon: '<circle cx="12" cy="8" r="3.4"/><path d="M5 20a7 7 0 0 1 14 0"/>', text: 'What can Qelari help with?' },
  { icon: '<path d="M12 3 3 7l9 4 9-4-9-4Z"/><path d="M3 12l9 4 9-4M3 17l9 4 9-4"/>', text: 'Explain a difficult idea' },
  { icon: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="m4 16 4.5-4a2 2 0 0 1 2.6 0L16 16"/>', text: 'Create an image for me' },
  { icon: '<path d="M12 3v18M5 10l7-7 7 7"/>', text: 'Explain how TCP works' },
];

function showWelcome() {
  chat.innerHTML =
    '<div class="welcome">' +
    '<span class="welcome-badge"><span class="dot"></span>Powered by Zunari</span>' +
    '<h2>' + greeting() + '</h2>' +
    '<p>Ask Qelari anything, or switch to Image Studio to create something visual. Your conversations and images stay on this device.</p>' +
    '<div class="suggestions">' +
    SUGGESTIONS.map((s) => '<button class="suggestion" type="button" data-prompt="' + esc(s.text) + '">' +
      '<svg viewBox="0 0 24 24">' + s.icon + '</svg><span>' + esc(s.text) + '</span></button>').join('') +
    '</div></div>';
}

function formatTime(ts) {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? timeLabel(ts) : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' · ' + timeLabel(ts);
}

function msgActions(role, index) {
  if (role === 'user') {
    return '<div class="msg-actions">' +
      '<button type="button" data-act="copy" aria-label="Copy message"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2.2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>Copy</button>' +
      '<button type="button" data-act="edit" aria-label="Edit message"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z"/></svg>Edit</button>' +
      '</div>';
  }
  return '<div class="msg-actions">' +
    '<button type="button" data-act="copy" aria-label="Copy reply"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2.2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>Copy</button>' +
    '<button type="button" data-act="regen" aria-label="Regenerate reply"><svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 6.1"/><path d="M20 5v6h-6"/></svg>Regenerate</button>' +
    '<button type="button" data-act="export" aria-label="Export chat"><svg viewBox="0 0 24 24"><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 20h14"/></svg>Export</button>' +
    '</div>';
}

function highlightRenderedCode(root) {
  if (!window.hljs) return;
  root.querySelectorAll('pre code:not(.hljs)').forEach((block) => window.hljs.highlightElement(block));
}

function attachmentMarkup(attachment) {
  const alt = attachment.name || 'Attached image';
  return '<figure class="user-attachment"><img data-local-image="' + esc(attachment.id) +
    '" alt="' + esc(alt) + '" title="View full-size image" role="button" tabindex="0" loading="lazy"><figcaption>' + esc(alt) +
    '</figcaption></figure>';
}

function generatedImageMarkup(image) {
  const alt = image.prompt || 'Generated image';
  return '<figure class="chat-image"><img data-local-image="' + esc(image.id) +
    '" alt="' + esc(alt) + '" title="View full-size image" role="button" tabindex="0" loading="lazy"><figcaption>' + esc(alt) +
    '</figcaption><button type="button" data-download-chat-image="' + esc(image.id) +
    '">Download image</button></figure>';
}

function addRow(role, content, ts, index, message) {
  const row = document.createElement('div');
  const isUser = role === 'user';
  row.className = 'msg ' + (isUser ? 'user' : 'bot');
  row.dataset.index = index;
  if (!isUser) row.innerHTML = '<div class="avatar" aria-hidden="true">Q</div>';
  const body = document.createElement('div');
  body.className = 'msg-body';
  if (isUser) {
    const attachments = Array.isArray(message && message.attachments) ? message.attachments : [];
    body.innerHTML = '<div class="msg-meta"><span>' + esc(formatTime(ts)) + '</span></div>' +
      '<div class="bubble">' + mathify(esc(content)) + attachments.map(attachmentMarkup).join('') +
      (attachments.length ? '<p class="attachment-note">Images stay on this device. This text-only model cannot inspect their pixels.</p>' : '') +
      '</div>' + msgActions('user', index);
  } else {
    body.innerHTML = '<div class="msg-meta"><span class="who">Qelari</span><span>·</span><span>' + esc(formatTime(ts)) + '</span></div>' +
      '<div class="md">' + content + (message && message.image ? generatedImageMarkup(message.image) : '') +
      '</div>' + msgActions('bot', index);
  }
  row.appendChild(body);
  chat.appendChild(row);
  body.querySelectorAll('[data-local-image]').forEach((imageElement) => {
    const imageId = imageElement.dataset.localImage;
    const imageRecord = !isUser
      ? message && message.image
      : (message.attachments || []).find((attachment) => attachment.id === imageId);
    if (imageRecord) setImageSource(imageElement, imageRecord);
  });
  highlightRenderedCode(body);
  decorateTasks(row);
  toBottom();
  return body;
}

function renderConversation(conv) {
  chat.innerHTML = '';
  if (!conv || !conv.messages.length) {
    showWelcome();
    return;
  }
  conv.messages.forEach((m, i) => {
    addRow(m.role, m.role === 'user' ? m.content : renderMD(m.content), m.ts || Date.now(), i, m);
  });
  toBottom(true);
}

/* ---------------- Composer ---------------- */
const form = $('form');
const input = $('input');
const sendBtn = $('sendBtn');
const chatImageBtn = $('chatImageBtn');
const attachBtn = $('attachBtn');
const imageUpload = $('imageUpload');
const attachmentTray = $('attachmentTray');

function updateComposerControls() {
  const hasText = Boolean(input.value.trim());
  const canSend = hasText || state.pendingAttachments.length > 0;
  sendBtn.disabled = state.busy ? false : state.imageGenerating || !canSend;
  chatImageBtn.disabled = state.busy || state.imageGenerating || !hasText || input.value.trim().length > 1000;
  attachBtn.disabled = state.busy || state.imageGenerating;
  $('chatMeta').textContent = state.busy ? 'Generating…' : state.imageGenerating ? 'Generating image…' : '';
}

function renderAttachmentTray() {
  attachmentTray.innerHTML = '';
  attachmentTray.classList.toggle('hidden', state.pendingAttachments.length === 0);
  state.pendingAttachments.forEach((attachment) => {
    const chip = document.createElement('div');
    chip.className = 'attachment-chip';
    chip.innerHTML = '<img alt="' + esc(attachment.name) + '">' +
      '<button type="button" aria-label="Remove ' + esc(attachment.name) +
      '" data-remove-attachment="' + esc(attachment.id) +
      '"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button>';
    const url = imageObjectUrls.get(attachment.id);
    if (url) chip.querySelector('img').src = url;
    attachmentTray.appendChild(chip);
  });
  updateComposerControls();
}

function autoGrow() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 190) + 'px';
}
input.addEventListener('input', () => {
  autoGrow();
  updateComposerControls();
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && DESKTOP) {
    e.preventDefault();
    if (!sendBtn.disabled) form.requestSubmit();
  }
});

function setBusy(v) {
  state.busy = v;
  sendBtn.classList.toggle('stop', v);
  updateComposerControls();
  sendBtn.setAttribute('aria-label', v ? 'Stop generating' : 'Send message');
  $('sendIcon').innerHTML = v
    ? '<rect x="6.5" y="6.5" width="11" height="11" rx="2.2" class="stop-icon"/>'
    : '<path d="M12 19V5M5 12l7-7 7 7"/>';
  $('chatMeta').textContent = v ? 'Generating…' : '';
}

form.addEventListener('click', (e) => { if (e.target === form) input.focus(); });

/* Keep the on-screen keyboard open when the send button is tapped, while still
   letting the native click fire so the form submits. Cancelling pointerdown
   suppresses the focus shift (and the legacy mouse events) but never the click,
   so this works identically with a mouse, a finger and a stylus. */
sendBtn.addEventListener('pointerdown', (e) => e.preventDefault());
sendBtn.addEventListener('mousedown', (e) => e.preventDefault());

/* Safety net: if a tap never turns into a click (some older mobile browsers),
   act on the touch itself instead of letting the button die silently. */
let btnClickSeen = false;
sendBtn.addEventListener('click', () => { btnClickSeen = true; });
sendBtn.addEventListener('touchend', () => {
  setTimeout(() => {
    if (btnClickSeen) { btnClickSeen = false; return; }   // the normal click path handled it
    if (state.busy) { stopGeneration(); return; }
    if (input.value.trim() || state.pendingAttachments.length) form.requestSubmit();
  }, 140);
}, { passive: true });

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (state.busy) { stopGeneration(); return; }
  const text = input.value.trim();
  if (!text && !state.pendingAttachments.length) return;
  send(text, state.pendingAttachments.slice());
});

attachBtn.addEventListener('click', () => imageUpload.click());
imageUpload.addEventListener('change', async () => {
  const selected = Array.from(imageUpload.files || []);
  imageUpload.value = '';
  const supportedTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  for (const file of selected) {
    if (state.pendingAttachments.length >= 4) {
      toast('You can attach up to 4 images per message.', 'err');
      break;
    }
    if (!supportedTypes.has(file.type)) {
      toast('Choose a PNG, JPEG, WebP, or GIF image.', 'err');
      continue;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast('Each image must be 10 MB or smaller.', 'err');
      continue;
    }
    const id = 'upload-' + uid();
    try {
      await saveMediaBlob(id, file, Date.now(), file.name);
      imageObjectUrls.set(id, URL.createObjectURL(file));
      state.pendingAttachments.push({ id, name: file.name, type: file.type });
      renderAttachmentTray();
    } catch (error) {
      console.error('Could not save the selected image on this device.', error);
      toast(error.message || 'Could not save that image locally. Check available browser storage and try again.', 'err', 4200);
    }
  }
});

attachmentTray.addEventListener('click', async (event) => {
  const remove = event.target.closest('[data-remove-attachment]');
  if (!remove) return;
  const id = remove.dataset.removeAttachment;
  state.pendingAttachments = state.pendingAttachments.filter((item) => item.id !== id);
  renderAttachmentTray();
  try {
    await deleteMediaBlob(id);
  } catch (error) {
    console.error('Could not remove the local image.', error);
  }
});

chatImageBtn.addEventListener('click', generateChatImage);

async function send(text, attachments) {
  if (state.imageGenerating) return;
  const conv = ensureConv();
  if (!conv.messages.length) chat.innerHTML = '';
  const attached = Array.isArray(attachments) ? attachments : state.pendingAttachments.slice();
  state.pendingAttachments = [];
  renderAttachmentTray();

  input.value = '';
  autoGrow();
  setBusy(true);

  const ts = Date.now();
  const userMessage = { role: 'user', content: text, ts };
  if (attached.length) userMessage.attachments = attached;
  conv.messages.push(userMessage);
  recordPersonalizationSignals(text);
  addRow('user', text, ts, conv.messages.length - 1, userMessage);
  touchConv(conv);
  renderSidebar();
  toBottom(true);   // always jump to the newest message when a message is sent

  const botTs = Date.now();
  const botIndex = conv.messages.length;
  const bot = addRow('bot', statusHTML('Thinking'), botTs, botIndex);

  let reply = '';
  let failed = false;
  let stopped = false;

  const controller = new AbortController();
  state.controller = controller;

  const handle = (line) => {
    if (!line.startsWith('data: ')) return;
    const payload = line.slice(6);
    if (payload === '[DONE]') return;
    let data;
    try { data = JSON.parse(payload); } catch (e) { return; }
    if (data._status) { bot.querySelector('.md').innerHTML = statusHTML(data._status); reply = ''; scheduleRender(); }
    if (data._error) { failed = true; bot.querySelector('.md').innerHTML = '<p class="error">' + esc(data._error) + '</p>'; }
    const piece = data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content;
    if (piece) { reply += piece; scheduleRender(); }
  };

  const scheduleRender = () => {
    if (state.pendingRender) return;
    state.pendingRender = requestAnimationFrame(() => {
      state.pendingRender = null;
      bot.querySelector('.md').innerHTML = renderMD(reply);
      highlightRenderedCode(bot);
      decorateTasks(bot);
      toBottom();
    });
  };

  try {
    const res = await fetch('/api/qelari/chat', {
      method: 'POST',
      headers: qelariHeaders(),
      body: JSON.stringify({
        messages: conv.messages.map((message) => ({
          role: message.role,
          content: message.content + (message.attachments && message.attachments.length
            ? '\n\n[The user attached one or more images, but image data is unavailable to this text-only model. Do not infer image contents; ask for a text description if needed.]'
            : ''),
        })),
        preferences: state.preferences.enabled
          ? { enabled: true, notes: combinedPreferenceNotes() }
          : null,
      }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      let detail = 'The chat request could not be completed.';
      try {
        const error = await res.json();
        if (typeof error?.error === 'string') detail = error.error;
      } catch {
        // The provider may return a non-JSON error response.
      }
      throw new Error(detail);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      lines.forEach(handle);
    }
    if (buffer) handle(buffer);

    if (failed) throw new Error('failed');
    if (!reply) throw new Error('Empty reply');
    conv.messages.push({ role: 'assistant', content: reply, ts: Date.now() });
    touchConv(conv);
    persistConversations();
  } catch (err) {
    stopped = err && err.name === 'AbortError';
    if (!failed && !stopped) {
      bot.querySelector('.md').innerHTML = '<p class="error">Connection error. Please try again.</p>';
    } else if (stopped && reply) {
      conv.messages.push({ role: 'assistant', content: reply, ts: Date.now() });
    }
    if (stopped) toast('Generation stopped', 'info', 1800);
  } finally {
    state.controller = null;
    setBusy(false);
    persistConversations();
    renderSidebar();
  }
}

function stopGeneration() {
  if (state.controller) state.controller.abort();
}

function statusHTML(label) {
  return '<div class="status">' + esc(label) + '<span class="dots"><i></i><i></i><i></i></span></div>';
}

function touchConv(conv) {
  conv.updatedAt = Date.now();
  if (!conv.title || conv.title === 'New chat') {
    const first = conv.messages.find((m) => m.role === 'user');
    if (first) conv.title = first.content.slice(0, 48) + (first.content.length > 48 ? '…' : '');
  }
  // keep newest first
  state.conversations = [conv].concat(state.conversations.filter((c) => c.id !== conv.id));
}

/* ---------------- Message actions ---------------- */
function openChatImage(imageElement) {
  const row = imageElement.closest('.msg');
  const conv = currentConv();
  const message = conv && conv.messages[Number(row && row.dataset.index)];
  if (!message) return;

  if (message.role === 'user') {
    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    const index = attachments.findIndex((attachment) => attachment.id === imageElement.dataset.localImage);
    if (index >= 0) openLightbox(index, attachments);
  } else if (message.image && message.image.id === imageElement.dataset.localImage) {
    openLightbox(0, [message.image]);
  }
}

chat.addEventListener('click', async (e) => {
  const imageDownload = e.target.closest('[data-download-chat-image]');
  if (imageDownload) {
    const id = imageDownload.dataset.downloadChatImage;
    const image = state.images.find((item) => item.id === id) ||
      state.conversations.flatMap((conv) => conv.messages || [])
        .map((message) => message.image)
        .find((item) => item && item.id === id);
    if (image) await downloadImage(image);
    else toast('This image is not available in the saved conversation.', 'err');
    return;
  }

  const imagePreview = e.target.closest('.user-attachment img, .chat-image img');
  if (imagePreview) {
    openChatImage(imagePreview);
    return;
  }

  const copy = e.target.closest('.copy');
  if (copy) {
    const code = copy.closest('.code').querySelector('code').textContent;
    const ok = await copyText(code);
    copy.textContent = ok ? 'Copied' : 'Failed';
    toast(ok ? 'Code copied to clipboard' : 'Copy failed', ok ? 'ok' : 'err', 1600);
    setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
    return;
  }

  const suggestion = e.target.closest('.suggestion');
  if (suggestion) {
    input.value = suggestion.dataset.prompt;
    autoGrow();
    updateComposerControls();
    input.focus();
    return;
  }

  const act = e.target.closest('[data-act]');
  if (!act) return;
  const row = act.closest('.msg');
  const idx = +row.dataset.index;
  const conv = currentConv();
  if (!conv) return;
  const msg = conv.messages[idx];
  if (!msg) return;

  if (act.dataset.act === 'copy') {
    const ok = await copyText(msg.content);
    toast(ok ? 'Copied to clipboard' : 'Copy failed', ok ? 'ok' : 'err', 1600);
  } else if (act.dataset.act === 'edit') {
    input.value = msg.content;
    autoGrow();
    updateComposerControls();
    input.focus();
    toast('Edited into the composer', 'info', 1800);
    conv.messages.splice(idx, conv.messages.length - idx);
    persistConversations();
    removeUnusedUploadMedia();
    renderConversation(conv);
  } else if (act.dataset.act === 'regen') {
    const userMsg = [...conv.messages].reverse().find((m) => m.role === 'user');
    if (!userMsg) return;
    conv.messages = conv.messages.filter((m, i) => i < idx);
    persistConversations();
    renderConversation(conv);
    if (msg.image) generateImageInChat(userMsg.content, { conversation: conv, recordUser: false });
    else send(userMsg.content);
  } else if (act.dataset.act === 'export') {
    const md = conv.messages.map((m) => (m.role === 'user' ? '**You:** ' + m.content : m.content)).join('\n\n---\n\n');
    const blob = new Blob([md], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (conv.title || 'qelari-chat').replace(/[^\w\-]+/g, '-').slice(0, 48) + '.md';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Chat exported as Markdown', 'ok');
  }
});

/* ---------------- Sidebar / history ---------------- */
const convList = $('convList');

function renderSidebar() {
  const q = state.search.trim().toLowerCase();
  const list = state.conversations.filter((c) => {
    if (!q) return true;
    if ((c.title || '').toLowerCase().includes(q)) return true;
    return c.messages.some((m) => m.content.toLowerCase().includes(q));
  });

  $('convTotal').textContent = state.conversations.length ? state.conversations.length + '' : '';

  if (!list.length) {
    convList.innerHTML = '<div style="padding:14px 10px;font-size:.82rem;color:var(--text-3)">' +
      (q ? 'No chats match “' + esc(state.search) + '”.' : 'No chats yet. Start a conversation.') + '</div>';
    return;
  }

  const groups = [];
  list.forEach((c) => {
    const g = dayGroup(c.updatedAt);
    let grp = groups.find((x) => x.name === g);
    if (!grp) { grp = { name: g, items: [] }; groups.push(grp); }
    grp.items.push(c);
  });

  convList.innerHTML = groups.map((grp) =>
    '<div class="conv-group"><div class="side-label" style="padding:10px 8px 4px">' + esc(grp.name) + '</div>' +
    grp.items.map((c) => {
      const last = c.messages.length ? c.messages[c.messages.length - 1] : null;
      const preview = last ? (last.role === 'user' ? last.content : last.content) : 'No messages yet';
      return '<div class="conv-item ' + (c.id === state.currentId ? 'active' : '') + '" data-id="' + c.id + '" role="button" tabindex="0">' +
        '<div class="conv-main">' +
        '<div class="conv-title">' + esc(c.title || 'New chat') + '</div>' +
        '<div class="conv-sub">' + esc(preview.replace(/[#*_`>]/g, '').slice(0, 60)) + ' · ' + relativeTime(c.updatedAt) + '</div>' +
        '</div>' +
        '<div class="conv-actions">' +
        '<button class="ic" data-conv="rename" title="Rename"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z"/></svg></button>' +
        '<button class="ic danger" data-conv="delete" title="Delete"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13"/></svg></button>' +
        '</div></div>';
    }).join('') + '</div>'
  ).join('');
}

convList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-conv]');
  const item = e.target.closest('.conv-item');
  if (!item) return;
  const id = item.dataset.id;
  if (btn) {
    e.stopPropagation();
    const conv = state.conversations.find((c) => c.id === id);
    if (!conv) return;
    if (btn.dataset.conv === 'rename') openRename(conv);
    if (btn.dataset.conv === 'delete') deleteConversation(conv);
    return;
  }
  openConversation(id);
});
convList.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const item = e.target.closest('.conv-item');
  if (!item) return;
  e.preventDefault();
  openConversation(item.dataset.id);
});

function openConversation(id) {
  const conv = state.conversations.find((c) => c.id === id);
  if (!conv) return;
  state.currentId = id;
  writeStore(STORE.lastConv, id);
  setView('chat');
  renderConversation(conv);
  renderSidebar();
  closeSidebar();
}

function newChat() {
  state.currentId = null;
  writeStore(STORE.lastConv, null);
  showWelcome();
  renderSidebar();
  setView('chat');
  closeSidebar();
  if (DESKTOP) input.focus();
}

function deleteConversation(conv) {
  const ok = window.confirm('Delete “' + (conv.title || 'this chat') + '”? This cannot be undone.');
  if (!ok) return;
  state.conversations = state.conversations.filter((c) => c.id !== conv.id);
  if (state.currentId === conv.id) {
    state.currentId = null;
    showWelcome();
  }
  persistConversations();
  removeUnusedUploadMedia();
  renderSidebar();
  toast('Chat deleted', 'ok');
}

/* Rename modal */
let renameTarget = null;
function openRename(conv) {
  renameTarget = conv;
  $('renameInput').value = conv.title || '';
  $('renameModal').classList.add('open');
  setTimeout(() => { $('renameInput').focus(); $('renameInput').select(); }, 60);
}
function closeRename() {
  renameTarget = null;
  $('renameModal').classList.remove('open');
}
$('renameCancel').addEventListener('click', closeRename);
$('renameSave').addEventListener('click', () => {
  if (renameTarget) {
    renameTarget.title = $('renameInput').value.trim() || renameTarget.title;
    persistConversations();
    renderSidebar();
    toast('Chat renamed', 'ok', 1600);
  }
  closeRename();
});
$('renameInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('renameSave').click(); }
  if (e.key === 'Escape') closeRename();
});
$('renameModal').addEventListener('click', (e) => { if (e.target === $('renameModal')) closeRename(); });

/* Optional response preferences are kept separate from chat history. */
const preferencesModal = $('preferencesModal');
function closePreferences() {
  preferencesModal.classList.remove('open');
}
function openPreferences() {
  $('preferencesEnabled').checked = state.preferences.enabled;
  $('preferencesNotes').value = state.preferences.notes;
  const learned = inferredPreferenceNotes();
  $('learnedPreferences').textContent = learned
    ? learned.replace('Learned from repeated explicit requests: ', 'Learned locally: ')
    : 'Repeated explicit requests (such as “keep answers brief”) are learned on this device and shared with your custom preferences.';
  preferencesModal.classList.add('open');
  setTimeout(() => $('preferencesEnabled').focus(), 60);
}
$('preferencesBtn').addEventListener('click', openPreferences);
$('preferencesCancel').addEventListener('click', closePreferences);
$('preferencesSave').addEventListener('click', () => {
  const next = {
    enabled: $('preferencesEnabled').checked,
    notes: $('preferencesNotes').value.trim().slice(0, 1200),
  };
  if (!writeStore(STORE.preferences, next)) {
    toast('Could not save preferences in this browser. Check available storage and try again.', 'err', 4200);
    return;
  }
  state.preferences = next;
  closePreferences();
  toast(next.enabled ? 'Personalization saved' : 'Personalization is off', 'ok');
});
$('preferencesClear').addEventListener('click', () => {
  const cleared = { enabled: false, notes: '' };
  const emptyInferred = { counts: {} };
  if (!writeStore(STORE.preferences, cleared) || !writeStore(STORE.inferred, emptyInferred)) {
    toast('Could not clear preferences in this browser.', 'err', 4200);
    return;
  }
  state.preferences = cleared;
  state.inferred = emptyInferred;
  $('preferencesEnabled').checked = false;
  $('preferencesNotes').value = '';
  closePreferences();
  toast('Personalization cleared', 'ok');
});
preferencesModal.addEventListener('click', (event) => {
  if (event.target === preferencesModal) closePreferences();
});
preferencesModal.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closePreferences();
});

const ARCHIVE_FORMAT = 'qelari-local-archive';
const MAX_ARCHIVE_BYTES = 272 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBlob(value, type) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('The archive contains invalid image data.');
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

async function validateImageBlob(blob) {
  if (!SUPPORTED_IMAGE_TYPES.has(blob.type)) return false;
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (blob.type === 'image/png') {
    return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value);
  }
  if (blob.type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (blob.type === 'image/gif') return bytes.length >= 6 && String.fromCharCode(...bytes.subarray(0, 6)).startsWith('GIF8');
  return bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP';
}

async function exportQelariData() {
  const records = await readMediaRecords();
  const totalBytes = records.reduce((sum, record) => sum + Number(record.bytes || record.blob?.size || 0), 0);
  if (totalBytes > MEDIA_MAX_BYTES) throw new Error('Local images exceed the supported export size.');
  const mediaIds = new Set(records.map((record) => record.id));
  const references = [];
  state.conversations.forEach((conversation) => {
    (conversation.messages || []).forEach((message) => {
      references.push(
        ...(message.attachments || []).map((attachment) => attachment.id),
        ...(message.image ? [message.image.id] : []),
      );
    });
  });
  if (state.images.some((image) => !mediaIds.has(image.id)) || references.some((id) => !mediaIds.has(id))) {
    throw new Error('Some chat images are not available in local storage. Download them before exporting.');
  }
  const media = [];
  for (const record of records) {
    if (!(record.blob instanceof Blob) || !await validateImageBlob(record.blob)) {
      throw new Error('A local image could not be validated for export.');
    }
    media.push({
      id: record.id,
      name: typeof record.name === 'string' ? record.name.slice(0, 255) : '',
      type: record.blob.type,
      createdAt: Number(record.createdAt) || Date.now(),
      data: bytesToBase64(await record.blob.arrayBuffer()),
    });
  }
  const archive = {
    format: ARCHIVE_FORMAT,
    version: 1,
    accountId: String(window.QELARI_ACCOUNT_ID),
    exportedAt: new Date().toISOString(),
    conversations: state.conversations.slice(0, 80),
    images: state.images.slice(0, 300).map(({ id, prompt, quality, ratio, createdAt }) => ({
      id, prompt, quality, ratio, createdAt,
    })),
    preferences: state.preferences,
    inferred: state.inferred,
    media,
  };
  const blob = new Blob([JSON.stringify(archive)], { type: 'application/json' });
  if (blob.size > MAX_ARCHIVE_BYTES) throw new Error('The Qelari archive is too large to download.');
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `qelari-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function validateImportedConversation(value) {
  if (
    !value || typeof value !== 'object' || Array.isArray(value) ||
    typeof value.id !== 'string' || !/^[\w-]{1,80}$/.test(value.id) ||
    typeof value.title !== 'string' || value.title.length > 80 ||
    !Array.isArray(value.messages) || value.messages.length > 500 ||
    !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt)
  ) throw new Error('The archive contains an invalid conversation.');
  const messages = value.messages.map((message) => {
    if (
      !message || typeof message !== 'object' || Array.isArray(message) ||
      !['user', 'assistant'].includes(message.role) ||
      typeof message.content !== 'string' || message.content.length > 50_000 ||
      !Number.isFinite(message.ts)
    ) throw new Error('The archive contains an invalid chat message.');
    const clean = { role: message.role, content: message.content, ts: message.ts };
    if (Array.isArray(message.attachments)) {
      if (message.attachments.length > 4) throw new Error('The archive contains too many image attachments.');
      clean.attachments = message.attachments.map((item) => {
        if (
          !item || typeof item !== 'object' ||
          typeof item.id !== 'string' || !/^[\w-]{1,80}$/.test(item.id) ||
          typeof item.name !== 'string' || item.name.length > 255 ||
          !SUPPORTED_IMAGE_TYPES.has(item.type)
        ) throw new Error('The archive contains invalid attachment metadata.');
        return { id: item.id, name: item.name, type: item.type };
      });
    }
    if (message.image && typeof message.image === 'object') {
      const image = message.image;
      if (typeof image.id !== 'string' || !/^[\w-]{1,80}$/.test(image.id)) {
        throw new Error('The archive contains invalid image metadata.');
      }
      clean.image = {
        id: image.id,
        prompt: typeof image.prompt === 'string' ? image.prompt.slice(0, 1000) : '',
        quality: ['draft', 'standard', 'high'].includes(image.quality) ? image.quality : 'standard',
        ratio: ['1:1', '4:3', '16:9', '9:16'].includes(image.ratio) ? image.ratio : '1:1',
        createdAt: Number.isFinite(image.createdAt) ? image.createdAt : message.ts,
      };
    }
    return clean;
  });
  return {
    id: value.id,
    title: value.title,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    messages,
  };
}

async function validateQelariArchive(archive) {
  if (
    !archive || typeof archive !== 'object' || Array.isArray(archive) ||
    archive.format !== ARCHIVE_FORMAT || archive.version !== 1 ||
    archive.accountId !== String(window.QELARI_ACCOUNT_ID) ||
    !Array.isArray(archive.conversations) || archive.conversations.length > 80 ||
    !Array.isArray(archive.images) || archive.images.length > 300 ||
    !Array.isArray(archive.media) || archive.media.length > MEDIA_MAX_ITEMS
  ) throw new Error('This is not a valid Qelari archive for the signed-in account.');
  const conversations = archive.conversations.map(validateImportedConversation);
  if (new Set(conversations.map((conversation) => conversation.id)).size !== conversations.length) {
    throw new Error('The archive contains duplicate conversations.');
  }
  const media = [];
  const mediaIds = new Set();
  let totalBytes = 0;
  let uploadBytes = 0;
  for (const item of archive.media) {
    if (
      !item || typeof item !== 'object' || Array.isArray(item) ||
      typeof item.id !== 'string' || !/^[\w-]{1,80}$/.test(item.id) ||
      mediaIds.has(item.id) || !SUPPORTED_IMAGE_TYPES.has(item.type) ||
      typeof item.data !== 'string' || item.data.length > Math.ceil(MEDIA_MAX_BYTES * 4 / 3)
    ) throw new Error('The archive contains invalid image metadata.');
    mediaIds.add(item.id);
    const blob = base64ToBlob(item.data, item.type);
    totalBytes += blob.size;
    if (item.id.startsWith('upload-')) uploadBytes += blob.size;
    if (totalBytes > MEDIA_MAX_BYTES || uploadBytes > MEDIA_MAX_UPLOAD_BYTES) {
      throw new Error('The archive exceeds Qelari’s local image-storage limits.');
    }
    if (!await validateImageBlob(blob)) throw new Error('The archive contains an invalid image file.');
    media.push({
      id: item.id,
      name: typeof item.name === 'string' ? item.name.slice(0, 255) : '',
      blob,
      bytes: blob.size,
      createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
    });
  }
  const images = archive.images.map((image) => {
    if (
      !image || typeof image !== 'object' || Array.isArray(image) ||
      typeof image.id !== 'string' || !mediaIds.has(image.id) ||
      typeof image.prompt !== 'string' || image.prompt.length > 1000 ||
      !['draft', 'standard', 'high'].includes(image.quality) ||
      !['1:1', '4:3', '16:9', '9:16'].includes(image.ratio) ||
      !Number.isFinite(image.createdAt)
    ) throw new Error('The archive contains invalid gallery data.');
    return {
      id: image.id,
      prompt: image.prompt,
      quality: image.quality,
      ratio: image.ratio,
      createdAt: image.createdAt,
    };
  });
  if (new Set(images.map((image) => image.id)).size !== images.length) {
    throw new Error('The archive contains duplicate gallery images.');
  }
  const preferences = archive.preferences;
  if (
    !preferences || typeof preferences !== 'object' || Array.isArray(preferences) ||
    typeof preferences.enabled !== 'boolean' ||
    typeof preferences.notes !== 'string' || preferences.notes.length > 1200
  ) throw new Error('The archive contains invalid response preferences.');
  const inferred = archive.inferred;
  if (!inferred || typeof inferred !== 'object' || !inferred.counts || typeof inferred.counts !== 'object') {
    throw new Error('The archive contains invalid learned preferences.');
  }
  const counts = {};
  for (const name of ['concise', 'detailed', 'examples', 'formal', 'casual']) {
    const count = inferred.counts[name] || 0;
    if (!Number.isInteger(count) || count < 0 || count > 20) {
      throw new Error('The archive contains invalid learned preferences.');
    }
    counts[name] = count;
  }
  for (const conversation of conversations) {
    for (const message of conversation.messages) {
      const references = [
        ...(message.attachments || []).map((item) => item.id),
        ...(message.image ? [message.image.id] : []),
      ];
      if (references.some((id) => !mediaIds.has(id))) {
        throw new Error('A chat image is missing from the archive.');
      }
    }
  }
  return { conversations, images, media, preferences, inferred: { counts } };
}

async function writeImportedMedia(incoming) {
  const existing = await readMediaRecords();
  const existingIds = new Set(existing.map((record) => record.id));
  const newRecords = incoming.filter((record) => !existingIds.has(record.id));
  const bytes = existing.reduce((sum, record) => sum + Number(record.bytes || record.blob?.size || 0), 0) +
    newRecords.reduce((sum, record) => sum + record.bytes, 0);
  const uploadBytes = existing
    .filter((record) => record.id.startsWith('upload-'))
    .reduce((sum, record) => sum + Number(record.bytes || record.blob?.size || 0), 0) +
    newRecords.filter((record) => record.id.startsWith('upload-'))
      .reduce((sum, record) => sum + record.bytes, 0);
  if (existing.length + newRecords.length > MEDIA_MAX_ITEMS || bytes > MEDIA_MAX_BYTES || uploadBytes > MEDIA_MAX_UPLOAD_BYTES) {
    throw new Error('This device does not have enough Qelari image storage for the import.');
  }
  const db = await openMediaDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('images', 'readwrite');
      const store = tx.objectStore('images');
      newRecords.forEach((record) => store.put(record));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Could not import local images.'));
      tx.onabort = () => reject(tx.error || new Error('Image import was interrupted.'));
    });
  } finally {
    db.close();
  }
  return newRecords.map((record) => record.id);
}

$('exportData').addEventListener('click', async () => {
  try {
    await exportQelariData();
    toast('Qelari data exported', 'ok');
  } catch (error) {
    toast(error.message || 'Qelari data could not be exported.', 'err', 4200);
  }
});
$('importData').addEventListener('click', () => $('importDataFile').click());
$('importDataFile').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  let insertedMedia = [];
  const previous = {
    conversations: state.conversations,
    images: state.images,
    preferences: state.preferences,
    inferred: state.inferred,
    currentId: state.currentId,
  };
  const storageSnapshot = [STORE.conversations, STORE.images, STORE.preferences, STORE.inferred, STORE.lastConv]
    .map((key) => [key, localStorage.getItem(key)]);
  try {
    if (file.size > MAX_ARCHIVE_BYTES) throw new Error('The selected archive is too large.');
    const archive = await validateQelariArchive(JSON.parse(await file.text()));
    const conversationIds = new Set(state.conversations.map((item) => item.id));
    const imageIds = new Set(state.images.map((item) => item.id));
    const conversations = [
      ...state.conversations,
      ...archive.conversations.filter((item) => !conversationIds.has(item.id)),
    ].slice(0, 80);
    const images = [
      ...state.images,
      ...archive.images.filter((item) => !imageIds.has(item.id)),
    ].slice(0, 300);
    insertedMedia = await writeImportedMedia(archive.media);
    if (
      !writeStore(STORE.conversations, conversations) ||
      !writeStore(STORE.images, images) ||
      !writeStore(STORE.preferences, archive.preferences) ||
      !writeStore(STORE.inferred, archive.inferred)
    ) throw new Error('Could not save imported Qelari data in this browser.');
    state.conversations = conversations;
    state.images = images;
    state.preferences = archive.preferences;
    state.inferred = archive.inferred;
    persistConversations();
    renderSidebar();
    renderImages();
    renderGalleryView();
    $('galleryCount').textContent = state.images.length;
    toast('Qelari data imported on this device', 'ok', 4200);
  } catch (error) {
    for (const id of insertedMedia) {
      try {
        await deleteMediaBlob(id);
      } catch (cleanupError) {
        console.error('Could not roll back an incomplete Qelari import.', cleanupError);
      }
    }
    state.conversations = previous.conversations;
    state.images = previous.images;
    state.preferences = previous.preferences;
    state.inferred = previous.inferred;
    state.currentId = previous.currentId;
    storageSnapshot.forEach(([key, value]) => {
      try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      } catch (restoreError) {
        console.error('Could not restore a Qelari local-storage value after import failed.', restoreError);
      }
    });
    toast(error.message || 'Qelari data could not be imported.', 'err', 5000);
  }
});

/* ---------------- Image Studio ---------------- */
const promptBox = $('imagePrompt');
const qualityGrid = $('qualityGrid');
const ratioRow = $('ratioRow');
const generateBtn = $('generateBtn');
const imageGrid = $('imageGrid');
const galleryGrid = $('galleryGrid');
const imageEmpty = $('imageEmpty');
const imageError = $('imageError');
const imageLoading = $('imageLoading');

promptBox.addEventListener('input', () => {
  const len = promptBox.value.length;
  $('imageCharCount').textContent = len + ' / 1000';
  $('imageCharCount').classList.toggle('warn', len > 1000);
  generateBtn.disabled = len === 0 || len > 1000 || imageLoading.classList.contains('hidden') === false;
});
promptBox.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    if (!generateBtn.disabled) generateImage();
  }
});
generateBtn.addEventListener('click', () => {
  if (!generateBtn.disabled) generateImage();
});

qualityGrid.addEventListener('click', (e) => {
  const card = e.target.closest('.quality-card');
  if (!card) return;
  qualityGrid.querySelectorAll('.quality-card').forEach((c) => {
    c.classList.remove('selected');
    c.setAttribute('aria-checked', 'false');
  });
  card.classList.add('selected');
  card.setAttribute('aria-checked', 'true');
  state.quality = card.dataset.quality;
});
ratioRow.addEventListener('click', (e) => {
  const btn = e.target.closest('.ratio-btn');
  if (!btn) return;
  ratioRow.querySelectorAll('.ratio-btn').forEach((b) => {
    b.classList.remove('selected');
    b.setAttribute('aria-checked', 'false');
  });
  btn.classList.add('selected');
  btn.setAttribute('aria-checked', 'true');
  state.ratio = btn.dataset.ratio;
});

async function generateImage() {
  const prompt = promptBox.value.trim();
  if (!prompt) return;
  const ratio = state.ratio;
  const quality = state.quality;

  imageError.classList.add('hidden');
  imageLoading.classList.remove('hidden');
  $('imageLoadingText').textContent = 'Painting your image…';
  generateBtn.disabled = true;

  try {
    const image = await requestGeneratedImage(prompt, quality, ratio);
    addImage(image);
    warmImageCache(image);
    toast(image.cacheFailed ? 'Image generated, but could not be cached. Download it now.' : 'Image ready', image.cacheFailed ? 'err' : 'ok', 4200);
  } catch (err) {
    imageError.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg><span>' +
      esc(err.message || 'Image generation failed. Please try again.') + '</span>';
    imageError.classList.remove('hidden');
  } finally {
    imageLoading.classList.add('hidden');
    generateBtn.disabled = !promptBox.value.trim();
  }
}

async function requestGeneratedImage(prompt, quality, ratio) {
  const res = await fetch('/api/qelari/images', {
    method: 'POST',
    headers: qelariHeaders(),
    body: JSON.stringify({ prompt, quality, ratio }),
  });
  const type = res.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    const data = await res.json();
    throw new Error(data.error || 'Image generation failed.');
  }
  if (res.ok && type.startsWith('image/')) {
    const blob = await res.blob();
    const id = uid();
    const image = {
      id,
      url: URL.createObjectURL(blob),
      prompt,
      quality,
      ratio,
      createdAt: Date.now(),
      local: true,
    };
    imageObjectUrls.set(id, image.url);
    imageBlobs.set(id, blob);
    try {
      await saveMediaBlob(id, blob, image.createdAt);
    } catch (error) {
      image.cacheFailed = true;
      console.error('The generated image could not be saved to local storage.', error);
    }
    return image;
  }
  throw new Error('Unexpected response from the image service.');
}

function warmImageCache(image) {
  resolveImageSource(image).catch((error) => {
    console.warn('The generated image could not be cached on this device.', error);
    toast('The image was generated but could not be saved in this browser. Download it now or it may be lost.', 'err', 5000);
  });
}

async function generateChatImage() {
  return generateImageInChat();
}

async function generateImageInChat(promptOverride, options) {
  if (state.busy || state.imageGenerating) return;
  const prompt = (promptOverride === undefined ? input.value : promptOverride).trim();
  if (!prompt) return;
  if (prompt.length > 1000) {
    toast('Image prompts must be 1000 characters or fewer.', 'err');
    return;
  }

  const conv = options && options.conversation ? options.conversation : ensureConv();
  if (!conv.messages.length) chat.innerHTML = '';
  input.value = '';
  autoGrow();
  if (!options || options.recordUser !== false) {
    const userMessage = { role: 'user', content: prompt, ts: Date.now() };
    conv.messages.push(userMessage);
    recordPersonalizationSignals(prompt);
    addRow('user', prompt, userMessage.ts, conv.messages.length - 1, userMessage);
    touchConv(conv);
    renderSidebar();
    persistConversations();
    toBottom(true);
  }

  const bot = addRow('bot', statusHTML('Creating your image'), Date.now(), conv.messages.length);
  state.imageGenerating = true;
  updateComposerControls();
  $('chatMeta').textContent = 'Generating image…';
  try {
    const image = await requestGeneratedImage(prompt, state.quality, state.ratio);
    addImage(image);
    warmImageCache(image);
    const snapshot = {
      id: image.id,
      url: image.url,
      prompt: image.prompt || prompt,
      quality: image.quality || state.quality,
      ratio: image.ratio || state.ratio,
      createdAt: image.createdAt || Date.now(),
    };
    conv.messages.push({
      role: 'assistant',
      content: 'Here is your generated image.',
      image: snapshot,
      ts: Date.now(),
    });
    touchConv(conv);
    persistConversations();
    if (state.currentId === conv.id) renderConversation(conv);
    toast(image.cacheFailed ? 'Image generated, but could not be cached. Download it now.' : 'Image ready in this conversation', image.cacheFailed ? 'err' : 'ok', 4200);
  } catch (error) {
    const message = error.message || 'Image generation failed. Please try again.';
    if (bot.isConnected && state.currentId === conv.id) {
      const body = bot.querySelector('.md');
      if (body) body.innerHTML = '<p class="error">' + esc(message) + '</p>';
    }
    persistConversations();
    toast(message, 'err', 4200);
  } finally {
    state.imageGenerating = false;
    updateComposerControls();
    if (!state.busy) $('chatMeta').textContent = '';
  }
}

function addImage(img) {
  if (!img) return;
  if (!img.id) img.id = uid();
  if (!img.createdAt) img.createdAt = Date.now();
  state.images = [img].concat(state.images.filter((i) => i.id !== img.id)).slice(0, 300);
  persistImages();
  renderImages();
  renderGalleryView();
  $('galleryCount').textContent = state.images.length;
}

async function deleteImage(id, skipConfirm) {
  const img = state.images.find((i) => i.id === id);
  if (!img) return;
  if (!skipConfirm && !window.confirm('Delete this image? It will be removed from your gallery.')) return;
  state.images = state.images.filter((i) => i.id !== id);
  state.selected.delete(id);
  persistImages();
  renderImages();
  renderGalleryView();
  $('galleryCount').textContent = state.images.length;
  const usedInConversation = state.conversations.some((conversation) =>
    (conversation.messages || []).some((message) => message.image && message.image.id === id),
  );
  if (!usedInConversation) {
    try {
      await deleteMediaBlob(id);
    } catch (error) {
      console.error('Could not clear the local image cache.', error);
    }
  }
  if (!skipConfirm) toast('Image deleted', 'ok');
  updateSelectBar();
}

function imageCard(img, index, list, allowSelect) {
  const el = document.createElement('div');
  el.className = 'img-card' + (state.selected.has(img.id) ? ' selected' : '');
  el.dataset.id = img.id;
  el.innerHTML =
    '<img alt="' + esc((img.prompt || 'Generated image').slice(0, 90)) + '" loading="lazy">' +
    '<span class="badge">' + esc((img.quality || 'standard').toUpperCase()) + '</span>' +
    '<span class="check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m20 6-11 11-5-5"/></svg></span>' +
    '<div class="card-overlay">' +
    '<div class="ov-prompt">' + esc(img.prompt || '') + '</div>' +
    '<div class="ov-row">' +
    '<button class="ov-btn" data-img="view" data-id="' + img.id + '"><svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>View</button>' +
    '<button class="ov-btn" data-img="download" data-id="' + img.id + '"><svg viewBox="0 0 24 24"><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 20h14"/></svg>Save</button>' +
    '<button class="ov-btn danger" data-img="delete" data-id="' + img.id + '"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13"/></svg></button>' +
    '</div></div>';
  setImageSource(el.querySelector('img'), img);
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-img]');
    if (allowSelect && state.selectMode) {
      e.preventDefault();
      toggleSelect(img.id);
      return;
    }
    if (!btn) { openLightbox(index, list); return; }
    e.stopPropagation();
    if (btn.dataset.img === 'view') openLightbox(index, list);
    if (btn.dataset.img === 'download') downloadImage(img);
    if (btn.dataset.img === 'delete') deleteImage(img.id);
  });
  return el;
}

function renderImages() {
  imageGrid.innerHTML = '';
  imageEmpty.classList.toggle('hidden', state.images.length > 0);
  const list = state.images.slice(0, 12);
  list.forEach((img, i) => imageGrid.appendChild(imageCard(img, i, list, false)));
  $('galleryCount').textContent = state.images.length;
}

function renderGalleryView() {
  const q = state.search.trim().toLowerCase();
  const now = Date.now();
  let list = state.images.filter((i) => {
    if (q && !(i.prompt || '').toLowerCase().includes(q)) return false;
    const age = now - (i.createdAt || now);
    if (state.filter === 'today') return age < 86400000;
    if (state.filter === 'week') return age < 7 * 86400000;
    if (state.filter === 'month') return age < 30 * 86400000;
    return true;
  });
  list = list.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  galleryGrid.innerHTML = '';
  list.forEach((img, i) => galleryGrid.appendChild(imageCard(img, i, list, true)));
  galleryGrid.classList.toggle('select-mode', state.selectMode);
  $('galleryEmpty').classList.toggle('hidden', list.length > 0);
  $('galleryStat').textContent = list.length + (list.length === 1 ? ' image' : ' images') +
    (state.images.length !== list.length ? ' of ' + state.images.length : '');
  updateSelectBar();
}

/* ---------- Bulk selection ---------- */
function updateSelectBar() {
  const bar = $('selectBar');
  const n = state.selected.size;
  $('selectCount').textContent = n + (n === 1 ? ' selected' : ' selected');
  bar.classList.toggle('hidden', !state.selectMode || n === 0);
  $('selectModeBtn').setAttribute('aria-pressed', state.selectMode ? 'true' : 'false');
  $('selectModeBtn').classList.toggle('active', state.selectMode);
}
function toggleSelect(id) {
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  renderGalleryView();
}
function exitSelectMode() {
  state.selectMode = false;
  state.selected.clear();
  renderGalleryView();
}
$('selectModeBtn').addEventListener('click', () => {
  state.selectMode = !state.selectMode;
  if (!state.selectMode) state.selected.clear();
  renderGalleryView();
});
$('selectCancel').addEventListener('click', exitSelectMode);
$('selectDownload').addEventListener('click', async () => {
  const ids = [...state.selected];
  for (const id of ids) {
    const img = state.images.find((i) => i.id === id);
    if (img) await downloadImage(img);
    await new Promise((r) => setTimeout(r, 350));
  }
  toast(ids.length + ' image' + (ids.length === 1 ? '' : 's') + ' downloaded', 'ok');
});
$('selectDelete').addEventListener('click', async () => {
  const ids = [...state.selected];
  if (!ids.length) return;
  if (!window.confirm('Delete ' + ids.length + ' image' + (ids.length === 1 ? '' : 's') + '? This cannot be undone.')) return;
  for (const id of ids) await deleteImage(id, true);
  toast(ids.length + ' image' + (ids.length === 1 ? '' : 's') + ' deleted', 'ok');
});

document.querySelectorAll('.gallery-toolbar .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.gallery-toolbar .chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    state.filter = chip.dataset.filter;
    renderGalleryView();
  });
});

chat.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const imagePreview = e.target.closest('.user-attachment img, .chat-image img');
  if (!imagePreview) return;
  e.preventDefault();
  openChatImage(imagePreview);
});

/* Lightbox */
const lightbox = $('lightbox');
let lbList = [];
let lbIndex = 0;

function openLightbox(index, list) {
  lbList = list && list.length ? list : state.images;
  lbIndex = clamp(index, 0, lbList.length - 1);
  paintLightbox();
  lightbox.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeLightbox() {
  lightbox.classList.remove('open');
  document.body.style.overflow = '';
}
function paintLightbox() {
  const img = lbList[lbIndex];
  if (!img) return;
  $('lbImage').removeAttribute('src');
  setImageSource($('lbImage'), img);
  $('lbImage').alt = img.prompt || img.name || 'Image';
  $('lbPrompt').textContent = img.prompt || img.name || '';
  $('lbMeta').textContent = img.prompt
    ? [
      (img.quality || 'standard').toUpperCase(),
      img.ratio || '1:1',
      new Date(img.createdAt || Date.now()).toLocaleString(),
    ].join(' · ')
    : [img.type || 'Uploaded image', new Date(img.createdAt || Date.now()).toLocaleString()].join(' · ');
  $('lbCopy').hidden = !img.prompt;
  $('lbReuse').hidden = !img.prompt;
  $('lbDelete').hidden = !state.images.some((image) => image.id === img.id);
  $('lbCount').textContent = (lbIndex + 1) + ' / ' + lbList.length;
  const single = lbList.length < 2;
  $('lbPrev').style.display = single ? 'none' : '';
  $('lbNext').style.display = single ? 'none' : '';
}
function stepLightbox(d) {
  if (!lbList.length) return;
  lbIndex = (lbIndex + d + lbList.length) % lbList.length;
  paintLightbox();
}
$('lbClose').addEventListener('click', closeLightbox);
$('lbPrev').addEventListener('click', () => stepLightbox(-1));
$('lbNext').addEventListener('click', () => stepLightbox(1));
lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });
$('lbDownload').addEventListener('click', () => downloadImage(lbList[lbIndex]));
$('lbCopy').addEventListener('click', async () => {
  const ok = await copyText(lbList[lbIndex] ? lbList[lbIndex].prompt || '' : '');
  toast(ok ? 'Prompt copied' : 'Copy failed', ok ? 'ok' : 'err', 1600);
});
$('lbReuse').addEventListener('click', () => {
  const img = lbList[lbIndex];
  if (!img) return;
  promptBox.value = img.prompt || '';
  $('imageCharCount').textContent = promptBox.value.length + ' / 1000';
  generateBtn.disabled = !promptBox.value.trim();
  closeLightbox();
  setView('studio');
  toast('Prompt loaded into the studio', 'ok');
});
$('lbDelete').addEventListener('click', async () => {
  const img = lbList[lbIndex];
  if (!img) return;
  closeLightbox();
  await deleteImage(img.id);
});

async function downloadImage(img) {
  if (!img) return;
  const extension = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[img.type] || 'png';
  const name = 'qelari-' + (img.id || Date.now()) + '.' + extension;
  try {
    const blob = await readMediaBlob(img.id) || imageBlobs.get(img.id);
    if (!blob) throw new Error('This image is missing from this browser’s local storage.');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    toast('Image downloaded', 'ok');
  } catch (e) {
    toast(e.message || 'Image download failed.', 'err');
  }
}

/* ---------------- Views ---------------- */
function setView(view) {
  state.view = view;
  ['chat', 'studio', 'gallery'].forEach((v) => {
    const el = $(v + 'View');
    if (el) el.classList.toggle('active', v === view);
  });
  document.querySelectorAll('[data-view]').forEach((b) => {
    if (b.tagName === 'BUTTON') {
      const isActive = b.dataset.view === view;
      b.classList.toggle('active', isActive);
      if (b.getAttribute('role') === 'tab') b.setAttribute('aria-selected', isActive ? 'true' : 'false');
    }
  });
  const showDock = view === 'chat';
  $('dock').classList.toggle('hidden', !showDock);
  if (view === 'gallery') renderGalleryView();
  else if (state.selectMode) exitSelectMode();
  if (view === 'chat') requestAnimationFrame(() => { updateDockHeight(); toBottom(true); });
}

document.querySelectorAll('[data-view]').forEach((b) => {
  if (b.tagName !== 'BUTTON') return;
  b.addEventListener('click', () => {
    setView(b.dataset.view);
    if (b.closest('.side-nav')) closeSidebar();
  });
});
$('openGallery').addEventListener('click', () => setView('gallery'));
document.querySelectorAll('[data-goto]').forEach((b) => {
  b.addEventListener('click', () => setView(b.dataset.goto));
});

/* ---------------- Sidebar drawer ---------------- */
const sidebar = $('sidebar');
const scrim = $('scrim');
function openSidebar() {
  sidebar.classList.add('open');
  scrim.classList.add('show');
}
function closeSidebar() {
  sidebar.classList.remove('open');
  scrim.classList.remove('show');
}
$('menuBtn').addEventListener('click', openSidebar);
$('qelariExit').addEventListener('click', () => {
  window.parent.postMessage({ type: 'qelari:exit' }, window.location.origin);
});
$('closeSidebar').addEventListener('click', closeSidebar);
scrim.addEventListener('click', closeSidebar);
sidebar.addEventListener('click', (e) => { if (e.target.closest('.conv-item')) closeSidebar(); });

/* ---------------- Search ---------------- */
$('searchInput').addEventListener('input', (e) => {
  state.search = e.target.value;
  renderSidebar();
  if (state.view === 'gallery') renderGalleryView();
});

/* ---------------- New chat ---------------- */
$('newChat').addEventListener('click', newChat);

/* ---------------- Scroll to bottom ---------------- */
$('toBottom').addEventListener('click', () => { toBottom(true); });

/* ---------------- Keyboard shortcuts ---------------- */
document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (window.innerWidth < 1024) openSidebar();
    $('searchInput').focus();
    $('searchInput').select();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    newChat();
    return;
  }
  if (e.key === 'Escape') {
    if (lightbox.classList.contains('open')) { closeLightbox(); return; }
    if ($('renameModal').classList.contains('open')) { closeRename(); return; }
    if (sidebar.classList.contains('open')) { closeSidebar(); return; }
  }
  if (lightbox.classList.contains('open')) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); stepLightbox(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); stepLightbox(1); }
  }
  if (!typing && e.key === '/' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    if (window.innerWidth < 1024) openSidebar();
    $('searchInput').focus();
  }
});

/* ---------------- Online status ---------------- */
function paintNet() {
  const chip = $('netStatus');
  const on = navigator.onLine;
  chip.classList.toggle('offline', !on);
  chip.querySelector('span:last-child').textContent = on ? 'Connected' : 'Offline — saved locally';
}
window.addEventListener('online', () => { paintNet(); toast('Back online', 'ok', 1600); });
window.addEventListener('offline', () => { paintNet(); toast('Offline — changes are saved locally', 'info', 2200); });

/* ---------------- Viewport / keyboard handling ---------------- */
const vv = window.visualViewport;
function updateDockHeight() {
  const dock = $('dock');
  const h = dock.classList.contains('hidden') ? 0 : dock.offsetHeight;
  document.documentElement.style.setProperty('--dock-h', h + 'px');
}
/* The composer changes height (status line, keyboard, rotation) — keep the
   chat's bottom padding in sync so the last message is never hidden under it. */
if (typeof ResizeObserver !== 'undefined') {
  const dockObserver = new ResizeObserver(() => updateDockHeight());
  dockObserver.observe($('dock'));
}
function fit() {
  const h = vv ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty('--app-h', h + 'px');
  if (vv) document.body.style.top = vv.offsetTop + 'px';
  updateDockHeight();
  toBottom();
}
if (vv) {
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
}
window.addEventListener('resize', () => { updateDockHeight(); });
window.addEventListener('orientationchange', () => setTimeout(fit, 180));

/* ---------------- Boot ---------------- */
function boot() {
  initTheme();
  paintNet();

  // Restore the last conversation (or start fresh).
  const last = state.conversations.find((c) => c.id === state.currentId);
  if (last) {
    state.currentId = last.id;
    renderConversation(last);
  } else {
    state.currentId = null;
    showWelcome();
  }

  renderSidebar();
  renderImages();
  renderGalleryView();
  $('galleryCount').textContent = state.images.length;
  updateDockHeight();
  fit();

  if (DESKTOP) input.focus();
}

let booted = false;
function bootOnce() {
  if (booted) return;
  booted = true;
  boot();
}
document.addEventListener('DOMContentLoaded', bootOnce);
if (document.readyState !== 'loading') bootOnce();
