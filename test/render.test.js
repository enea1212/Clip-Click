const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../render");

const has = (args, ...seq) => args.some((_, i) => seq.every((v, j) => args[i + j] === v));
const base = { start: 10, end: 44, srcW: 1920, srcH: 1080, zoom: 1, subtitles: "captions-1.ass", output: "short-1-1.mp4" };

test("clip without split: one input, maps [v] and source audio", () => {
  const args = R.clipArgs({ ...base, split: false });
  assert.ok(!args.includes("-stream_loop"));
  assert.ok(has(args, "-map", "[v]", "-map", "0:a?"));
  assert.ok(has(args, "-ss", "10", "-i", "source.mp4"));
  assert.ok(has(args, "-t", "34"));
  assert.equal(args.at(-1), "short-1-1.mp4");
});

test("clip with split: gameplay input loops from its start", () => {
  const args = R.clipArgs({ ...base, split: true, satisfyingPath: "D:/AI_SLOP/satisfying/slime.mp4", satisfyingStart: 12.5 });
  assert.ok(has(args, "-stream_loop", "-1", "-ss", "12.5", "-i", "D:/AI_SLOP/satisfying/slime.mp4"));
  assert.match(args[args.indexOf("-filter_complex") + 1], /vstack/);
});

test("raw preview: 640 wide with audio", () => {
  const args = R.rawPreviewArgs({ start: 10, end: 44, output: "raw-1.mp4" });
  assert.ok(has(args, "-ss", "10", "-i", "source.mp4"));
  assert.ok(has(args, "-vf", "scale=640:-2"));
  assert.ok(args.includes("aac"));
  assert.ok(!args.includes("-an"));
  assert.equal(args.at(-1), "raw-1.mp4");
});

test("sat preview: cropped to 1080:960 aspect, no audio", () => {
  const args = R.satPreviewArgs({ satisfyingPath: "S:/s.mkv", satisfyingStart: 3, length: 34, output: "sat-1.mp4" });
  assert.ok(has(args, "-stream_loop", "-1", "-ss", "3", "-i", "S:/s.mkv"));
  assert.ok(has(args, "-vf", "scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,scale=640:-2"));
  assert.ok(args.includes("-an"));
  assert.ok(has(args, "-t", "34"));
});

test("probe args ask for width, height, duration as json", () => {
  const args = R.probeArgs("source.mp4");
  assert.ok(has(args, "-print_format", "json"));
  assert.ok(has(args, "-show_entries", "stream=width,height,r_frame_rate:stream_side_data=rotation:format=duration"));
  assert.ok(has(args, "-select_streams", "v:0"));
  assert.equal(args.at(-1), "source.mp4");
});

test("parseProbe: reads size and duration", () => {
  const out = R.parseProbe(JSON.stringify({ streams: [{ width: 1920, height: 1080 }], format: { duration: "12.5" } }));
  assert.deepEqual(out, { width: 1920, height: 1080, duration: 12.5, fps: 0 });
});

test("parseProbe: rotated phone video swaps width and height", () => {
  const out = R.parseProbe(JSON.stringify({ streams: [{ width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] }], format: { duration: "5" } }));
  assert.equal(out.width, 1080);
  assert.equal(out.height, 1920);
});

test("parseProbe: missing size throws a clear Romanian error", () => {
  assert.throws(() => R.parseProbe(JSON.stringify({ streams: [], format: {} })), /dimensiunile/);
});

test("clip with segments maps concat audio and uses the cut duration", () => {
  const args = R.clipArgs({ ...base, split: false, segments: [{ start: 0.9, end: 2.1 }, { start: 2.9, end: 3.5 }] });
  assert.ok(has(args, "-map", "[ca]"));
  assert.ok(!args.includes("0:a?"));
  assert.ok(has(args, "-t", "1.8"));
});

test("parseProbe reads the frame rate (for frame-accurate cuts)", () => {
  const out = R.parseProbe(JSON.stringify({ streams: [{ width: 1920, height: 1080, r_frame_rate: "30000/1001" }], format: { duration: "5" } }));
  assert.ok(Math.abs(out.fps - 29.97) < 0.01);
  assert.equal(R.parseProbe(JSON.stringify({ streams: [{ width: 1, height: 1 }], format: {} })).fps, 0);
});
