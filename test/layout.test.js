const test = require("node:test");
const assert = require("node:assert/strict");
const { zoomSize, buildFilter, boxFor } = require("../layout");

test("zoom 1 fills the box, zoom 0 fits the whole video (16:9 into 9:16)", () => {
  assert.deepEqual(zoomSize(1920, 1080, 1080, 1920, 1), { w: 3414, h: 1920 });
  assert.deepEqual(zoomSize(1920, 1080, 1080, 1920, 0), { w: 1080, h: 608 });
});

test("zoom 0.5 is halfway between fit and fill", () => {
  const { w } = zoomSize(1920, 1080, 1080, 1920, 0.5);
  assert.ok(Math.abs(w - (1080 + 3414) / 2) <= 2);
});

test("split top box 1080x960", () => {
  assert.deepEqual(boxFor(true), { w: 1080, h: 960 });
  assert.deepEqual(boxFor(false), { w: 1080, h: 1920 });
  assert.deepEqual(zoomSize(1920, 1080, 1080, 960, 1), { w: 1706, h: 960 });
});

test("vertical source: fit == fill, no crash", () => {
  assert.deepEqual(zoomSize(1080, 1920, 1080, 1920, 0), { w: 1080, h: 1920 });
  assert.deepEqual(zoomSize(1080, 1920, 1080, 1920, 1), { w: 1080, h: 1920 });
});

test("odd source sizes give even output sizes", () => {
  for (const z of [0, 0.33, 0.5, 1]) {
    const { w, h } = zoomSize(1279, 719, 1080, 1920, z);
    assert.equal(w % 2, 0);
    assert.equal(h % 2, 0);
  }
});

test("filter without split: blurred bg, centred fg, subtitles, output [v]", () => {
  const f = buildFilter({ srcW: 1920, srcH: 1080, zoom: 0, split: false, subtitles: "captions-1.ass" });
  assert.match(f, /boxblur/);
  assert.match(f, /scale=1080:608/);
  assert.match(f, /overlay=\(W-w\)\/2:\(H-h\)\/2/);
  assert.match(f, /subtitles=captions-1\.ass\[v\]$/);
  assert.doesNotMatch(f, /\[1:v\]/);
});

test("filter with split: gameplay input stacked below the 1080x960 top", () => {
  const f = buildFilter({ srcW: 1920, srcH: 1080, zoom: 1, split: true, subtitles: "captions-2.ass" });
  assert.match(f, /\[1:v\]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960/);
  assert.match(f, /vstack/);
  assert.match(f, /subtitles=captions-2\.ass\[v\]$/);
});
