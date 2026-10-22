// Profanity detection and filtering for chat. Pure functions, no Firebase.
//
// Two levels:
// - severe: slurs and hate words. Messages with these are blocked (the database rules block them too,
//   with the same SEVERE_PATTERN, so they can't be sneaked in).
// - mild: ordinary swearing. Allowed, but shown as "f***" when the reader's filter is on, and marked
//   for admins.
//
// Words are matched after undoing common tricks: capitals, look-alike characters (0→o, 1/!→i, 3→e,
// 4/@→a, 5/$→s, 7→t), stretched letters ("fuuuck") and spaced-out letters ("f u c k", "f.u.c.k").

// Same text as the regex in firestore.rules (keep them in step). Matched on lower-case text.
export const SEVERE_PATTERN = String.raw`\b(n+[i1!]+g{2,}(a|ah|as|az|er|ers|uh)?|f+[a@4]+g+([o0]+t+)?s?|r+[e3]+t+[a@4]+r+d+(s|ed)?|tr[a@4]nn(y|ies)|k[i1]kes?|ch[i1]nks?|sp[i1]cs?|c[o0][o0]ns?|g[o0][o0]ks?|wetbacks?)\b`;
const SEVERE = new RegExp(SEVERE_PATTERN, 'i');

// Mild words. "contains" ones match inside longer words (e.g. "fucking"); "whole" ones only on their own.
const MILD_CONTAINS = ['f+u+c+k', 's+h+i+t', 'c+u+n+t', 'b+i+t+c+h', 'w+a+n+k', 't+w+a+t', 'w+h+o+r+e', 's+l+u+t',
  'b+o+l+l+o+c+k', 'a+s+s+h+o+l+e', 'a+r+s+e+h+o+l+e', 'b+a+s+t+a+r+d', 'p+i+s+s', 'd+i+c+k+h+e+a+d'];
const MILD_WHOLE = ['d+i+c+k+s?', 'c+o+c+k+s?', 'p+u+s+s+(y|ies)', 'p+r+i+c+k+s?', 'a+s+s', 'a+r+s+e', 'f+k', 'f+f+s', 's+t+f+u', 'w+t+f'];
// Starred-out spellings ("f*ck" becomes "fck" once symbols are dropped).
MILD_CONTAINS.push('f+c+k', 's+h+t+(t+y|s)?$');
const MILD = new RegExp(`(${MILD_CONTAINS.join('|')})|^(${MILD_WHOLE.join('|')})$`);
// Ordinary words that happen to contain a swear word.
const SAFE = new Set(['scunthorpe', 'shiitake', 'shiitakes', 'cocktail', 'cocktails', 'cockpit', 'peacock', 'hancock', 'dickens',
  'assist', 'assists', 'assassin', 'class', 'pass', 'passed', 'grass', 'bass', 'mass', 'glass', 'massive', 'embarrass', 'bassist',
  'therapist', 'analyst', 'shitake', 'wankel', 'twatt', 'arsenal', 'sussex', 'essex', 'middlesex', 'cumbria', 'pissarro', 'bitcoin']);

const LOOKALIKE = { 0: 'o', 1: 'i', '!': 'i', '|': 'i', 3: 'e', 4: 'a', '@': 'a', 5: 's', $: 's', 7: 't', '+': 't' };

// One word, as the checks see it: lower case, look-alikes undone, other symbols dropped.
export function normalWord(word) {
  return String(word).toLowerCase().replace(/[0-9!|@$+]/g, (c) => LOOKALIKE[c] ?? c).replace(/[^a-z]/g, '');
}

// Joins letters spelled out with gaps ("f u c k", "f.u.c.k", "f_u_c_k") so they're checked as one word.
function joinSpacedLetters(text) {
  return text.replace(/(?:^|(?<=\s))((?:[^\s.\-_*]{1}[\s.\-_*]+){2,}[^\s.\-_*])(?=\s|$)/g, (m) => m.replace(/[\s.\-_*]+/g, ''));
}

function levelOfWord(word) {
  const w = normalWord(word);
  if (!w) return 'none';
  if (SEVERE.test(` ${w} `) || SEVERE.test(` ${String(word).toLowerCase()} `)) return 'severe';
  if (SAFE.has(w)) return 'none';
  if (MILD.test(w)) return 'mild';
  return 'none';
}

// { level: 'none' | 'mild' | 'severe', words: [the words that matched] }
export function checkText(text) {
  const raw = String(text ?? '');
  const words = [];
  let level = 'none';
  const consider = (word) => {
    const l = levelOfWord(word);
    if (l === 'none') return;
    words.push(word);
    if (l === 'severe' || level === 'none') level = l;
  };
  for (const word of raw.split(/\s+/)) consider(word);
  for (const word of joinSpacedLetters(raw).split(/\s+/)) if (!raw.split(/\s+/).includes(word)) consider(word);
  if (SEVERE.test(raw.toLowerCase())) level = 'severe';
  return { level, words: [...new Set(words)] };
}

// Text with swear words starred out ("f***"), keeping spaces and punctuation around them.
export function censor(text) {
  const raw = String(text ?? '');
  const spaced = joinSpacedLetters(raw);
  const source = spaced !== raw && checkText(spaced).level !== 'none' ? spaced : raw;
  return source.split(/(\s+)/).map((part) => {
    if (/^\s+$/.test(part) || levelOfWord(part) === 'none') return part;
    // Keep leading/trailing punctuation ("shit!" -> "s***!")
    const m = part.match(/^([^\p{L}\p{N}@$!|]*)(.*?)([^\p{L}\p{N}@$|]*)$/u);
    const [, before, word, after] = m ?? ['', '', part, ''];
    return `${before}${word.charAt(0)}${'*'.repeat(Math.max(word.length - 1, 2))}${after}`;
  }).join('');
}
