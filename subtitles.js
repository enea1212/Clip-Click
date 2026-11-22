const MIN_WORD = 0.05;
const TAG_TIME = /<(\d{1,2}:)?\d{2}:\d{2}\.\d{3}>/;

function parseTime(value) {
  const pieces = value.replace(",", ".").split(":").map(Number);
  return pieces.length === 3 ? pieces[0] * 3600 + pieces[1] * 60 + pieces[2] : pieces[0] * 60 + pieces[1];
}

function decode(text) {
  return text
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&");
}

function tokens(text) {
  return decode(text.replace(/<[^>]*>/g, "")).split(/\s+/).filter((token) => isSpokenWord(token));
}

function readCues(text) {
  // A cue runs from its "-->" line to the next one. Blank lines are not used as
  // separators because YouTube auto-subs contain lines holding a single space.
  const cues = [];
  const lines = text.replace(/\r/g, "").split("\n");
  let cue = null;
  lines.forEach((line, i) => {
    if (line.includes("-->")) {
      const [from, to] = line.split("-->").map((part) => parseTime(part.trim().split(/\s+/)[0]));
      cue = Number.isFinite(from) && to > from ? { start: from, end: to, lines: [] } : null;
      if (cue) cues.push(cue);
      return;
    }
    // NOTE/STYLE/REGION blocks start after a blank line and last until the next cue.
    if (/^(NOTE|STYLE|REGION)(\s|$)/.test(line) && !(lines[i - 1] || "").trim()) { cue = null; return; }
    // A line directly before a timing line is that cue's id (numeric or text), not subtitle text.
    const nextIsTiming = (lines[i + 1] || "").includes("-->");
    if (cue && line.trim() && !nextIsTiming) cue.lines.push(line);
  });
  return cues;
}

// Auto line: "first<00:00:01.500><c> second</c>..." -> words with start times.
function timedWords(line, cueStart) {
  const words = [];
  let start = cueStart;
  for (const part of line.split(/(<(?:\d{1,2}:)?\d{2}:\d{2}\.\d{3}>)/)) {
    if (/^<[\d:.]+>$/.test(part)) { start = parseTime(part.slice(1, -1)); continue; }
    for (const word of tokens(part)) words.push({ word, start });
  }
  return words;
}

function spread(cue) {
  const list = tokens(cue.lines.join(" "));
  const letters = list.reduce((sum, word) => sum + word.length, 0) || 1;
  let at = cue.start;
  return list.map((word) => {
    const start = at;
    at += (cue.end - cue.start) * word.length / letters;
    return { word, start, end: at };
  });
}

function parseVttWords(text) {
  // Credit cues (e.g. TED "Traducător: … Corector: …") are not speech.
  const cues = readCues(text).filter((cue) => !/^\s*(Traducător|Translator|Corector|Reviewer|Transcriber|Transcriere)\s*:/i.test(cue.lines[0] || ""));
  const auto = cues.some((cue) => cue.lines.some((line) => TAG_TIME.test(line)));
  const words = [];
  for (const cue of cues) {
    if (!auto) { words.push(...spread(cue)); continue; }
    if (cue.end - cue.start < MIN_WORD) continue;
    const line = cue.lines.at(-1);
    if (!line) continue;
    const list = timedWords(line, cue.start);
    list.forEach((item, i) => { item.end = i + 1 < list.length ? list[i + 1].start : cue.end; });
    words.push(...list);
  }
  return tidyTimings(words);
}

// Strictly increasing starts, every word at least MIN_WORD long, no overlap with the next word.
function tidyTimings(words) {
  words.forEach((word, i) => {
    const prev = words[i - 1];
    if (prev) word.start = Math.max(word.start, prev.start + MIN_WORD);
    word.end = Math.max(word.end, word.start + MIN_WORD);
    if (prev) prev.end = Math.min(prev.end, word.start);
  });
  return words;
}

