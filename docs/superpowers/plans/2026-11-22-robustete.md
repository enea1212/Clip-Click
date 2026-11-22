# Robustețe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Block cross-site requests, allow one heavy processing job at a time, and make failed/interrupted processing resumable instead of deleted.

**Architecture:** Pure, tested helpers (`checkRequest` in `http-utils.js`, a global heavy-job lock in `projects.js`, `resumePlan` + status handling in a new `pipeline.js`) and thin wiring in `server.js`/`app.js`. Each part ships on its own branch with a PR.

**Tech Stack:** Node 24 CommonJS, `node:test`, existing ffmpeg/yt-dlp/Whisper pipeline. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-22-robustete-design.md`

## Global Constraints

- Branches in order: `fix/protectie-cereri`, `feature/un-singur-job`, `feature/reluare-procesare`; each branched from the previous one's tip after its PR is opened (stacked), pushed, PR opened with `gh pr create` (base `main` for the first; base = previous branch for the next ones).
- Allowed hosts/origins: `localhost:<PORT>`, `127.0.0.1:<PORT>`. Errors: 403 for Host/Origin, 415 for non-JSON POST.
- Busy message (exact): „Se procesează deja un video. Încearcă după ce termină.” (409).
- Statuses: `downloading`, `transcribing`, `rendering`, `ready`, `failed`. Interrupted message: „Procesarea a fost întreruptă.”
- Test command `node --test`; commit per task with the attribution trailer.

## Review Focus

1. A `fetch` from the app itself (same origin, JSON) must still work everywhere — including DELETE and the confirm flow.
2. Server restart while a project is `transcribing` → listed as incomplete with „Reia”, never auto-resumed.
3. Resume after the download finished but before `words.json` → no re-download; after some transcription chunks → only missing chunks run.
4. A failure before anything was downloaded (invalid video) still removes the empty folder.
5. Old `project.json` files without `status` (all existing projects) are treated as `ready`.

---

### Task 1 (`fix/protectie-cereri`): checkRequest

- [ ] Test `test/http-utils.test.js`: `checkRequest(method, headers, port)` → `null` (ok) or `{ status, message }`. Cases: GET with Host `localhost:4173` ok; Host `evil.com` → 403; POST JSON with Origin `http://localhost:4173` ok; Origin `http://evil.com` → 403; POST without Origin + JSON ok (curl); POST `text/plain` → 415; `application/json; charset=utf-8` ok; DELETE with foreign Origin → 403; Host `127.0.0.1:4173` ok.
- [ ] Verify FAIL, implement, verify PASS.
- [ ] Wire at the top of the request handler (all requests). Live: curl with foreign Origin → 403, `text/plain` → 415, browser app works (Playwright: open projects list, open a project).
- [ ] Commit, push branch, PR to `main`.

### Task 2 (`feature/un-singur-job`): global heavy-job lock

- [ ] Test `test/projects.test.js`: `createLocks()` gains `acquireHeavy()` / `releaseHeavy()` / `heavyBusy()`; second `acquireHeavy()` is false until release.
- [ ] Wire: `/api/process` acquires before creating the folder (409 exact message), releases in `finally`. Live: two concurrent `/api/process` → second 409 in < 1 s, no extra folder.
- [ ] Commit, push, PR (base `fix/protectie-cereri`).

### Task 3 (`feature/reluare-procesare`): staged, resumable processing

- [ ] New `pipeline.js` with pure `resumePlan(project, files) => { download, transcribe: { missingChunks }, choose, renderClips: [n…] }` and `normalizeStatus(project, activeIds)` (missing status → `ready`; non-final status without an active job → `failed` + interrupted message). Tests in `test/pipeline.test.js` for: fresh project, downloaded only, some chunks done, clips partly rendered, all done, old project without status, interrupted.
- [ ] Server: write `project.json` at start (`downloading`, `url`, `transcribe`); update status per stage; whole-video transcription stores `chunks/chunk-N.json` and skips existing ones; on error set `failed` + `error` (delete folder only if no `source.mp4`). `listProjects`/`GET project` apply `normalizeStatus`. `POST /api/projects/<id>/resume` runs `resumePlan` under the heavy lock.
- [ ] UI: list rows for `failed` → „incomplet” + error + „Reia”; in-progress → „se procesează…” without buttons; „Reia” calls resume and opens the project when done.
- [ ] Live: start a no-subs-style run (`transcribe: true`, TED), kill the server during chunk 2, restart → list shows incomplete; „Reia” → no download, only chunk 2 transcribed, project `ready`.
- [ ] Commit, push, PR (base `feature/un-singur-job`).

### Task 4: final review

- [ ] Fresh reviewer over the three branches; fix Critical/Important with tests; push; update CLAUDE.md.
