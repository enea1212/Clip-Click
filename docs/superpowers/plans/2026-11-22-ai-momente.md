# AI Moments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Pick the 3 clips with a local LLM (Ollama `qwen2.5:7b`) from 10 rule-preselected candidates, with sentence-aligned 20–50 s boundaries, a title and a reason; fall back to rules without failing.

**Architecture:** Pure, tested helpers in `clips.js` (`chooseCandidates`) and a new `ai.js` (lines, prompt, schema, answer validation, final pick, Ollama HTTP calls). `server.js` gets a resumable `choosing` stage (per-candidate cache in `ai/`), progress, and a `rechoose` endpoint; `app.js` shows title/reason/source, progress and the „Alege din nou cu AI” button.

**Tech Stack:** Node 24 (`fetch`), Ollama HTTP API (`/api/tags`, `/api/generate` with `format` JSON schema), `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-22-ai-momente-design.md`

## Global Constraints
- Branch `feature/ai-momente`; PR to `main`; commit per task.
- `CLIPTREI_MODEL` (default `qwen2.5:7b`), `CLIPTREI_OLLAMA_URL` (default `http://127.0.0.1:11434`).
- 10 candidates × ~75 s (step 15 s), clip length 20–50 s, clip = first line start − 0.1 s … last line end + 0.2 s.
- Line break: `.?!` at word end, pause > 0.5 s, or 15 words.
- Answer schema: `{ kind: "stream"|"podcast"|"other", score: 0–10, start_line, end_line, title, reason }`.
- Per-candidate timeout 180 s; invalid/failed candidate is skipped.
- Fallback (Ollama unreachable / model missing / 0 valid answers): rules exactly as today (34 s), `selection: "reguli"`, `selectionNote`.
- Clip fields: `source: "ai"|"reguli"`, `title`, `reason`, `aiScore`; project: `selection`, `selectionNote`, `aiProgress {done,total}`.
- UI copy: „AI notează momentele: n/10”, „ales după reguli”, „Momente alese după reguli (AI indisponibil: …)”, „Alege din nou cu AI”, confirm „Clipurile și setările lor (zoom, video jos, pauze) se refac. Continui?”.

## Review Focus
1. LLM returns lines out of range, reversed, or a 5 s / 90 s span → adjusted into 20–50 s or dropped, never a crash.
2. AI clips overlapping each other or a rule-filled clip → no overlaps in the final 3.
3. Resume after 4/10 candidates → only 6 more Ollama calls.
4. Ollama down at start of the stage → rules, project `ready`, no error; rechoose with Ollama still down → clear error, clips untouched.
5. Very short video (fewer than 10 candidates fit) → works with what fits.

---

### Task 1: Candidates and lines (pure)
- [ ] Tests: `chooseCandidates` returns ≤ count non-overlapping 75 s windows ordered by rule score (and fewer on short input); `buildLines` splits at punctuation / pause > 0.5 s / 15 words, indexes from 0, absolute times.
- [ ] Implement in `clips.js` (`chooseCandidates`) and `ai.js` (`buildLines`). Commit.

### Task 2: Prompt, schema, validation, final pick (pure)
- [ ] Tests: `buildPrompt` contains numbered lines with mm:ss and the 20–50 s rule; `parseAnswer(raw, lines)`: valid → `{start,end,score,title,reason,kind}`; out-of-range/reversed → null; 5 s span widened toward 20 s by adding lines, 90 s span trimmed to ≤ 50 s, impossible → null; `pickFinal(aiClips, ruleClips)` → 3 non-overlapping, AI first by score, rule fill marked `source:"reguli"`, ranks 1–3.
- [ ] Implement in `ai.js`. Commit.

### Task 3: Ollama client + choosing stage + rechoose (server)
- [ ] `ai.js`: `ollamaStatus(url, model)` → `{ ok, reason }` via `/api/tags`; `askOllama(url, model, prompt, timeoutMs)` → parsed JSON (AbortController).
- [ ] Server tests (fake Ollama: small HTTP server inside `test/server.test.js`, env `CLIPTREI_OLLAMA_URL`): AI flow → `selection:"ai"`, titles/reasons, clip lengths 20–50 s; Ollama down → `selection:"reguli"`, ready; one candidate answers garbage → skipped; resume after partial `ai/` → only missing candidates asked; rechoose on a rules project with Ollama up → AI clips; rechoose with Ollama down → 400, clips untouched.
- [ ] Implement stage `choosing` with `ai/candidate-N.json` (atomic) and `aiProgress`; `POST /api/projects/<id>/rechoose` (heavy lock, checks Ollama first). `/api/inspect` adds `aiAvailable`. Commit.

### Task 4: UI
- [ ] Card: title (fallback „Short N”), reason, „ales după reguli” tag; processing label with AI progress; project note + „Alege din nou cu AI” (confirm, then call rechoose, refresh).
- [ ] Playwright check on a real project. Commit.

### Task 5: Real run, tuning, review, PR
- [ ] `ollama pull qwen2.5:7b`; measure seconds per candidate; process a podcast-like (TED) and a stream video; compare with rule picks; tune prompt/thresholds if needed (record in ledger).
- [ ] README (model install). Final reviewer; fix Critical/Important with tests. Push, PR.
