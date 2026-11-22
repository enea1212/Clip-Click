// Pause cutting: find the stretches of speech inside a clip and move words onto
// the shortened timeline. All returned times are relative to the clip start.

function clipWords(words, clipStart, clipEnd) {
  const length = clipEnd - clipStart;
  return words
    .filter((word) => word.end > clipStart && word.start < clipEnd)
    .map((word) => ({ word: word.word, start: Math.max(0, word.start - clipStart), end: Math.min(length, word.end - clipStart) }))
    .filter((word) => word.end > word.start);
}

function speechSegments(words, clipStart, clipEnd, { gap = 0.4, pad = 0.1 } = {}) {
  const length = clipEnd - clipStart;
  const speech = [];
  for (const word of clipWords(words, clipStart, clipEnd)) {
    const last = speech.at(-1);
    if (last && word.start - last.end <= gap) last.end = Math.max(last.end, word.end);
    else speech.push({ start: word.start, end: word.end });
  }
  // Pad each stretch, then merge stretches whose padding now touches.
  const segments = [];
  for (const part of speech) {
    const padded = { start: Math.max(0, part.start - pad), end: Math.min(length, part.end + pad) };
    const last = segments.at(-1);
    if (last && padded.start <= last.end) last.end = Math.max(last.end, padded.end);
    else segments.push(padded);
  }
  return segments;
}

function totalDuration(segments) {
  return segments.reduce((sum, seg) => sum + (seg.end - seg.start), 0);
}

function remapWords(words, clipStart, segments) {
  const clipEnd = clipStart + (segments.at(-1)?.end ?? 0);
  const out = [];
  for (const word of clipWords(words, clipStart, clipEnd)) {
    let offset = 0;
    for (const seg of segments) {
      if (word.start >= seg.start - 1e-9 && word.start < seg.end) {
        out.push({ word: word.word, start: offset + word.start - seg.start, end: offset + Math.min(word.end, seg.end) - seg.start });
        break;
      }
      offset += seg.end - seg.start;
    }
  }
  return out;
}

module.exports = { speechSegments, remapWords, totalDuration };
