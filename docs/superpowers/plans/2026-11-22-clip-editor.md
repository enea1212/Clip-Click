# Clip Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-clip editor (zoom with blurred bars, optional "satisfying" gameplay in the bottom half), re-render on "Aplică", and reopenable projects ("Proiectele mele").

**Architecture:** Pure, unit-tested modules build everything ffmpeg needs (`layout.js` geometry + filtergraph, `subtitles.js` split layout, `projects.js` storage/listing/gameplay pick, `render.js` ffmpeg arg arrays). `server.js` wires them to HTTP endpoints and runs ffmpeg/ffprobe/yt-dlp. The browser preview reuses `layout.js` (loaded as a plain script) so CSS and ffmpeg use the same zoom formula.

**Tech Stack:** Node 24 CommonJS, `node:test`, ffmpeg/ffprobe, yt-dlp, vanilla JS/HTML/CSS. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-22-clip-editor-design.md`

## Global Constraints

- No new dependencies. Test command: `node --test` (no directory argument; Node 24/Windows).
- Canvas 1080×1920. With "Video jos": top box 1080×960 (original), bottom 1080×960 (gameplay, fill+center crop, muted).
- Zoom `z ∈ [0,1]`: `fit = min(W/w, H/h)`, `fill = max(W/w, H/h)`, `scale = fit + z·(fill − fit)`; scaled size rounded to even. Default `zoom = 1`, `satisfyingOn = false`.
- Bars = same video scaled to fill the box, blurred and slightly darkened.
- Subtitles: no split → current style (alignment 2, `MarginV=480`); split → alignment 5, `MarginV=0` (centred on y=960).
- ffmpeg always runs with `cwd` = project folder; filter args use bare file names (no `D:` paths). Satisfying input path is passed via `-i` (not inside a filter), so an absolute path is fine there.
- Satisfying files: `satisfying/*.{mp4,mov,webm,mkv}` (case-insensitive); random file + random start in `[0, max(0, duration − clipLength)]`; loop when shorter (`-stream_loop -1`).
- Project ids are UUIDs; any id not matching `/^[0-9a-f-]{36}$/` → 400. Folder `data/<id>/project.json` is the source of truth.
- Preview files: `raw-N.mp4` (clip segment, width 640, original aspect, with audio, no subs), `sat-N.mp4` (gameplay segment, width 640, cropped to 1080:960 aspect, no audio).
- Rendered clip file name: `short-N-<Date.now()>.mp4`; the previous file for that clip is deleted after a successful render.
- UI copy (Romanian, exact): „Editează”, „Descarcă”, „Aplică”, „Renunță”, „Se randează…”, „Video jos”, „↻ Alt video”, „Zoom”, „Proiectele mele”, „Deschide”, „Șterge”, „doar vizionare”, error „Pune cel puțin un video în folderul satisfying/”.
- No git repo: no commit steps; keep the ledger in `.superpowers/sdd/2026-11-22-clip-editor/progress.md`.

## Review Focus

1. Vertical (9:16) or square source videos — `fit == fill` or bars on the sides; expect no crash and a sensible picture at every zoom. (Test in Task 1.)
2. Odd source dimensions (e.g. 1279×719) — expect even scaled sizes; ffmpeg/libx264 rejects odd sizes. (Test in Task 1.)
3. Gameplay file shorter than the clip, or exactly as long — expect start 0 and looping, never a negative start. (Test in Task 3.)
4. Path traversal through `id` or a gameplay file name (`../`, `..\\`) — expect rejection before any file access. (Test in Task 3.)
5. Corrupt or missing `project.json` in a folder — expect the list to skip it or mark it legacy, never to crash the endpoint. (Test in Task 3.)

---

### Task 1: Layout geometry and ffmpeg filtergraph

**Files:**
- Create: `layout.js` (works in Node via `module.exports` and in the browser as `window.Layout`)
- Test: `test/layout.test.js`

**Interfaces:**
- Produces:
  - `zoomSize(srcW, srcH, boxW, boxH, zoom) => { w, h }` — even integers, per the zoom formula.
  - `buildFilter({ srcW, srcH, zoom, split, subtitles }) => string` — complete `-filter_complex` graph. Input `[0:v]` is the source, `[1:v]` the gameplay when `split`. Output label `[v]`. `subtitles` is a bare `.ass` file name.
  - Constants `CANVAS = { w: 1080, h: 1920 }`, `boxFor(split) => { w: 1080, h: split ? 960 : 1920 }`.

- [ ] **Step 1: Write the failing tests**

```js
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
  assert.deepEqual(zoomSize(1920, 1080, 1080, 960, 1), { w: 1706, h: 960 });
});

test("vertical source: fit == fill, no crash", () => {
  assert.deepEqual(zoomSize(1080, 1920, 1080, 1920, 0), { w: 1080, h: 1920 });
  assert.deepEqual(zoomSize(1080, 1920, 1080, 1920, 1), { w: 1080, h: 1920 });
});

test("odd source sizes give even output sizes", () => {
  for (const z of [0, 0.33, 0.5, 1]) {
    const { w, h } = zoomSize(1279, 719, 1080, 1920, z);
    assert.equal(w % 2, 0); assert.equal(h % 2, 0);
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
```

- [ ] **Step 2: Run to verify failure** — `node --test` → FAIL `Cannot find module '../layout'`.

- [ ] **Step 3: Implement `layout.js`**
  Even rounding: `Math.max(2, Math.round(x / 2) * 2)`. Graph per box: `[0:v]split[a][b];[a]scale=W:H:force_original_aspect_ratio=increase,crop=W:H,boxblur=20:2,eq=brightness=-0.12[bg];[b]scale=w:h,crop=min(w,W):min(h,H)[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2` (use the numbers, not the letters, for scale/crop). Split appends `[top];[1:v]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,setsar=1[bot];[top][bot]vstack`. Always end with `,setsar=1,subtitles=<file>[v]`. UMD tail: `if (typeof module !== "undefined") module.exports = api; else window.Layout = api;`.

- [ ] **Step 4: Run** — `node --test` → all pass.

---

### Task 2: Subtitles for the split layout

**Files:**
- Modify: `subtitles.js` (`buildAss`)
- Test: `test/subtitles.test.js` (append)

**Interfaces:**
- Produces: `buildAss(words, clipStart, clipEnd, { split = false } = {})` — same output as today when `split` is false; when true the `Style:` line has alignment `5` and `MarginV` `0`.

- [ ] **Step 1: Failing test**

```js
test("ass: split layout centres text on the middle line", () => {
  const style = (ass) => ass.split("\n").find((l) => l.startsWith("Style:")).split(",");
  const normal = style(buildAss([w("a", 0, 1)], 0, 5));
  const split = style(buildAss([w("a", 0, 1)], 0, 5, { split: true }));
  assert.equal(normal[18], "2"); assert.equal(normal[21], "480");
  assert.equal(split[18], "5"); assert.equal(split[21], "0");
});
```

- [ ] **Step 2: Verify failure** — `node --test` → that test FAILS (`"2" !== "5"`).
- [ ] **Step 3: Implement** — build the `Style:` line from `split`.
- [ ] **Step 4: Run** — `node --test` → all pass.

---

### Task 3: Project store, listing, gameplay pick

**Files:**
- Create: `projects.js`
- Test: `test/projects.test.js` (uses `fs.mkdtempSync(os.tmpdir())` folders)

**Interfaces:**
- Produces:
  - `isValidId(id) => boolean` (`/^[0-9a-f-]{36}$/`).
  - `readProject(dataDir, id) => object | null` (null if missing/invalid JSON or invalid id).
  - `saveProject(dataDir, project) => void` (writes `project.json` atomically: write `project.json.tmp`, then rename).
  - `listProjects(dataDir) => Array<{ id, title, createdAt, clipCount, legacy: boolean, videos?: string[] }>` — newest first; folders with `project.json` → `legacy:false`; folders without it but with `short-*.mp4` → `legacy:true`, `title` = folder id, `createdAt` = folder mtime ISO, `videos` = `/data/<id>/short-N.mp4` paths; folders with neither (or invalid name) skipped; corrupt JSON → treated as legacy if it has shorts, else skipped.
  - `deleteProject(dataDir, id) => boolean` (rejects invalid id).
  - `listSatisfying(dir) => string[]` file names (allowed extensions, case-insensitive; `[]` if folder missing).
  - `pickSatisfying(files, durationOf, clipLength, random = Math.random) => { file, start }` — `durationOf(file)` returns seconds (sync or async allowed: make it `async`); start = `random() * max(0, duration − clipLength)` rounded to 0.01; throws `Error("Pune cel puțin un video în folderul satisfying/")` when `files` is empty.
  - `safeSatisfyingName(name) => boolean` — true only for a bare file name (no `/`, `\`, `..`) with an allowed extension.

- [ ] **Step 1: Failing tests** — names and assertions:
  - `"ids: only UUIDs are valid"` — `isValidId("7bb46251-cf59-437a-b47a-994b472c24da")` true; `"../etc"`, `"..\\x"`, `""` false.
  - `"save then read round-trips; invalid id reads null"`.
  - `"list: new projects first, legacy folders marked, empty and corrupt folders skipped"` — create A (project.json, createdAt 2026-01-01), B (project.json, 2026-02-01), C (only `short-1.mp4`), D (empty), E (corrupt `project.json`, no shorts) → ids `[B, A, C]` in order, `C.legacy === true`, `C.videos` = `["/data/C/short-1.mp4"]`.
  - `"delete removes the folder and rejects bad ids"`.
  - `"satisfying: allowed extensions only, missing folder gives []"` — files `a.MP4, b.mkv, c.txt, d.webm` → `["a.MP4","b.mkv","d.webm"]` (sorted).
  - `"pick: start within range; short file starts at 0; empty list throws the Romanian message"` — duration 100, clip 34, random 0.5 → start 33; duration 20 → start 0; `[]` → rejects with message `/satisfying\//`.
  - `"safe names reject traversal"` — `"../x.mp4"`, `"a\\b.mp4"`, `"x.exe"` false; `"slime.mp4"` true.

- [ ] **Step 2: Verify failure** — `node --test` → FAIL `Cannot find module '../projects'`.
- [ ] **Step 3: Implement `projects.js`.**
- [ ] **Step 4: Run** — `node --test` → all pass.

---

### Task 4: ffmpeg argument builders

**Files:**
- Create: `render.js`
- Test: `test/render.test.js`

**Interfaces:**
- Consumes: `buildFilter` (Task 1).
- Produces (pure; return arg arrays for `run("ffmpeg", args, { cwd: folder })`):
  - `clipArgs({ start, end, srcW, srcH, zoom, split, subtitles, satisfyingPath, satisfyingStart, output }) => string[]` — `-y -ss start -i source.mp4 [-stream_loop -1 -ss satStart -i satisfyingPath] -t len -filter_complex <graph> -map [v] -map 0:a? -c:v libx264 -preset veryfast -crf 22 -c:a aac -b:a 128k -movflags +faststart output`.
  - `rawPreviewArgs({ start, end, output }) => string[]` — width 640, `-preset ultrafast -crf 28`, audio aac.
  - `satPreviewArgs({ satisfyingPath, satisfyingStart, length, output }) => string[]` — loops, `scale=640:-2` after `crop` to 1080:960 aspect (`scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,scale=640:-2`), `-an`.
  - `probeArgs(file) => string[]` for `ffprobe` returning `width,height` of the first video stream and `format=duration` as JSON (`-v error -print_format json -show_entries stream=width,height:format=duration -select_streams v:0`).

- [ ] **Step 1: Failing tests**
  - `"clip without split: one input, maps [v] and source audio"` — no `-stream_loop`; includes `["-map","[v]","-map","0:a?"]`; `-t` value `"34"` for start 10 end 44; last arg = output.
  - `"clip with split: gameplay input loops from its start before source duration limit"` — args contain `-stream_loop`, `-1`, `-ss`, `"12.5"`, `-i`, the satisfying path; filter contains `vstack`.
  - `"raw preview: 640 wide with audio"`, `"sat preview: cropped to 1080:960 aspect, no audio"`, `"probe args ask for width, height, duration as json"`.
- [ ] **Step 2: Verify failure** — `node --test` → FAIL `Cannot find module '../render'`.
- [ ] **Step 3: Implement `render.js`.**
- [ ] **Step 4: Run** — `node --test` → all pass.

---

### Task 5: Server endpoints and processing changes

**Files:**
- Modify: `server.js`, `.gitignore` (add `satisfying/`)
- Create: `satisfying/` (empty folder; README not needed)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces (HTTP, JSON):
  - `POST /api/process` → full project (`{ id, title, url, createdAt, track, sourceWidth, sourceHeight, clips:[{ n, start, end, time, score, caption, zoom:1, satisfyingOn:false, satisfying:null, video, raw }] }`). Video/raw values are public paths `/data/<id>/…`.
  - `GET /api/projects` → `listProjects` result. `GET /api/projects/<id>` → project or 404. `DELETE /api/projects/<id>` → `{ ok: true }`.
  - `POST /api/satisfying` `{ id, clip }` → `{ file, start, preview }`; writes `sat-N.mp4`.
  - `POST /api/render` `{ id, clip, zoom, satisfying }` → updated clip object.
  - Errors: 400 `{ error }` with the Romanian message; logged with `console.error`.

- [ ] **Step 1: Processing** — after download: get real title (`--print after_move:title` before `after_move:filepath`; parse the two stdout lines), probe source size with `probeArgs`, render each clip with `clipArgs` (zoom 1, no split) to `short-N-<ts>.mp4`, render `raw-N.mp4` with `rawPreviewArgs`, write `project.json` via `saveProject`. Replace `chooseClips` result shape mapping accordingly; keep `buildAss(words, start, end)` for the initial `captions-N.ass` and also save `words` needed for re-rendering: write `words.json` (array from `parseVttWords`) in the folder.
- [ ] **Step 2: Render endpoint** — validate (`isValidId`, project exists, `clip` ∈ {1,2,3}, `typeof zoom === "number"` and 0 ≤ zoom ≤ 1, if `satisfying` then `clip.satisfying` exists and `safeSatisfyingName(file)`); rewrite `captions-N.ass` with `buildAss(words, start, end, { split })`; run `clipArgs`; delete previous `video` file; update and save project; reject a second render of the same `id:clip` while one runs (in-memory `Set`) with 409 „Clipul se randează deja.”.
- [ ] **Step 3: Satisfying endpoint** — `listSatisfying(ROOT/satisfying)`, `pickSatisfying` with `ffprobe` duration, run `satPreviewArgs` → `sat-N.mp4`, store `{ file, start, preview }` in the clip, set `satisfyingOn: true`, save.
- [ ] **Step 4: Project endpoints** — list/get/delete via `projects.js`; route parsing must not allow ids other than `isValidId`.
- [ ] **Step 5: Verify** — `node --check server.js`; `node --test` all pass; start server and run:
  - `curl -s localhost:4173/api/projects` → JSON array including the three existing folders as `legacy: true`.
  - Copy any small mp4 into `satisfying/`; process a short public video (≤ 10 min, auto subs); then `POST /api/satisfying {id, clip:1}` → `preview` path exists; `POST /api/render {id, clip:1, zoom:0, satisfying:true}` → new `short-1-*.mp4`; extract a frame at 5 s and confirm: original on top with blurred bars, gameplay bottom, subtitle on the middle line. `POST /api/render {…, zoom:0, satisfying:false}` → frame shows whole 16:9 video centred with blurred bars, subtitle at ~75%.
  - `GET /api/projects/<id>` after restarting the server returns the saved zoom/satisfying.

---

### Task 6: Front-end editor and projects view

**Files:**
- Modify: `index.html` (load `layout.js` before `app.js`; projects view section), `app.js`, `ui.css`

**Interfaces:**
- Consumes: Task 5 endpoints; `window.Layout.zoomSize`, `window.Layout.boxFor`.

- [ ] **Step 1: Routing** — `#/p/<id>` → `GET /api/projects/<id>` → results view; `#/projects` → projects view; empty hash → start view. Successful `/api/process` sets `#/p/<id>`. „Alt videoclip” clears the hash. Sidebar „Proiectele mele” → `#/projects`; „Proiect nou” → start view.
- [ ] **Step 2: Projects view** — rows: title, local date, „3 clipuri” or „doar vizionare”, buttons „Deschide” / „Șterge” (`confirm()` then `DELETE`, row removed). Legacy „Deschide” shows a results view with plain players + „Descarcă” only. Empty list text: „Nu ai încă proiecte.”
- [ ] **Step 3: Card – Rezultat mode** — `<video controls src=clip.video>`, meta, „Editează”, „Descarcă” (`download="short-N.mp4"`).
- [ ] **Step 4: Card – Editare mode** — 9:16 stage (`position:relative; overflow:hidden; aspect-ratio:9/16`) containing: top box (100% or 50% height) with blurred bg `<video muted>` (`object-fit:cover; filter:blur(12px) brightness(.88); transform:scale(1.1)`) and fg `<video>` sized in % of the box from `Layout.zoomSize(srcW, srcH, box.w, box.h, zoom)` (`width = w/box.w*100%`, centred); bottom `<video muted loop src=sat preview>` when on; a static label „SUBTITRARE” at 75% height (no split) or on the middle line (split). Controls: range 0–100 („Zoom”), checkbox „Video jos”, „↻ Alt video” (visible when on), „Aplică”, „Renunță”. Sync: one play/pause button for the stage; on play/seek set `currentTime` of bg/sat from fg (sat modulo its duration).
- [ ] **Step 5: Actions** — toggling „Video jos” on with no `clip.satisfying` (or „↻”) calls `/api/satisfying` (show „Caut un video…”; on error show message, untick). „Aplică” → `/api/render` → button „Se randează…”, controls disabled → on success replace clip, back to Rezultat; on error message under buttons, stay in Editare. „Renunță” restores the last rendered values.
- [ ] **Step 6: Verify in a browser** — `node --test` passes; open `http://localhost:4173/#/projects` with Playwright: list shows the test project and legacy folders; open the project, click „Editează” on clip 1, set zoom to 0 → screenshot shows the whole frame with blurred bars; tick „Video jos” → gameplay appears bottom; „Aplică” → card returns to Rezultat and plays the new file; reload page → same project and values; delete a legacy folder from the list → it disappears and the folder is gone from `data/`.
