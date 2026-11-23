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
// The 7b model picks ~20 s whatever the prompt says (measured: 20–26 s on TED with "aim for
// 30–45 s"); short picks are widened by whole lines around its core to reach this when possible.
const TARGET_MIN = 30;
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

const LANGUAGE_NAMES = { en: "English", ro: "Romanian", de: "German", fr: "French", es: "Spanish", it: "Italian" };

// English prompt (the model follows it best); title in the video's language, reason in Romanian.
// The language is named explicitly when known: "same language as the transcript" alone made the
// 7b model write Romanian titles for English videos.
function buildPrompt(lines, { language, loudAt } = {}) {
  const languageName = LANGUAGE_NAMES[String(language || "").slice(0, 2)];
  const titleRule = languageName
    ? `title (a catchy Short title, max 12 words). The title MUST be written in ${languageName}, the language of the transcript`
    : "title (a catchy Short title in the same language as the transcript, max 12 words)";
  return [
    "You choose the single best moment for a YouTube Short from a piece of a longer video.",
    "First decide what kind of video it is: \"stream\" (gaming/live stream), \"podcast\" (podcast/interview/talk) or \"other\".",
    "Good moments for a stream: strong reactions, funny moments, spectacular fails or wins, great one-liners.",
    "Good moments for a podcast: a strong idea said briefly, a story with an ending, a controversial opinion, clear advice.",
    "Always: the clip must make sense on its own without context and must hook the viewer in the first 2-3 seconds.",
    "The clip must be between 20 and 50 seconds long (aim for 30-45 seconds: long enough to tell the whole",
    "moment) and must start and end at whole lines.",
    "Reply in JSON with: kind; score (0-10, how good this moment is as a Short; be strict, 5 is average);",
    `start_line and end_line (the line numbers in brackets, inclusive); ${titleRule};`,
    "reason (why this moment works, max 15 words). The reason MUST be written in Romanian (limba română),",
    "whatever the language of the transcript, e.g. \"Reacție amuzantă la o greșeală neașteptată.\"",
    "",
    // Candidates chosen for a loudness peak: tell the model, since the transcript can't show it.
    ...(loudAt !== undefined ? [`Note: the audio gets suddenly loud around ${mmss(loudAt)} (possible shouting, laughter or a big reaction).`] : []),
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
  // Widen toward TARGET_MIN, never past MAX_CLIP (a line that would overshoot is not added).
  for (let turn = 0; span(lines, s, e) < TARGET_MIN; turn += 1) {
    const canNext = e + 1 < lines.length && span(lines, s, e + 1) <= MAX_CLIP;
    const canPrev = s > 0 && span(lines, s - 1, e) <= MAX_CLIP;
    if (!canNext && !canPrev) break;
    if ((turn % 2 === 0 && canNext) || !canPrev) e += 1; else s -= 1;
  }
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

// --- Final ranking pass ----------------------------------------------------------------
// Scored one by one, the 7b model gives almost every candidate the same score (all 7 on a real
// TED talk). Seen side by side it ranks them clearly, so one extra call orders the candidates.

const RANK_SCHEMA = {
  type: "object",
  properties: { order: { type: "array", items: { type: "integer" } } },
  required: ["order"],
};

const opening = (text, words = 40) => String(text).split(/\s+/).slice(0, words).join(" ");

// candidates: [{ title, text }] — text = the clip's transcript.
function buildRankPrompt(candidates) {
  return [
    "Below are candidate moments from one video, each with a proposed YouTube Short title and its opening words.",
    "Rank them from best to worst as YouTube Shorts: strongest hook in the first seconds, makes sense without",
    "context, funny or emotional or a strong idea or a complete story. Be decisive: they are NOT equally good.",
    "Reply in JSON: {\"order\": [candidate numbers, best first]} including every candidate exactly once.",
    "",
    ...candidates.map((candidate, index) => `[${index}] ${candidate.title} — ${opening(candidate.text)}`),
  ].join("\n");
}

// The model's order, cleaned: duplicates and unknown numbers dropped, missing ones appended in
// their original order. null if the answer isn't usable at all.
function parseRanking(raw, count) {
  let answer = raw;
  if (typeof answer === "string") { try { answer = JSON.parse(answer); } catch { return null; } }
  if (!answer || !Array.isArray(answer.order)) return null;
  const seen = new Set();
  for (const value of answer.order) if (Number.isInteger(value) && value >= 0 && value < count) seen.add(value);
  for (let index = 0; index < count; index += 1) seen.add(index);
  return [...seen];
}

const overlaps = (a, b) => a.start < b.end && b.start < a.end;

// Final 3: AI clips by the ranking pass (`order`, 0 = best) or else by AI score, then rule clips
// by rule score to fill, never overlapping. Rank 1 = best (AI clips always rank above rule clips).
// Returned in chronological order.
function pickFinal(aiClips, ruleClips, count = 3) {
  const chosen = [];
  const byQuality = (a, b) => (a.order !== undefined && b.order !== undefined ? a.order - b.order : b.score - a.score);
  for (const clip of [...aiClips].sort(byQuality)) {
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

// The final pick with a safety net: if AI clips overlap the rule picks so that fewer than `count`
// remain, the rules alone (which had enough) are used — never fail where the rules would succeed.
function chooseFinal(aiClips, ruleClips, count = 3) {
  const final = pickFinal(aiClips, ruleClips, count);
  return final.length < count ? pickFinal([], ruleClips, count) : final;
}

// --- Ollama HTTP (local)---------------------------------------------------------------

const OLLAMA_URL = process.env.CLIPTREI_OLLAMA_URL || "http://127.0.0.1:11434";
const MODEL = process.env.CLIPTREI_MODEL || "qwen2.5:7b";
const ANSWER_TIMEOUT_MS = 180_000;
// Whole AI stage (all candidates + ranking): 12 min, so it never holds the single heavy job for
// half an hour. A sixth is kept for the ranking pass. Candidates not asked in time: rules fill.
const AI_BUDGET_MS = Number(process.env.CLIPTREI_AI_BUDGET_MS) || 720_000;
const RANK_RESERVE_MS = AI_BUDGET_MS / 6;

// Timeout for the next answer: at most 3 min, and never past the deadline minus `reserve`.
// ≤ 0 means: don't ask any more.
// Whole ms: AbortSignal.timeout rejects fractions.
const timeLeft = (deadline, now, reserve = 0) => Math.floor(Math.min(ANSWER_TIMEOUT_MS, deadline - now - reserve));

// Order in which to ask the candidates: speech and loud windows alternate (speech first), so a
// budget cut keeps the mix instead of dropping all loud windows, which come last in the list.
function askOrder(candidates) {
  const speech = [];
  const loud = [];
  candidates.forEach((candidate, index) => (candidate.origin === "loud" ? loud : speech).push(index));
  const order = [];
  for (let i = 0; i < Math.max(speech.length, loud.length); i += 1) {
    if (i < speech.length) order.push(speech[i]);
    if (i < loud.length) order.push(loud[i]);
  }
  return order;
}

async function fetchJson(url, options, timeoutMs) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// Is Ollama running, with the model downloaded? { ok, reason } — the reason is shown to Enea.
async function ollamaStatus(url = OLLAMA_URL, model = MODEL) {
  try {
    const tags = await fetchJson(`${url}/api/tags`, {}, 3000);
    const names = (tags.models || []).map((item) => item.name);
    if (!names.some((name) => name === model || name === `${model}:latest`)) return { ok: false, reason: `modelul ${model} nu e descărcat (ollama pull ${model})` };
    return { ok: true };
  } catch {
    return { ok: false, reason: "Ollama nu rulează" };
  }
}

// One model answer: the raw JSON text (parseAnswer / parseRanking validate it).
async function askOllama(prompt, { url = OLLAMA_URL, model = MODEL, timeoutMs = ANSWER_TIMEOUT_MS, schema = ANSWER_SCHEMA } = {}) {
  const result = await fetchJson(`${url}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: false, format: schema, keep_alive: "10m", options: { temperature: 0.2 } }),
  }, timeoutMs);
  return result.response;
}

module.exports = { buildLines, buildPrompt, parseAnswer, buildRankPrompt, parseRanking, pickFinal, chooseFinal, ollamaStatus, askOllama, timeLeft, askOrder, AI_BUDGET_MS, RANK_RESERVE_MS, ANSWER_TIMEOUT_MS, ANSWER_SCHEMA, RANK_SCHEMA, MIN_CLIP, MAX_CLIP, MODEL };
