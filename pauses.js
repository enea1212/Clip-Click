// Pause cutting: find the stretches of speech inside a clip and move words onto
// the shortened timeline. All returned times are relative to the clip start.

// A word that is mostly outside the clip (e.g. the tail of the previous sentence) is dropped,
// otherwise its sliver becomes a tiny segment and a flashed subtitle at the clip edge.
const MIN_INSIDE_SHARE = 0.5;

function clipWords(words, clipStart, clipEnd) {
  const length = clipEnd - clipStart;
  return words
    .filter((word) => word.end > clipStart && word.start < clipEnd)
    .filter((word) => {
      const inside = Math.min(word.end, clipEnd) - Math.max(word.start, clipStart);
      return inside >= MIN_INSIDE_SHARE * (word.end - word.start);
    })
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

// ffmpeg's trim cuts video on frame boundaries; snapping the segment edges to frames first
// keeps the subtitle timeline (built from the same segments) in step with the picture.
function snapSegments(segments, fps) {
  if (!(fps > 0)) return segments;
  const snap = (t) => Math.round(t * fps) / fps;
  return segments.map((seg) => ({ start: snap(seg.start), end: snap(seg.end) })).filter((seg) => seg.end > seg.start);
}

module.exports = { speechSegments, remapWords, totalDuration, snapSegments };
