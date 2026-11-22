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

module.exports = { chooseClips, countHooks, scoreWindow };
