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

module.exports = { buildLines };
