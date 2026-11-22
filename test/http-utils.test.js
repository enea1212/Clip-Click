const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const H = require("../http-utils");

const ROOT = path.resolve("/app");
const UUID = "c04a7294-7d69-445e-bcd0-c12165281187";

test("static: only the app files and project videos are served", () => {
  assert.equal(H.resolveStatic(ROOT, "/"), path.join(ROOT, "index.html"));
  for (const file of ["/app.js", "/layout.js", "/styles.css", "/ui.css", "/index.html"]) assert.equal(H.resolveStatic(ROOT, file), path.join(ROOT, file.slice(1)));
  assert.equal(H.resolveStatic(ROOT, `/data/${UUID}/short-1-123.mp4`), path.join(ROOT, "data", UUID, "short-1-123.mp4"));
  assert.equal(H.resolveStatic(ROOT, `/data/${UUID}/sat-2.mp4`), path.join(ROOT, "data", UUID, "sat-2.mp4"));
  for (const blocked of ["/server.js", "/docs/x.md", "/.superpowers/a", `/data/${UUID}/project.json`, `/data/${UUID}/words.json`, `/data/${UUID}/../../server.js`, "/data/../server.js", "/satisfying/x.mp4"]) {
    assert.equal(H.resolveStatic(ROOT, blocked), null, blocked);
  }
});

test("path decoding: malformed percent-encoding is rejected, not thrown", () => {
  assert.equal(H.decodePath("/a%20b"), "/a b");
  assert.equal(H.decodePath("/%E0%A4%A"), null);
});

test("range: valid, open-ended, and invalid headers", () => {
  assert.deepEqual(H.parseRange("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(H.parseRange("bytes=500-", 1000), { start: 500, end: 999 });
  assert.deepEqual(H.parseRange("bytes=900-5000", 1000), { start: 900, end: 999 });
  for (const bad of ["bytes=abc-", "bytes=1000-", "bytes=50-10", "bytes=-", "items=0-1"]) assert.equal(H.parseRange(bad, 1000), "invalid", bad);
  assert.equal(H.parseRange(undefined, 1000), null);
});