// Tokens without any letter or digit (">>" speaker changes, lone dashes) are not spoken words.
const isSpokenWord = (token) => /[\p{L}\p{N}]/u.test(token);

// Prefer tracks with per-word timings (karaoke follows real speech), then Romanian.
function pickCaptionTrack(tracks) {
  const rank = (track) => (TAG_TIME.test(track.text) ? 0 : 2) + (/\.ro(-[A-Za-z]+)?\.vtt$/.test(track.name) ? 0 : 1);
  return [...tracks].sort((a, b) => rank(a) - rank(b))[0]?.name;
}

const MAX_GROUP = 4;
const MAX_PAUSE = 0.6;
// At font size 90 (active word 112%), ~20 uppercase characters fit on one 1080px line with margin
// (measured on rendered frames: 18 characters take ~75% of the width).
const LINE_CHARS = 20;
const joinedLength = (list) => list.reduce((sum, item) => sum + item.word.length, 0) + Math.max(0, list.length - 1);

function groupWords(words) {
  const groups = [];
  let current = [];
  words.forEach((word, i) => {
    current.push(word);
    const next = words[i + 1];
    const tooLong = next && joinedLength([...current, next]) > 2 * LINE_CHARS;
    if (!next || tooLong || current.length >= MAX_GROUP || /[.?!,]$/.test(word.word) || next.start - word.end > MAX_PAUSE) {
      groups.push(current);
      current = [];
    }
  });
  return groups;
}

function assTime(seconds) {
  const cs = Math.round(Math.max(0, seconds) * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor(cs / 6000) % 60;
  const s = Math.floor(cs / 100) % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

const ASS_HEADER = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
{STYLE}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
const ACTIVE = "{\\c&H00E6FF&\\fscx112\\fscy112}";

function clean(word) {
  return word.replace(/[{}\\]/g, "").toLocaleUpperCase("ro");
}

// WrapStyle 2 disables automatic wrapping, so the enlarged active word can't move the break.
// Long groups get one fixed break at the most balanced word boundary; -1 means one line.
function lineBreakAfter(group) {
  if (joinedLength(group) <= LINE_CHARS) return -1;
  let best = -1;
  let bestWidth = Infinity;
  for (let k = 0; k < group.length - 1; k += 1) {
    const width = Math.max(joinedLength(group.slice(0, k + 1)), joinedLength(group.slice(k + 1)));
    if (width < bestWidth) { best = k; bestWidth = width; }
  }
  return best;
}

// Normal: bottom-centre at ~75% height. Split ("Video jos"): centred on the middle line (y = 960).
function styleLine(split) {
  const [alignment, marginV] = split ? [5, 0] : [2, 480];
  return `Style: Default,Arial Black,90,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,6,3,${alignment},60,60,${marginV},1`;
}

function buildAss(words, clipStart, clipEnd, { split = false } = {}) {
  const length = clipEnd - clipStart;
  const inClip = words
    .filter((word) => word.end > clipStart && word.start < clipEnd)
    .map((word) => ({ word: clean(word.word), start: Math.max(0, word.start - clipStart), end: Math.min(length, word.end - clipStart) }))
    .filter((word) => word.word && word.end - word.start >= 0.01);
  const events = [];
  for (const group of groupWords(inClip)) {
    const breakAt = lineBreakAfter(group);
    group.forEach((word, i) => {
      const end = i + 1 < group.length ? group[i + 1].start : word.end;
      const text = group
        .map((other, j) => (j === i ? `${ACTIVE}${other.word}{\\r}` : other.word) + (j === group.length - 1 ? "" : j === breakAt ? "\\N" : " "))
        .join("");
      events.push(`Dialogue: 0,${assTime(word.start)},${assTime(end)},Default,,0,0,0,,${text}`);
    });
  }
  return ASS_HEADER.replace("{STYLE}", styleLine(split)) + events.join("\n") + "\n";
}

module.exports = { parseVttWords, groupWords, buildAss, pickCaptionTrack, tidyTimings, isSpokenWord };
