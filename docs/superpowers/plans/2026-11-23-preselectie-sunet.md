# Audio Preselection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** Send the AI 5 speech candidates + 5 candidates around the loudest audio peaks (fill with speech if fewer peaks), with a "loud here" hint in the prompt.

**Spec:** `docs/superpowers/specs/2026-11-23-preselectie-sunet-design.md`

## Global Constraints
- Peak rules: delta = rms − median(±60 s) ≥ 9 dB and rms > −25 dB; merge peaks ≤ 8 s apart; score = max delta × √duration (seconds).
- Audio window: [peak − 40, peak + 35] clamped to [0, duration]; 75 s; no overlap with other candidates.
- `loudness.json` atomic, reused; analysis failure → no audio candidates, no error.
- Prompt hint: `Note: the audio gets suddenly loud around mm:ss (possible shouting, laughter or a big reaction).`
- Test command `node --test`; commit per task; PR to `main`.

### Task 1: `loudness.js` (pure)
- [ ] Tests: `loudnessArgs(out)` uses `-vn`, `astats`, `ametadata` with `file=out`; `parseLoudness(text)` → dB per second (`-inf` → −90); `loudEvents(rms)` finds an isolated 3 s spike over a quiet background, ignores constant loud noise and quiet spikes, merges peaks 5 s apart, sorts by score; `mixCandidates(speech, events, { count: 10, speech: 5, length: 75, duration })` → 5 speech + audio windows without overlaps, fill from remaining speech, `loudAt` on audio ones.
- [ ] Implement; commit.

### Task 2: prompt hint + server stage
- [ ] Tests: `buildPrompt(lines, { loudAt })` contains the hint with mm:ss; server test (fake ffmpeg writes a loudness file with a spike when `control.loudAt` is set) → an AI prompt contains the hint and the project still finishes.
- [ ] Implement in `ai.js` and `server.js` `chooseMoments` (loudness cached in `loudness.json`); fake tools support the analysis call. Commit.

### Task 3: real check + PR
- [ ] On GTA (`data/29520ba6…`, no download): how many of the 12 loudest events fall inside the mixed candidates (expected ≥ 5). Update CLAUDE.md; final review; push; PR.
