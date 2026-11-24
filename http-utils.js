const path = require("node:path");

// Only the app's own front-end files and the project videos are served; project data,
// source code, docs and the satisfying folder stay private.
const APP_FILES = new Set(["index.html", "app.js", "layout.js", "story-ui.js", "styles.css", "ui.css"]);
// Project videos, and the decor images of story projects (thumbnails in the storyboard).
const DATA_VIDEO = /^\/data\/([0-9a-f-]{36})\/([A-Za-z0-9_-]+\.(?:mp4|png))$/;

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

// Blocks requests that don't come from this app's own pages:
// - Host must be this server (also stops DNS-rebinding tricks);
// - changing requests (POST/DELETE) with an Origin must come from this server's own page
//   (browsers always send Origin there; tools like curl send none and are allowed);
// - POST must be JSON, so a cross-site form or text/plain fetch can't slip past without a preflight.
// Returns null when the request is fine, otherwise { status, message }.
function checkRequest(method, headers, port) {
  const allowed = [`localhost:${port}`, `127.0.0.1:${port}`];
  if (!allowed.includes(String(headers.host || "").toLowerCase())) return { status: 403, message: "Acces refuzat." };
  if (method === "GET" || method === "HEAD") return null;
  if (headers.origin && !allowed.map((host) => `http://${host}`).includes(String(headers.origin).toLowerCase())) {
    return { status: 403, message: "Acces refuzat." };
  }
  if (method === "POST" && !/^application\/json(\s*;|$)/i.test(String(headers["content-type"] || ""))) {
    return { status: 415, message: "Cererea trebuie să fie JSON." };
  }
  return null;
}

module.exports = { resolveStatic, decodePath, parseRange, checkRequest };
