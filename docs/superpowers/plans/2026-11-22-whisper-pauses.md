# Whisper + Pause Cutting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exact word timings from local Whisper on every clip (and full-video transcription when a video has no original-language subtitles), plus a per-clip „Taie pauzele” option that removes silences and keeps karaoke subtitles in sync.

**Architecture:** A Python script (`transcribe.py`, faster-whisper int8 on CPU) is spawned by the server and prints word JSON. Pure, unit-tested Node modules do the rest: `pauses.js` (speech segments + timeline remapping), `whisper.js` (yt-dlp metadata → has-original-subtitles, estimate, transcript parsing), and `render.js`/`layout.js` (trim+concat before the existing layout). `server.js` wires them into processing, a new `/api/inspect`, and `/api/render`; `app.js` adds the confirm step and the checkbox.

**Tech Stack:** Node 24 (CommonJS, `node:test`), Python 3.12 + `faster-whisper` (model `small`, `int8`, CPU), ffmpeg, yt-dlp.

**Spec:** `docs/superpowers/specs/2026-11-22-whisper-pauses-design.md`

## Global Constraints

- Only new dependency: `faster-whisper` (pip) + model `small`. No npm packages.
- Whisper settings: `WhisperModel("small", device="cpu", compute_type="int8")`, `transcribe(..., word_timestamps=True, vad_filter=True)`, language autodetect.
- Pause = gap between consecutive words > **0.4 s**; keep **0.1 s** padding around speech; leading/trailing silence removed. Cut clips get shorter (no refill).
- `cutPauses` allowed only when the clip's `wordsSource === "whisper"`; default `true` for Whisper clips, `false` otherwise; server rejects `cutPauses: true` for YouTube-timed clips with „Necesită transcriere Whisper.”.
- Subtitles in the spoken language; YouTube auto-translations never count as "has subtitles".
- No cancel/progress for long transcription; the request just runs (project appears in „Proiectele mele” when done).
- ffmpeg `cwd` = project folder; filters use bare file names.
- UI copy (exact): „Taie pauzele”, „Pauzele se taie la Aplică”, „Necesită transcriere Whisper”, confirm text „Videoul nu are subtitrări. Transcrierea pe calculatorul tău durează cam X minute. Continui?”, missing-package error „Instalează faster-whisper: python -m pip install --user faster-whisper”.
- Test command: `node --test`. Git: repo `enea1212/Clip-Click`, branch `main`; one commit per task; push at the end.

## Review Focus

1. A clip where Whisper finds no words at all (music, silence) — expect no crash: no segments → render the uncut clip and `cutPauses` false with a console warning. (Test in Task 1.)
2. A word straddling the clip start or end — expect clamped segments inside `[0, length]`, no negative or zero-length segment. (Test in Task 1.)
3. Many tiny segments (fast speech with short gaps) — gaps ≤ 0.4 s are merged, so segment count stays small; ffmpeg concat with 1 segment must also work. (Tests in Tasks 1–2.)
4. Python missing `faster-whisper` or crashing — expect the clear Romanian message for no-subs videos and a silent fallback to YouTube words for videos with subs. (Test in Task 3 on the parser/error mapping; live in Task 4.)
5. Non-ASCII words (ș, ț, ă) through Python stdout on Windows — expect UTF-8 preserved (force `PYTHONIOENCODING=utf-8` / `sys.stdout.reconfigure(encoding="utf-8")`). (Live check in Task 3.)

---

### Task 0: Baseline commit

- [ ] `git add -A && git commit -m "ClipTrei: karaoke subtitles, clip editor, projects"` (with the attribution trailer). `git status` → clean. No push yet.

---

### Task 1: Speech segments and timeline remapping

**Files:** Create `pauses.js`; Test `test/pauses.test.js`

**Interfaces — Produces:**
- `speechSegments(words, clipStart, clipEnd, { gap = 0.4, pad = 0.1 } = {}) => Array<{ start, end }>` — times relative to the clip, sorted, non-overlapping, inside `[0, clipEnd - clipStart]`; `[]` if no words in the clip.
- `remapWords(words, clipStart, segments) => Array<{ word, start, end }>` — words of the clip on the cut timeline (0 = first kept moment); words outside every segment dropped.
- `totalDuration(segments) => number`.

- [ ] **Step 1: Failing tests**
  - `"segments: gaps over 0.4 s split speech, padding 0.1 s, edges trimmed"` — words (absolute) at 100: `a 101–101.5`, `b 101.6–102` (gap 0.1 → merged), `c 103–103.4` (gap 1.0 → new), clip 100–110 → `[{0.9,2.1},{2.9,3.5}]` (±1e-9).
  - `"segments: overlapping paddings merge, gap exactly 0.4 does not split"` — `a 0.0–1.0`, `b 1.4–2.0` → one segment `{0, 2.1}` (start clamps at 0).
  - `"segments: words straddling clip edges are clamped"` — clip 10–20, word 9.5–10.3 and 19.8–20.6 → first start 0, last end 10.
  - `"segments: no words gives []"`.
  - `"remap: words move onto the cut timeline"` — with the first test's segments: `a` → 0.1–0.6, `b` → 0.7–1.1, `c` → 1.3–1.7.
  - `"totalDuration sums segments"` → 1.8 for the first test.
