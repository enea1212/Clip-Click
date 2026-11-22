# Karaoke Subtitles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain white SRT subtitles in ClipTrei shorts with burned-in karaoke subtitles (3–4 uppercase words, current word yellow and enlarged).

**Architecture:** A new CommonJS module `subtitles.js` turns YouTube VTT into word timings, groups the words and writes one `.ass` file per clip (one `Dialogue` event per spoken word). `server.js` uses it for both clip selection (deduplicated text) and rendering; ffmpeg burns the `.ass` with the existing `subtitles` filter.

**Tech Stack:** Node.js 24 (CommonJS, `node:test`, `node:assert/strict`), ffmpeg, yt-dlp. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-22-karaoke-subtitles-design.md`

## Global Constraints

- No new dependencies (npm or system).
- Fixed style for all clips: font `Arial Black`, white `&H00FFFFFF`, outline black, outline 6, shadow 3, alignment 2 (bottom-center), `MarginV=480`, font size 90, `PlayResX=1080`, `PlayResY=1920`.
- Active word: `{\c&H00E6FF&\fscx112\fscy112}` (yellow, 112%), reset with `{\r}` after it.
- Max 4 words per group; new group after a word ending in `. ? ! ,` or when the gap to the next word is > 0.6 s.
- Text uppercase with diacritics preserved (`toLocaleUpperCase("ro")`).
- Fallback (cues without word tags): split cue duration across words proportionally to letter count.
- The project is **not a git repo**: skip commit steps unless the user runs `git init` first.

## Review Focus

1. Words straddling the clip start/end — expect them clamped to `[0, clipEnd-clipStart]`, never negative or past the clip. (Test in Task 2.)
2. Words containing `{`, `}` or `\` — expect them stripped so they cannot inject ASS tags. (Test in Task 2.)
3. Romanian diacritics (`ș ț ă î â`) — expect correct uppercase `Ș Ț Ă Î Â`. (Test in Task 2.)
4. HTML entities in VTT (`&amp;`, `&gt;`) — expect decoded characters. (Test in Task 1.)
5. Two consecutive tagged words with the same timestamp — expect a minimum duration of 0.05 s, no zero/negative events. (Test in Task 1.)

---

### Task 1: Parse VTT into deduplicated word timings

**Files:**
- Create: `subtitles.js`
- Test: `test/subtitles.test.js`

**Interfaces:**
- Produces: `parseVttWords(text: string) => Array<{ word: string, start: number, end: number }>` (seconds, sorted, no duplicates). Exported via `module.exports`.

- [ ] **Step 1: Write the failing tests** in `test/subtitles.test.js`

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseVttWords } = require("../subtitles");

const AUTO = `WEBVTT
Kind: captions
Language: en

00:00:01.000 --> 00:00:03.000 align:start position:0%
 
hello<00:00:01.500><c> world</c><00:00:02.200><c> &amp;again</c>

00:00:03.000 --> 00:00:03.010 align:start position:0%
hello world &amp;again
 

00:00:03.010 --> 00:00:05.000 align:start position:0%
hello world &amp;again
this<00:00:03.600><c> is</c><00:00:03.600><c> fine</c>
`;

test("auto subs: words with timings, repeated lines dropped, entities decoded", () => {
  const words = parseVttWords(AUTO);
  assert.deepEqual(words.map((w) => w.word), ["hello", "world", "&again", "this", "is", "fine"]);
  assert.deepEqual(words.slice(0, 3).map((w) => [w.start, w.end]), [[1, 1.5], [1.5, 2.2], [2.2, 3]]);
  assert.equal(words[3].start, 3.01);
});

test("same-timestamp words get at least 0.05 s", () => {
  const words = parseVttWords(AUTO);
  for (const w of words) assert.ok(w.end - w.start >= 0.05 - 1e-9, `${w.word} too short`);
});

test("manual subs fallback: duration split by letter count", () => {
  const words = parseVttWords("WEBVTT\n\n00:00:00.000 --> 00:00:01.800\nSalut lume\n");
  assert.deepEqual(words.map((w) => w.word), ["Salut", "lume"]);
  assert.equal(words[0].start, 0);
  assert.ok(Math.abs(words[0].end - 1.0) < 1e-6);
  assert.ok(Math.abs(words[1].end - 1.8) < 1e-6);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/`
Expected: FAIL, `Cannot find module '../subtitles'`.

- [ ] **Step 3: Implement `parseVttWords` in `subtitles.js`**

Rules the tests do not fully determine:
- A VTT is "auto" if any cue contains `<hh:mm:ss.mmm>` tags. In auto mode, skip cues shorter than 0.05 s and take only the **last non-empty line** of each cue; parse it as: text before the first tag starts at the cue start, each `<t><c> word</c>` starts at `t`; each word ends when the next starts, the last one at the cue end.
- In manual mode, all text lines of the cue form the words; fallback proportional split.
- Strip remaining tags, decode `&amp; &lt; &gt; &quot; &#39; &nbsp;`, split on whitespace, drop empty tokens.
- Enforce `end >= start + 0.05`.

