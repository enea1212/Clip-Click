const CLIP_SECONDS = 34;
// Letter-aware word boundaries: \b does not treat ă, ș, ț... as letters.
const HOOKS = /(?<!\p{L})(because|but|secret|important|imagine|actually|never|always|problem|reason|finally|mistake|adevărat|imaginează|niciodată|mereu|problema|motivul|greșeală|adevărul|uite|deci|pentru că|înseamnă|nimeni)(?!\p{L})/giu;

function countHooks(text) {
  return (text.match(HOOKS) || []).length;
}

// Hooks are counted on the window's joined text, so a hook split across word groups still counts.
// Entries are word groups (≤4 words), about 3x more than VTT cues, so the completeness weight is 0.008 (was 0.025).
function scoreWindow(selected, start, duration) {
  const text = selected.map((entry) => entry.caption).join(" ");
  const density = text.split(/\s+/).filter(Boolean).length / duration;
  const complete = selected.filter((entry) => entry.start >= start + 2 && entry.end <= start + duration - 1).length;
  return density + countHooks(text) * 0.32 + complete * 0.008;
}

function chooseClips(entries) {
  const lastTime = entries.at(-1)?.end || 0;
  const candidates = [];
  for (let start = 0; start + CLIP_SECONDS <= lastTime; start += 5) {
    const selected = entries.filter((entry) => entry.end > start && entry.start < start + CLIP_SECONDS);
    const words = selected.map((entry) => entry.caption).join(" ").split(/\s+/).filter(Boolean).length;
    if (words < 24) continue;
    candidates.push({ start, end: start + CLIP_SECONDS, score: scoreWindow(selected, start, CLIP_SECONDS), entries: selected });
  }
  candidates.sort((a, b) => b.score - a.score);
  const chosen = [];
  for (const item of candidates) {
    if (chosen.every((prior) => Math.abs(prior.start - item.start) > CLIP_SECONDS + 10)) chosen.push(item);
    if (chosen.length === 3) break;
  }
  return chosen.sort((a, b) => a.start - b.start);
}

// Preselection for the AI: the `count` best non-overlapping windows of `length` seconds by the
// rule score, best first. The AI then reads only these (bounded time, even on hours of video).
function chooseCandidates(entries, { count = 10, length = 75, step = 15 } = {}) {
  const lastTime = entries.at(-1)?.end || 0;
  const windows = [];
  for (let start = 0; start + length <= lastTime; start += step) {
    const selected = entries.filter((entry) => entry.end > start && entry.start < start + length);
    const words = selected.map((entry) => entry.caption).join(" ").split(/\s+/).filter(Boolean).length;
    if (words < 10) continue;
    windows.push({ start, end: start + length, score: scoreWindow(selected, start, length) });
  }
  windows.sort((a, b) => b.score - a.score);
  const chosen = [];
  for (const item of windows) {
    if (chosen.every((prior) => item.start >= prior.end || item.end <= prior.start)) chosen.push(item);
    if (chosen.length === count) break;
  }
  return chosen;
}

// The score is a heuristic (speech density + hook words), not a probability, so the UI shows
// only the ranking: rank 1 = best score. Returns ranks in the clips' own (chronological) order.
function rankClips(clips) {
  const order = clips.map((clip, index) => ({ index, score: clip.score })).sort((a, b) => b.score - a.score);
  const ranks = new Array(clips.length);
  order.forEach((item, position) => { ranks[item.index] = position + 1; });
  return ranks;
}

module.exports = { chooseClips, chooseCandidates, countHooks, scoreWindow, rankClips };