- [ ] **Step 2:** `node --test` → FAIL `Cannot find module '../pauses'`.
- [ ] **Step 3:** Implement `pauses.js`. Remap: for a time `t` inside segment i, `new = sum(len of segments < i) + (t - seg.start)`; clamp word ends to their segment end.
- [ ] **Step 4:** `node --test` → all pass.
- [ ] **Step 5:** Commit `feat: speech segments for pause cutting`.

---

### Task 2: Trim + concat in the render

**Files:** Modify `layout.js`, `render.js`; Tests `test/layout.test.js`, `test/render.test.js`

**Interfaces:**
- Consumes: segments from Task 1.
- Produces: `buildFilter({ ..., segments })` — when `segments` has ≥ 1 entry, the graph starts with `[0:v]trim=start=S:end=E,setpts=PTS-STARTPTS[vK];[0:a]atrim=start=S:end=E,asetpts=PTS-STARTPTS[aK];…[v0][a0][v1][a1]…concat=n=N:v=1:a=1[cv][ca]` and the layout uses `[cv]` where it used `[0:v]`. `clipArgs({ ..., segments })` maps `[ca]` instead of `0:a?` and uses `-t totalDuration(segments)`.

- [ ] **Step 1: Failing tests**
  - layout: `"filter with segments trims, concats and feeds the layout"` — 2 segments → contains `trim=start=0.9:end=2.1`, `atrim=start=2.9:end=3.5`, `concat=n=2:v=1:a=1[cv][ca]`, `[cv]split[a][b]`, and no `[0:v]split`.
  - layout: `"single segment still uses concat n=1"`.
  - render: `"clip with segments maps concat audio and uses the cut duration"` — has `["-map","[ca]"]`, not `0:a?`; `-t` = `"1.8"`.
- [ ] **Step 2:** `node --test` → those FAIL.
- [ ] **Step 3:** Implement (numbers formatted with up to 3 decimals).
- [ ] **Step 4:** `node --test` → all pass. Real check: render 8 s of `data/c04a…/source.mp4` with two segments via a one-off `node -e` using `clipArgs`; `ffprobe` duration ≈ sum of segments.
- [ ] **Step 5:** Commit `feat: trim and concat speech segments before layout`.

---

### Task 3: Whisper script and Node helpers

**Files:** Create `transcribe.py`, `whisper.js`; Test `test/whisper.test.js`; Modify `README.md`

**Interfaces — Produces:**
- `transcribe.py <audio.wav>` → stdout JSON `{ "language": "en", "words": [{ "word", "start", "end" }] }`; exit code 3 + stderr `MISSING_FASTER_WHISPER` when the import fails.
- `whisper.js`:
  - `audioArgs({ start, end, output }) => string[]` — ffmpeg args extracting 16 kHz mono WAV from `source.mp4` (`start`/`end` optional for the whole file).
  - `parseTranscript(stdout, offset = 0) => Array<{ word, start, end }>` — offset added, tokens without letters/digits dropped, min duration 0.05 s, strictly increasing starts (reuse the same rule as `parseVttWords`).
  - `hasOriginalSubtitles(info) => boolean` — from yt-dlp `--dump-json`: true if `info.subtitles` has a key matching `/^(ro|en)(-|$)/`, or `info.automatic_captions` has `ro-orig`/`en-orig`, or `info.language` is `ro`/`en` and `automatic_captions` has that language key.
  - `estimateMinutes(durationSeconds) => number` — `Math.max(1, Math.ceil(duration * FACTOR / 60))`, `FACTOR` measured in Step 4.
  - `WHISPER_MISSING` message constant (exact copy from Global Constraints).

- [ ] **Step 1: Failing tests** — `"parseTranscript offsets, cleans and orders words"`, `"hasOriginalSubtitles: manual en counts"`, `"…: only auto-translated ro on a German video does not count"` (`language: "de"`, `automatic_captions: { ro: [], en: [], de-orig: [] }` → false), `"…: en-orig counts"`, `"estimateMinutes rounds up and is at least 1"`, `"audioArgs extracts 16 kHz mono wav for a range"`.
- [ ] **Step 2:** `node --test` → FAIL `Cannot find module '../whisper'`.
- [ ] **Step 3:** Implement `whisper.js` and `transcribe.py` (stdout reconfigured to UTF-8).
- [ ] **Step 4:** `python -m pip install --user faster-whisper`; extract 34 s of `data/c04a…/source.mp4` with `audioArgs`; run `python transcribe.py clip.wav` with a timer → words look right, UTF-8 OK; also time a 3-minute extract and set `FACTOR` = seconds of processing per second of audio (rounded up to 0.05). Record the measurement in the ledger. Add the install line to `README.md`.
- [ ] **Step 5:** `node --test` → all pass. Commit `feat: local Whisper transcription helper`.

