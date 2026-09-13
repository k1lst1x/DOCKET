// Offensive-language filter for text other members read: review bodies and display names.
// The review form runs it for instant feedback; the API runs it again as the real check.
//
// A plain word list is easy to dodge, so text is normalized before matching:
//   * Unicode tricks: accents and stacked combining marks, full-width and "fancy" letters
//     (𝐟, ⓕ, 🇫), small caps, Cyrillic and Greek look-alikes, zero-width and other invisible characters.
//   * Leetspeak and sound-alikes: 5h1t, @ss, b!tch, c/k/q, v for u, z for s, y for i.
//   * Masking and spacing: f*ck, f.u.c.k, f u c k, fu ck, and stretched letters (fuuuck).
// To keep innocent words working (Scunthorpe, cocktail, assessment, he'll, spick and span),
// short words only match as whole words with known endings, masks only stand in for letters
// between real ones, and a few names and idioms are allowed.

export interface ModerationResult {
  ok: boolean;
  /** Offending words as the writer typed them, so the form can point at what to change. */
  matches: string[];
}

/** Blocked anywhere inside a word. Only terms that don't occur inside everyday words (see ALLOWED_WORDS). */
const ANYWHERE = [
  "fuck", "fcuk", "phuck", "mthrfckr", "shit", "bitch", "biatch", "biotch", "cunt", "twat", "wanker", "whore",
  "slut", "bastard", "asshole", "arsehole", "asshat", "asswipe", "assclown", "dumbass", "jackass", "smartass",
  "fatass", "dickhead", "cocksuck", "douchebag", "scumbag", "damn", "dammit", "goddam", "jizz", "dildo",
  "blowjob", "handjob", "cumshot", "cumslut",
  // Slurs.
  "nigger", "nigga", "niggah", "nigguh", "faggot", "fagot", "wetback", "raghead", "towelhead",
  // Spanish and Hindi profanity common in Fremont.
  "mierda", "pendejo", "cabron", "chinga", "culero", "madarchod", "maderchod", "bhenchod", "behenchod",
  "benchod", "chutiya", "chutiye", "bhosdike", "bhosadike", "gaandu",
];

/** Blocked as whole words, with the endings listed ("" is the bare word). */
const WHOLE_WORDS: Record<string, string[]> = {
  ass: ["", "es"],
  arse: ["", "s"],
  fuk: ["", "s", "ed", "er", "ers", "in", "ing", "off", "face", "head", "wit"],
  phuk: ["", "s", "ed", "er", "ers", "in", "ing", "off"],
  fck: ["", "s", "ed", "er", "ers", "in", "ing", "n"],
  fkn: [""],
  wtf: [""],
  stfu: [""],
  gtfo: [""],
  mofo: ["", "s"],
  btch: ["", "es", "y"],
  cock: ["", "s"],
  dick: ["", "s"],
  tit: ["s", "ty", "tie", "ties"],
  boob: ["s", "ies"],
  cum: ["", "s"],
  crap: ["", "py", "pier", "piest", "ped", "ping", "per", "pers"],
  piss: ["", "ed", "es", "er", "ers", "ing", "y", "off"],
  hell: ["", "hole", "holes"],
  prick: ["", "s"],
  douche: ["", "s", "y"],
  skank: ["", "s", "y"],
  thot: ["", "s"],
  bollock: ["", "s"],
  tosser: ["", "s"],
  puss: ["y", "ies"],
  // Slurs.
  fag: ["", "s", "gy"],
  dyke: ["", "s"],
  homo: ["", "s"],
  trann: ["y", "ies"],
  spic: ["", "s", "k", "ks"],
  chink: ["", "s"],
  gook: ["", "s"],
  kike: ["", "s"],
  coon: ["", "s"],
  dago: ["", "s", "es"],
  paki: ["", "s"],
  jap: ["", "s"],
  beaner: ["", "s"],
  retard: ["", "s", "ed", "o", "os"],
  // Spanish.
  puta: ["", "s"],
  verga: ["", "s"],
  culo: ["", "s"],
};

/** Endings accepted when a blocked word is split across two words ("fu cking", "as shole"). */
const JOIN_ENDINGS = new Set(["", "s", "es", "ed", "er", "ers", "in", "ing", "y", "ty", "head", "heads", "hole", "holes", "face"]);

/** Everyday words and names that contain a blocked term. */
const ALLOWED_WORDS = ["scunthorpe", "shiitake", "shitake", "shitzu", "snigger", "niggard", "damnation", "bastardiz", "bastardis", "classclown"];

