// Choosing moments with a local LLM (Ollama): transcript lines, prompt, answer validation,
// final pick, and the HTTP calls. Everything except the HTTP calls is pure and unit-tested.

const MAX_LINE_WORDS = 15;
const LINE_PAUSE = 0.5;

// Words in [start, end) as numbered lines that end at a sentence end, a pause > 0.5 s or after
// 15 words. The AI answers with line numbers, so clips always start and end on a line boundary.
function buildLines(words, start, end) {
  const inside = words.filter((word) => word.start >= start && word.start < end);
  const lines = [];
  let current = [];
  const flush = () => {
    if (!current.length) return;
    lines.push({ i: lines.length, start: current[0].start, end: current.at(-1).end, text: current.map((word) => word.word).join(" ") });
    current = [];
  };
  inside.forEach((word, index) => {
    const previous = inside[index - 1];
    if (previous && word.start - previous.end > LINE_PAUSE) flush();
    current.push(word);
    if (/[.?!]["')\]]?$/.test(word.word) || current.length >= MAX_LINE_WORDS) flush();
  });
  flush();
  return lines;
}

const MIN_CLIP = 20;
const MAX_CLIP = 50;
const LEAD = 0.1;
const TAIL = 0.2;
const KINDS = ["stream", "podcast", "other"];

const mmss = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const round = (value) => Math.round(value * 1000) / 1000;

// JSON schema for Ollama's structured output (`format`): the model must answer exactly this.
const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: KINDS },
    score: { type: "number" },
    start_line: { type: "integer" },
    end_line: { type: "integer" },
    title: { type: "string" },
    reason: { type: "string" },
  },
  required: ["kind", "score", "start_line", "end_line", "title", "reason"],
};

// English prompt (the model follows it best); title in the video's language, reason in Romanian.
function buildPrompt(lines) {
  return [
    "You choose the single best moment for a YouTube Short from a piece of a longer video.",
    "First decide what kind of video it is: \"stream\" (gaming/live stream), \"podcast\" (podcast/interview/talk) or \"other\".",
    "Good moments for a stream: strong reactions, funny moments, spectacular fails or wins, great one-liners.",
    "Good moments for a podcast: a strong idea said briefly, a story with an ending, a controversial opinion, clear advice.",
    "Always: the clip must make sense on its own without context and must hook the viewer in the first 2-3 seconds.",
    "The clip must be between 20 and 50 seconds long and must start and end at whole lines.",
    "Reply in JSON with: kind; score (0-10, how good this moment is as a Short; be strict, 5 is average);",
    "start_line and end_line (the line numbers in brackets, inclusive); title (a catchy Short title in the same language",
    "as the transcript, max 12 words); reason (why this moment works, in Romanian, max 15 words).",
    "",
    "Transcript (line number, time, text):",
    ...lines.map((line) => `[${line.i}] ${mmss(line.start)} ${line.text}`),
  ].join("\n");
}

const span = (lines, s, e) => lines[e].end + TAIL - Math.max(0, lines[s].start - LEAD);

// Validates the model's answer against the lines; widens a too-short span and trims a too-long
// one by whole lines (staying close to what the model chose). Returns a clip or null.
function parseAnswer(raw, lines) {
  let answer = raw;
  if (typeof answer === "string") { try { answer = JSON.parse(answer); } catch { return null; } }
  if (!answer || typeof answer !== "object") return null;
  let s = answer.start_line;
  let e = answer.end_line;
  if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e >= lines.length || s > e) return null;
  if (typeof answer.score !== "number" || !Number.isFinite(answer.score)) return null;
  for (let turn = 0; span(lines, s, e) < MIN_CLIP; turn += 1) {
    const canNext = e + 1 < lines.length;
    const canPrev = s > 0;
    if (!canNext && !canPrev) return null;
    if ((turn % 2 === 0 && canNext) || !canPrev) e += 1; else s -= 1;
  }
  for (let turn = 0; span(lines, s, e) > MAX_CLIP; turn += 1) {
    if (s >= e) return null;
    if (turn % 2 === 0) e -= 1; else s += 1;
  }
  if (span(lines, s, e) < MIN_CLIP) return null;
  return {
    kind: KINDS.includes(answer.kind) ? answer.kind : "other",
    score: Math.min(10, Math.max(0, answer.score)),
    start: round(Math.max(0, lines[s].start - LEAD)),
    end: round(lines[e].end + TAIL),
    title: String(answer.title || "").trim().slice(0, 100),
    reason: String(answer.reason || "").trim().slice(0, 160),
  };
}

const overlaps = (a, b) => a.start < b.end && b.start < a.end;

// Final 3: AI clips by AI score, then rule clips by rule score to fill, never overlapping.
// Rank 1 = best (AI clips always rank above rule clips). Returned in chronological order.
function pickFinal(aiClips, ruleClips, count = 3) {
  const chosen = [];
  for (const clip of [...aiClips].sort((a, b) => b.score - a.score)) {
    if (chosen.length < count && chosen.every((other) => !overlaps(other, clip))) {
      chosen.push({ start: clip.start, end: clip.end, source: "ai", aiScore: clip.score, title: clip.title, reason: clip.reason, kind: clip.kind });
    }
  }
  for (const clip of [...ruleClips].sort((a, b) => b.score - a.score)) {
    if (chosen.length < count && chosen.every((other) => !overlaps(other, clip))) {
      chosen.push({ start: clip.start, end: clip.end, source: "reguli", ruleScore: clip.score, entries: clip.entries });
    }
  }
  chosen.forEach((clip, index) => { clip.rank = index + 1; });
  return chosen.sort((a, b) => a.start - b.start);
}

module.exports = { buildLines, buildPrompt, parseAnswer, pickFinal, ANSWER_SCHEMA, MIN_CLIP, MAX_CLIP };
