// Node side of the local Whisper transcription (transcribe.py does the speech recognition).
const { tidyTimings, isSpokenWord } = require("./subtitles");

// Seconds of processing per second of audio on this machine (model "small", int8, CPU).
// Measured on the user's i5-1235U; see the plan ledger.
const FACTOR = 0.45;
const WHISPER_MISSING = "Instalează faster-whisper: python -m pip install --user faster-whisper";
const MISSING_EXIT_CODE = 3;

function audioArgs({ start, end, output, source = "source.mp4" }) {
  const range = start === undefined ? [] : ["-ss", String(start)];
  const length = start === undefined || end === undefined ? [] : ["-t", String(end - start)];
  return ["-y", ...range, "-i", source, ...length, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", output];
}

function parseTranscript(stdout, offset = 0) {
  const data = JSON.parse(stdout);
  // Whisper starts every new word with a space; a piece without one continues the previous
  // word (e.g. " non" + "-procrastinators"), so join them back together.
  const joined = [];
  for (const item of data.words || []) {
    const raw = String(item.word || "");
    const piece = { word: raw.trim(), start: Number(item.start) + offset, end: Number(item.end) + offset };
    if (!piece.word || !Number.isFinite(piece.start) || !Number.isFinite(piece.end)) continue;
    const last = joined.at(-1);
    if (last && !/^\s/.test(raw)) {
      last.word += piece.word;
      last.end = piece.end;
    } else {
      joined.push(piece);
    }
  }
  return tidyTimings(joined.filter((item) => isSpokenWord(item.word)));
}

// The subtitle tracks yt-dlp is asked for. hasOriginalSubtitles uses the same list, so the
// pre-check never promises a track that the download then doesn't fetch.
const SUB_LANGS = "ro,ro-orig,ro-RO,en,en-orig,en-US,en-GB";
const MANUAL_LANGS = SUB_LANGS.split(",").filter((code) => !code.endsWith("-orig"));

// True when YouTube has subtitles in the video's own language (manual RO/EN, or the original
// automatic track). Automatic translations into RO/EN don't count.
function hasOriginalSubtitles(info = {}) {
  const manual = Object.keys(info.subtitles || {});
  const auto = Object.keys(info.automatic_captions || {});
  if (manual.some((key) => MANUAL_LANGS.includes(key))) return true;
  if (auto.includes("ro-orig") || auto.includes("en-orig")) return true;
  const language = String(info.language || "").slice(0, 2);
  return ["ro", "en"].includes(language) && auto.includes(language);
}

// Long audio is transcribed in windows (memory stays small on a 16 GB laptop). The audio of each
// window reaches `overlap` seconds past both seams, so a word crossing a seam is heard whole in
// both windows; it belongs to the window where it starts (keepFrom <= start < keepTo).
// (Starting a window exactly at the seam made Whisper hear the cut-off word as a new one.)
function chunkPlan(duration, size = 600, overlap = 5) {
  const plan = [];
  for (let keepFrom = 0; keepFrom < duration; keepFrom += size) {
    const last = keepFrom + size >= duration;
    plan.push({ start: Math.max(0, keepFrom - overlap), end: last ? duration : keepFrom + size + overlap, keepFrom, keepTo: last ? Infinity : keepFrom + size });
  }
  return plan.length ? plan : [{ start: 0, end: duration, keepFrom: 0, keepTo: Infinity }];
}

function mergeChunks(results) {
  const words = [];
  for (const { chunk, words: chunkWords } of results) {
    for (const word of chunkWords) if (word.start >= chunk.keepFrom && word.start < chunk.keepTo) words.push(word);
  }
  return tidyTimings(words.sort((a, b) => a.start - b.start));
}

// "source.en-orig.vtt" -> "en"; anything else (e.g. "whisper") -> null.
function trackLanguage(name) {
  const match = /^source\.(ro|en)(?:-[A-Za-z]+)?\.vtt$/.exec(String(name || ""));
  return match ? match[1] : null;
}

function estimateMinutes(durationSeconds) {
  return Math.max(1, Math.ceil((Number(durationSeconds) || 0) * FACTOR / 60));
}

module.exports = { SUB_LANGS, FACTOR, WHISPER_MISSING, MISSING_EXIT_CODE, audioArgs, parseTranscript, hasOriginalSubtitles, estimateMinutes, chunkPlan, mergeChunks, trackLanguage };