- [ ] **Step 4: Run tests**

Run: `node --test test/`
Expected: 3 passing.

---

### Task 2: Group words and build the ASS file

**Files:**
- Modify: `subtitles.js`
- Test: `test/subtitles.test.js`

**Interfaces:**
- Consumes: word objects from Task 1.
- Produces:
  - `groupWords(words) => Array<Array<{word,start,end}>>`
  - `buildAss(words, clipStart: number, clipEnd: number) => string` (complete `.ass` file, times relative to `clipStart`).

- [ ] **Step 1: Write the failing tests** (append)

```js
const { groupWords, buildAss } = require("../subtitles");
const w = (word, start, end) => ({ word, start, end });

test("groups: max 4, break on punctuation and pauses > 0.6 s", () => {
  const g = groupWords([w("a",0,.2), w("b",.2,.4), w("c,",.4,.6), w("d",.6,.8), w("e",.8,1), w("f",1,1.2), w("g",1.2,1.4), w("h",1.4,1.6), w("i",2.5,2.7)]);
  assert.deepEqual(g.map((x) => x.map((y) => y.word)), [["a","b","c,"], ["d","e","f","g"], ["h"], ["i"]]);
});

test("ass: header style and one Dialogue per word with active highlight", () => {
  const ass = buildAss([w("asta",10,10.4), w("e",10.4,10.6), w("greșeala",10.6,11.2)], 10, 20);
  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /PlayResY: 1920/);
  assert.match(ass, /Style: Default,Arial Black,90,&H00FFFFFF,/);
  const lines = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
  assert.equal(lines.length, 3);
  assert.match(lines[0], /0:00:00\.00,0:00:00\.40/);
  assert.match(lines[2], /ASTA E \{\\c&H00E6FF&\\fscx112\\fscy112\}GREȘEALA\{\\r\}/);
});

test("ass: words clamped to clip window", () => {
  const ass = buildAss([w("x",9.5,10.3), w("y",19.8,20.6)], 10, 20);
  const lines = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
  assert.match(lines[0], /0:00:00\.00,/);
  assert.match(lines.at(-1), /,0:00:10\.00,/);
});

test("ass: braces and backslashes stripped, diacritics uppercased", () => {
  const ass = buildAss([w("{\\b1}țară\\", 0, 1)], 0, 5);
  assert.match(ass, /ȚARĂ\{\\r\}/);
  assert.doesNotMatch(ass, /\\b1/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/`
Expected: new tests FAIL (`groupWords is not a function`).

- [ ] **Step 3: Implement `groupWords` and `buildAss`**

- Times formatted `H:MM:SS.cc` (centiseconds).
- Header: `[Script Info]` (`ScriptType: v4.00+`, PlayRes values, `WrapStyle: 0`), `[V4+ Styles]` with `Style: Default,Arial Black,90,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,6,3,2,60,60,480,1`, then `[Events]` with the standard `Format:` line.
- Filter words overlapping `[clipStart, clipEnd]`, clamp, shift by `clipStart`, then `groupWords`. For each word in a group: event from its start to the next word's start in the group (last word: its own end); text = group words uppercased, space-joined, active word wrapped in the highlight tags.

- [ ] **Step 4: Run tests**

Run: `node --test test/`
Expected: all 7 passing.

---

### Task 3: Wire into server.js and verify on a real video

**Files:**
- Modify: `server.js` (remove `parseVtt`, `subtitleFile`; change transcript building and the render loop at lines ~93–125)

**Interfaces:**
- Consumes: `parseVttWords`, `groupWords`, `buildAss` from `./subtitles`.

- [ ] **Step 1: Replace transcript building**

`const words = parseVttWords(vtt); const transcript = groupWords(words).map((g) => ({ start: g[0].start, end: g.at(-1).end, caption: g.map((x) => x.word).join(" ") }));` — `chooseClips(transcript)` unchanged. Delete `parseVtt` and `subtitleFile`.

- [ ] **Step 2: Render with ASS**

Write `captions-N.ass` with `buildAss(words, clip.start, clip.end)`; ffmpeg filter becomes `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,subtitles='${subtitlePath}'` (no `force_style`).

- [ ] **Step 3: Unit tests still pass**

Run: `node --test test/`
Expected: all passing.

- [ ] **Step 4: End-to-end check**

Run `node server.js`, open http://localhost:4173, submit a public video with auto subtitles (RO or EN).
Expected: 3 MP4s; extract a frame with `ffmpeg -ss 5 -i data/<id>/short-1.mp4 -frames:v 1 frame.png` and confirm: uppercase white text with black outline, one yellow enlarged word, text around 75% height, no duplicated words in the clip description. Adjust size/outline/`MarginV` only if visibly off, and note the final values.
