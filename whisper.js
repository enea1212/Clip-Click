// Node side of the local Whisper transcription (transcribe.py does the speech recognition).
const { tidyTimings, isSpokenWord } = require("./subtitles");

// Seconds of processing per second of audio on this machine (model "small", int8, CPU).
// Measured on the user's i5-1235U; see the plan ledger.
const FACTOR = 0.45;
const WHISPER_MISSING = "Instalează faster-whisper: python -m pip install --user faster-whisper";
const MISSING_EXIT_CODE = 3;

function audioArgs({ start, end, output }) {
  const range = start === undefined ? [] : ["-ss", String(start)];
  const length = start === undefined || end === undefined ? [] : ["-t", String(end - start)];
  return ["-y", ...range, "-i", "source.mp4", ...length, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", output];
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

// True when YouTube has subtitles in the video's own language (manual RO/EN, or the original
// automatic track). Automatic translations into RO/EN don't count.
function hasOriginalSubtitles(info = {}) {
  const manual = Object.keys(info.subtitles || {});
  const auto = Object.keys(info.automatic_captions || {});
  if (manual.some((key) => /^(ro|en)(-|$)/.test(key) && !key.endsWith("-orig"))) return true;
  if (auto.includes("ro-orig") || auto.includes("en-orig")) return true;
  const language = String(info.language || "").slice(0, 2);
  return ["ro", "en"].includes(language) && auto.includes(language);
}

function estimateMinutes(durationSeconds) {
  return Math.max(1, Math.ceil((Number(durationSeconds) || 0) * FACTOR / 60));
}

module.exports = { FACTOR, WHISPER_MISSING, MISSING_EXIT_CODE, audioArgs, parseTranscript, hasOriginalSubtitles, estimateMinutes };