---

### Task 4: Server — refine clips, cut pauses, render option

**Files:** Modify `server.js`, `projects.js` (if a helper is needed)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: clip fields `cutPauses`, `duration`, `wordsSource`; per-clip `words-N.json`; `POST /api/render { id, clip, zoom, satisfying, cutPauses }`.

- [ ] **Step 1:** `transcribeClip(folder, clip)` — `audioArgs` to `clip-N.wav`, spawn `python transcribe.py clip-N.wav` (env `PYTHONIOENCODING=utf-8`), `parseTranscript(stdout, clip.start)`, delete the wav. On exit code 3 → throw a marked "missing" error; other errors → throw.
- [ ] **Step 2:** In processing, after choosing clips: for each clip try `transcribeClip`; success → `words-N.json`, `wordsSource: "whisper"`, `cutPauses: true`; failure → `words-N.json` = YouTube words of the clip, `wordsSource: "youtube"`, `cutPauses: false`, `console.warn`. If Whisper returns no words → treat as failure.
- [ ] **Step 3:** `renderClip` uses `words-N.json`; when `cutPauses`: `speechSegments` → if empty, render uncut and store `cutPauses: false`; else `remapWords` → `buildAss(remapped, 0, total, { split })`, `clipArgs({ ..., segments })`, `duration = total`. Uncut: `duration = end - start`.
- [ ] **Step 4:** `/api/render` accepts `cutPauses` (boolean; default = stored value); `cutPauses: true` with `wordsSource !== "whisper"` → 400 „Necesită transcriere Whisper.”. Old projects without `words-N.json`: on render, run `transcribeClip` first (fallback to `words.json` slice + `wordsSource: "youtube"`).
- [ ] **Step 5: Verify** — `node --check server.js`, `node --test`; restart server; re-render clip 1 of project `c04a…` with `cutPauses: true` → `duration` < 34, extract frames/compare: no long silences (`ffmpeg -af silencedetect=n=-35dB:d=0.5` reports none or only short ones), subtitles in sync at 2 sample points; render with `cutPauses: false` → 34 s.
- [ ] **Step 6:** Commit `feat: Whisper word timings per clip and pause cutting`.

---

### Task 5: Server — inspect and full-video transcription

**Files:** Modify `server.js`

**Interfaces — Produces:** `POST /api/inspect { url } → { title, duration, hasSubtitles, estimateMinutes }`; `POST /api/process { url, transcribe: true }`.

- [ ] **Step 1:** `/api/inspect`: `python -m yt_dlp --no-playlist --skip-download --dump-json url` → `hasOriginalSubtitles`, `estimateMinutes(duration)`.
- [ ] **Step 2:** `/api/process` with `transcribe: true`: download (subtitle flags kept harmlessly), `audioArgs` for the whole file → `transcribe.py` → `parseTranscript` → `words.json`, `track: "whisper"`; continue the normal flow; per-clip words are slices of `words.json`, `wordsSource: "whisper"` (no second transcription). Missing package → UserError with the exact install message. Without `transcribe` and no captions → existing error.
- [ ] **Step 3: Verify** — `curl /api/inspect` for the TED video (`hasSubtitles: true`) and for a German-language video with only auto-translations if one is at hand (else unit test covers it); process the TED video with `transcribe: true` (≈ FACTOR × 14 min) → project with `track: "whisper"`, 3 clips, Romanian/English words sensible.
- [ ] **Step 4:** Commit `feat: inspect videos and transcribe ones without subtitles`.

---

### Task 6: Front-end

**Files:** Modify `app.js`, `ui.css`

- [ ] **Step 1:** Submit flow: `POST /api/inspect` first (button label „Verific videoclipul…”); `hasSubtitles` → process as today; else `confirm(<exact text with estimateMinutes>)` → `POST /api/process { url, transcribe: true }` with loading text mentioning the estimate; cancel → back to start view.
- [ ] **Step 2:** Editor: checkbox „Taie pauzele” (state `cutPauses`), hint „Pauzele se taie la Aplică” under it; disabled + hint „Necesită transcriere Whisper” when `clip.wordsSource !== "whisper"`; „Aplică” sends `cutPauses`; „Renunță” restores it.
- [ ] **Step 3:** Card meta shows duration (`Math.round(clip.duration)` + „ s”) next to the time range.
- [ ] **Step 4: Verify with Playwright** — open project, Editează clip 2, untick „Taie pauzele”, Aplică → duration 34 s; tick again, Aplică → shorter; old-style clip without Whisper shows the disabled checkbox (simulate by editing a copy of a project's `wordsSource` in a temp project, then delete it).
- [ ] **Step 5:** Commit `feat: pause cutting toggle and no-subtitles confirmation in the UI`.

---

### Task 7: Final review, fixes, push

- [ ] Final whole-change review (fresh reviewer), fix Critical/Important with tests, commit.
- [ ] `git push -u origin main`; confirm on GitHub (`gh repo view enea1212/Clip-Click --json defaultBranchRef`).