/**
 * Words with legitimate civic uses ("sex offender registry", "Nazi Germany", "rape kit backlog")
 * that are blocked only when disguised ("s*x", "p0rn", "n@ked"): hiding a word shows intent.
 */
const DISGUISED_ONLY: Record<string, string[]> = {
  sex: ["", "y", "ual", "ually", "t", "ting"],
  porn: ["", "o", "os", "s", "y", "ography"],
  nude: ["", "s"],
  naked: [""],
  horny: [""],
  rape: ["", "d", "s"],
  rapist: ["", "s"],
  penis: ["", "es"],
  vagina: ["", "s"],
  nazi: ["", "s"],
};

/** Idioms and names that contain a whole-word term, matched on plain lowercase words. */
const IDIOMS = [
  /\bchinks? in (?:the|his|her|their|its|our|my|your|an|a) armou?r\b/g,
  /\bspick? (?:and |n )?span\b/g,
  /\b(?:magna |summa )?cum laude\b/g,
  /\bhomo (?:sapiens|erectus|habilis|neanderthalensis)\b/g,
  /\b(?:dick )?van dyke\b/g,
  /\bdicks? sporting goods\b/g,
  /\bmoby dick\b/g,
  /\bhells kitchen\b/g,
];

/** Threats and self-harm taunts, matched on words with leetspeak undone. */
const THREATS = [
  /\b(?:kill|kil) ?(?:your ?self|ur ?self|yourselves|urselves|yoself)\b/g,
  /\bkys\b/g,
  /\bneck (?:your ?self|ur ?self)\b/g,
  /\bhope (?:you|u|ya) (?:die|dies|get raped|get shot|get cancer)\b/g,
  /\bgo die\b/g,
  /\b(?:ill|i will|im going to|im gonna|imma|ima) (?:kill|shoot|stab|murder|rape|hurt) (?:you|u|ya|your family)\b/g,
];

// ---------------------------------------------------------------------------------------------
// Normalization

const INVISIBLE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\u{E0000}-\u{E0FFF}]/gu;
const BREAK_CH = "\u0000";
// "he'll", "don't", "Dick's": the apostrophe ends the word. Elsewhere ("f'ck") it counts as a mask.
const CONTRACTION = /'(?=(?:ll|re|ve|d|s|t|m)(?![a-z]))/g;

const LOOKALIKES: Record<string, string> = {
  // Cyrillic
  а: "a", в: "b", е: "e", ё: "e", к: "k", м: "m", н: "h", о: "o", п: "n", р: "p", с: "c", т: "t", у: "y",
  х: "x", ш: "w", щ: "w", ъ: "b", ь: "b", і: "i", ї: "i", ј: "j", ѕ: "s", ԁ: "d", ԛ: "q", ԝ: "w", ү: "y",
  һ: "h", ӏ: "l", ө: "o",
  // Greek
  α: "a", β: "b", γ: "y", δ: "d", ε: "e", ζ: "z", η: "n", θ: "o", ι: "i", κ: "k", μ: "u", ν: "v", ο: "o",
  π: "n", ρ: "p", ς: "s", τ: "t", υ: "u", χ: "x", ω: "w",
  // Latin letters that don't decompose, small caps and turned letters
  ß: "ss", æ: "ae", œ: "oe", ø: "o", ł: "l", đ: "d", ð: "d", ħ: "h", ı: "i", ȷ: "j", ŀ: "l", ƒ: "f", ŧ: "t",
  ɑ: "a", ɡ: "g", ɩ: "i", ɪ: "i", ʟ: "l", ɴ: "n", ʀ: "r", ʏ: "y", ᴀ: "a", ʙ: "b", ᴄ: "c", ᴅ: "d", ᴇ: "e",
  ꜰ: "f", ɢ: "g", ʜ: "h", ᴊ: "j", ᴋ: "k", ᴍ: "m", ᴏ: "o", ᴘ: "p", ǫ: "q", ꜱ: "s", ᴛ: "t", ᴜ: "u", ᴠ: "v",
  ᴡ: "w", ᴢ: "z", ɐ: "a", ǝ: "e", ɔ: "c", ɟ: "f", ɥ: "h", ɯ: "m", ɹ: "r", ʇ: "t", ʌ: "v", ʍ: "w", ʎ: "y", ʞ: "k",
};

