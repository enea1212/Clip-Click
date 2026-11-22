const path = require("node:path");

// Only the app's own front-end files and the project videos are served; project data,
// source code, docs and the satisfying folder stay private.
const APP_FILES = new Set(["index.html", "app.js", "layout.js", "styles.css", "ui.css"]);
const DATA_VIDEO = /^\/data\/([0-9a-f-]{36})\/([A-Za-z0-9_-]+\.mp4)$/;

function resolveStatic(root, pathname) {
  const name = pathname === "/" ? "index.html" : pathname.slice(1);
  if (APP_FILES.has(name)) return path.join(root, name);
  const match = pathname.match(DATA_VIDEO);
  return match ? path.join(root, "data", match[1], match[2]) : null;
}

function decodePath(raw) {
  try { return decodeURIComponent(raw); } catch { return null; }
}

// null = no Range header, "invalid" = answer 416, otherwise the byte range to send.
function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
  if (!match) return "invalid";
  const start = Number(match[1]);
  const end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  return start < size && start <= end ? { start, end } : "invalid";
}

module.exports = { resolveStatic, decodePath, parseRange };