/** Characters people type in place of letters. Each maps to the letters it can stand for. */
const LEET: Record<string, string> = {
  "0": "o", "1": "il", "!": "il", "|": "il", "3": "e", "4": "a", "@": "a", "^": "a", "5": "s", $: "s", "§": "s",
  "7": "t", "+": "t", "8": "b", "9": "g", "6": "gb", "(": "k", "<": "k", "¢": "k", "©": "k", "€": "e",
};

/** Sound-alikes, applied to typed letters. Patterns fold c and q into k to match. */
const LETTER_SETS: Record<string, string> = { c: "k", q: "k", y: "yi", v: "vu", z: "zs" };
const fold = (term: string) => term.replace(/[cq]/g, "k");

function normalizeWord(raw: string): string {
  let out = "";
  const decomposed = raw.replace(/[´`’‘ʼ]/g, "'").normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "");
  for (const ch of decomposed) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x1f1e6 && cp <= 0x1f1ff) out += String.fromCharCode(97 + cp - 0x1f1e6); // regional indicator letters
    else if (cp >= 0x1f150 && cp <= 0x1f169) out += String.fromCharCode(97 + cp - 0x1f150); // negative circled
    else if (cp >= 0x1f170 && cp <= 0x1f189) out += String.fromCharCode(97 + cp - 0x1f170); // negative squared
    else if (!/\s/u.test(ch)) out += LOOKALIKES[ch] ?? ch;
  }
  return out.replace(CONTRACTION, BREAK_CH);
}

const LETTER = 0;
const SUBSTITUTE = 1; // leetspeak character
const MASK = 2; // *, #, -, emoji…: may hide one letter or be ignored
const BREAK = 3; // ends a word: contraction apostrophes, other scripts

interface Glyph {
  ch: string;
  kind: number;
  set: string;
  /** Same character as the one before. */
  repeat: boolean;
  /** Length of the run of identical characters this one is in. */
  run: number;
  /** A deliberate mask (*, #, a digit…) that may replace a word's first or last letter. */
  edge: boolean;
}

// Periods, commas, question and exclamation marks end sentences ("Li Shi."), so they never count.
const EDGE_MASKS = new Set(Array.from("*#%_~^0123456789@$+§€¢©"));

function glyphs(word: string): Glyph[] {
  const out: Glyph[] = Array.from(word, (ch) => {
    if (ch >= "a" && ch <= "z") return { ch, kind: LETTER, set: LETTER_SETS[ch] ?? ch, repeat: false, run: 1, edge: EDGE_MASKS.has(ch) };
    if (LEET[ch]) return { ch, kind: SUBSTITUTE, set: LEET[ch], repeat: false, run: 1, edge: EDGE_MASKS.has(ch) };
    if (ch === BREAK_CH || /\p{L}/u.test(ch)) return { ch, kind: BREAK, set: "", repeat: false, run: 1, edge: EDGE_MASKS.has(ch) };
    return { ch, kind: MASK, set: "", repeat: false, run: 1, edge: EDGE_MASKS.has(ch) };
  });
  for (let i = 0; i < out.length; ) {
    let j = i;
    while (j < out.length && out[j].ch === out[i].ch) j++;
    for (let k = i; k < j; k++) {
      out[k].run = j - i;
      out[k].repeat = k > i;
    }
    i = j;
  }
  return out;
}

const plainLetters = (g: Glyph[]) => g.map((x) => (x.kind === LETTER ? x.ch : "")).join("");
const decodedLetters = (g: Glyph[]) => g.map((x) => (x.kind === LETTER ? x.ch : x.kind === SUBSTITUTE ? x.set[0] : "")).join("");

// ---------------------------------------------------------------------------------------------
// Matching

let current = new Int16Array(64);
let next = new Int16Array(64);
let currentEdge = new Int16Array(64);
let nextEdge = new Int16Array(64);

/**
 * Where `pattern` finishes matching in `g` (exclusive glyph indices).
 * States track how many real letters (typed or leetspeak) matched so far: masks may stand in for
 * letters between real ones, as long as at least 40% of the pattern (and 2 letters) is real.
 * A deliberate mask may also replace the first or last letter of a 4+ letter word ("4uck", "fuc*"),
 * but then every other letter must be real; those paths are tracked separately in the *Edge arrays.
 * Anchored matches start at the first glyph, skipping leading punctuation; stretched letters then
 * need a run of 3 ("asss") so everyday double letters ("cook", "woop") stay distinct.
 */
function scan(g: Glyph[], pattern: string, anchored: boolean, firstOnly: boolean): number[] {
  const len = pattern.length;
  const need = Math.max(2, Math.ceil(len * 0.4));
  const edgeAllowed = len >= 4;
  const ends: number[] = [];
  current.fill(-1, 0, len + 1);
  currentEdge.fill(-1, 0, len + 1);
  current[0] = 0;
  for (let i = 0; i < g.length; i++) {
    const { kind, set, repeat, run, edge } = g[i];
    next.fill(-1, 0, len + 1);
    nextEdge.fill(-1, 0, len + 1);
    if (!anchored || (current[0] >= 0 && kind !== LETTER && kind !== BREAK)) next[0] = 0;
    if (kind !== BREAK) {
      const stretch = repeat && (!anchored || run >= 3);
      for (const [from, to] of [
        [current, next],
        [currentEdge, nextEdge],
      ]) {
        for (let j = 0; j <= len; j++) {
          const real = from[j];
          if (real < 0) continue;
          // Masks, and leetspeak used as a mask ("f#@k"), may hide one letter or be ignored between real letters.
          if (kind !== LETTER && j > 0 && j < len) {
            if (real > to[j]) to[j] = real;
            if (j + 1 < len && real > to[j + 1]) to[j + 1] = real;
          }
          // A deliberate mask standing in for the first or last letter.
          if (edgeAllowed && edge && j < len && (j === 0 || j + 1 === len) && real > nextEdge[j + 1]) nextEdge[j + 1] = real;
          if (kind !== MASK) {
            if (j < len && set.includes(pattern[j]) && real + 1 > to[j + 1]) to[j + 1] = real + 1;
            if (j > 0 && stretch && set.includes(pattern[j - 1]) && real > to[j]) to[j] = real;
          }
        }
      }
    }
    if (next[len] >= need || nextEdge[len] >= len - 1) {
      ends.push(i + 1);
      if (firstOnly) return ends;
    }
    [current, next] = [next, current];
    [currentEdge, nextEdge] = [nextEdge, currentEdge];
  }
  return ends;
}

const ANYWHERE_PATTERNS = ANYWHERE.map(fold);
const WHOLE_PATTERNS = Object.entries(WHOLE_WORDS).map(([word, endings]) => ({ pattern: fold(word), endings: new Set(endings) }));
const JOIN_ANYWHERE = ANYWHERE_PATTERNS.filter((p) => p.length >= 4);
const JOIN_WHOLE = WHOLE_PATTERNS.filter((w) => w.pattern.length >= 4);
const ALLOWED = new RegExp(ALLOWED_WORDS.join("|"), "g");
const SEGMENT_SEPARATORS = /[\u0000\-–—_/\\.,;:?"“”()[\]{}~*#&=]+/;

function endsWithAllowedEnding(g: Glyph[], end: number, endings: Set<string>): boolean {
  const rest = g.slice(end);
  return endings.has(plainLetters(rest)) || endings.has(decodedLetters(rest));
}

function wholeWordMatch(g: Glyph[], pattern: string, endings: Set<string>, minEnd = 0): boolean {
  return scan(g, pattern, true, false).some((end) => end > minEnd && endsWithAllowedEnding(g, end, endings));
}

function wordFlagged(word: string, idiom: boolean): boolean {
  const g = glyphs(word);
  if (ANYWHERE_PATTERNS.some((p) => scan(g, p, false, true).length > 0)) return true;
  if (idiom) return false;
  const parts = word.split(SEGMENT_SEPARATORS).filter(Boolean);
  const candidates = parts.length > 1 ? [g, ...parts.map(glyphs)] : [g];
  return candidates.some((c) => WHOLE_PATTERNS.some((w) => wholeWordMatch(c, w.pattern, w.endings)));
}

/** A blocked word split in two ("fu ck"): the match must start at the first word and cross into the second. */
function splitFlagged(a: string, b: string, idiom: boolean): boolean {
  const g = glyphs(a + b);
  const boundary = Array.from(a).length;
  if (JOIN_ANYWHERE.some((p) => wholeWordMatch(g, p, JOIN_ENDINGS, boundary))) return true;
  return !idiom && JOIN_WHOLE.some((w) => wholeWordMatch(g, w.pattern, w.endings, boundary));
}

const DISGUISED_PATTERNS = Object.entries(DISGUISED_ONLY).map(([word, endings]) => ({ word, pattern: fold(word), endings: new Set(endings) }));

/**
 * A DISGUISED_ONLY word written in disguise. If the word appears as typed ("sex offender"), it's
 * allowed; if it only matches after undoing masks, leetspeak, look-alikes or spacing, it isn't.
 * Pass `boundary` to check two words joined together ("se x").
 */
function disguisedFlagged(raw: string, norm: string, boundary?: number): boolean {
  const typed = raw.toLowerCase();
  const g = glyphs(norm);
  const parts = boundary === undefined ? norm.split(SEGMENT_SEPARATORS).filter(Boolean) : [];
  const candidates = parts.length > 1 ? [g, ...parts.map(glyphs)] : [g];
  return DISGUISED_PATTERNS.some(
    ({ word, pattern, endings }) => !typed.includes(word) && candidates.some((c) => wholeWordMatch(c, pattern, endings, boundary ?? 0)),
  );
}

const cache = new Map<string, boolean>();
function cachedWordFlagged(word: string, idiom: boolean): boolean {
  const key = `${idiom ? 1 : 0}${word}`;
  let hit = cache.get(key);
  if (hit === undefined) {
    if (cache.size > 5000) cache.clear();
    hit = wordFlagged(word, idiom);
    cache.set(key, hit);
  }
  return hit;
}

interface Word {
  raw: string;
  norm: string;
  idiom: boolean;
}

/** Marks words inside allowed idioms, and returns the spans of any threats. */
function phraseScan(words: Word[], forms: string[], patterns: RegExp[], onMatch: (first: number, last: number) => void) {
  const starts: number[] = [];
  let text = "";
  forms.forEach((form, i) => {
    starts[i] = form ? text.length + (text ? 1 : 0) : -1;
    if (form) text += (text ? " " : "") + form;
  });
  for (const pattern of patterns) {
    for (const m of text.matchAll(pattern)) {
      const from = m.index ?? 0;
      const to = from + m[0].length;
      const inside = words.map((_, i) => i).filter((i) => starts[i] >= from && starts[i] < to);
      if (inside.length) onMatch(inside[0], inside[inside.length - 1]);
    }
  }
}

const isNumber = (norm: string) => /[0-9]/.test(norm) && /^[0-9.,:;/\-+%$#()~]+$/.test(norm);
const isFragment = (norm: string) => norm.length <= 3 && norm.replace(/[^a-z0-9@$!|]/g, "").length <= 1;

export function moderateText(text: string): ModerationResult {
  const words: Word[] = text
    .replace(INVISIBLE, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => ({ raw, norm: normalizeWord(raw), idiom: false }));
  const matches = new Set<string>();

  phraseScan(words, words.map((w) => w.norm.replace(/[^a-z]/g, "")), IDIOMS, (first, last) => {
    for (let i = first; i <= last; i++) words[i].idiom = true;
  });
  phraseScan(words, words.map((w) => decodedLetters(glyphs(w.norm))), THREATS, (first, last) => {
    matches.add(words.slice(first, last + 1).map((w) => w.raw).join(" "));
  });

  // Letters typed one at a time ("f u c k", "s. h. i. t") are read as one word.
  const units: Word[] = [];
  for (let i = 0; i < words.length; ) {
    let j = i;
    while (j < words.length && isFragment(words[j].norm)) j++;
    if (j - i >= 2) {
      const run = words.slice(i, j);
      units.push({ raw: run.map((w) => w.raw).join(" "), norm: run.map((w) => w.norm).join(""), idiom: false });
      i = j;
    } else {
      units.push(words[i]);
      i++;
    }
  }

  const prepared = units.map((u) => ({ ...u, norm: u.norm.replace(ALLOWED, BREAK_CH), number: isNumber(u.norm) }));
  const flagged = prepared.map((u) => !u.number && (cachedWordFlagged(u.norm, u.idiom) || disguisedFlagged(u.raw, u.norm)));
  prepared.forEach((u, i) => {
    if (flagged[i]) matches.add(u.raw);
  });
  for (let i = 0; i + 1 < prepared.length; i++) {
    const a = prepared[i];
    const b = prepared[i + 1];
    if (a.number || b.number || flagged[i] || flagged[i + 1]) continue;
    const joined = `${a.raw} ${b.raw}`;
    if (splitFlagged(a.norm, b.norm, a.idiom || b.idiom) || disguisedFlagged(joined, a.norm + b.norm, Array.from(a.norm).length)) matches.add(joined);
  }

  // Quote "jack@ss" rather than "jack@ss.", keeping the word as typed.
  const display = [...matches].map((m) => m.replace(/^[("'“‘[]+|[.,;:!?)"'”’\]]+$/g, "") || m);
  return { ok: matches.size === 0, matches: [...new Set(display)] };
}
