# Povești animate, partea 2: scene cu AI, editor storyboard, integrare — plan de implementare

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enea scrie povestea în aplicație și primește un storyboard editabil (varianta 2B). Pe storyboard poate regenera sau înlocui decoruri, schimba camera, graficele și personajele, previzualiza și crea videoul final. Poveștile apar în „Proiectele mele”.

**Architecture:**
- **Scenele:** `storyboard.js` (pur) împarte textul în propoziții, construiește promptul, validează răspunsul AI și oferă reguli de rezervă.
- **Decorurile:** `image-worker.js` ține `imagegen.py --serve` pornit 10 min, ca regenerarea să nu reîncarce modelul.
- **Serverul:** endpoint-urile `/api/stories…` din `server.js` refolosesc `studio.js` și `story.js`. Proiectul-poveste e un `data/<uuid>/` cu `project.json` (`type: "story"`, `clips: []`) și `story.json`.
- **Interfața:** `story-ui.js` (nou), plus rute în `app.js` și stiluri în `ui.css`.

**Tech Stack:** Node 24 (`node:test`), Python din `studio/venv`, Ollama `qwen2.5:7b` (fals în teste).

**Spec:** `docs/superpowers/specs/2026-11-23-povesti-animate-design.md` (inclusiv „Actualizare 2026-11-24”). Macheta: `.superpowers/mockups/editor-scene.html`, tab 2B.

## Global Constraints
- Textul lui Enea nu se schimbă: AI-ul răspunde doar cu indici de propoziții. Fiecare propoziție apare într-o singură scenă, în ordine.
- Scenele au 1–2 propoziții. Propozițiile de peste 12 cuvinte se taie la `,`, ` and `, ` but `, ` și `, ` dar ` (rămân ≥ 3 cuvinte pe bucată).
- Replicile au forma `NUME: text` (NUME = majuscule, cifre, `_`, 2–20 caractere). Scena primește atunci `speaker = NUME`, iar personajul e creat automat.
- Plafonul AI pentru scene e de 6 min (`CLIPTREI_STORYBOARD_BUDGET_MS`). Fără Ollama, cu răspuns invalid sau la depășirea plafonului se aplică regulile, fără eroare, iar nota apare în proiect.
- Decorurile: între 1 și 10, `id` cu `[a-z0-9-]`, prompt în engleză.
- „Un singur job greu odată” (`locks.acquireHeavy`) se aplică la crearea poveștii, la previzualizare și la randare. Regenerarea unui decor folosește blocarea proiectului (`<id>:decor`), nu pe cea globală.
- Corpul JSON al cererilor-poveste are limita de 50 000 de caractere. Încărcarea unei imagini (corp binar) are limita de 15 MB și acceptă doar PNG, JPEG sau WebP, verificate după primii octeți.
- Testele nu rulează niciodată modele reale.
- Subtitrările poveștii: aliniere sus (`Alignment 8`), `MarginV 560`. Panoul `sign` stă centrat la 25% din înălțime.
- Textele din interfață sunt în română, cu diacritice. Stilul e cel din machetă (paleta existentă).

## Review Focus
1. Un răspuns AI care sare peste propoziții, le repetă sau le amestecă ordinea: reparat sau înlocuit cu reguli, niciodată text pierdut.
2. Două „Regenerează” rapide pe același decor: al doilea e refuzat cu mesaj (blocare), nu strică fișierul.
3. Worker-ul de imagini cade la mijloc: cererea curentă primește eroare, iar următoarea pornește un worker nou.
4. Încărcarea unui fișier care nu e imagine sau e prea mare: refuzată cu mesaj, nimic scris pe disc.
5. Proiectele YouTube vechi și cele noi merg ca înainte: lista, deschiderea și „Reia”.

---

### Task 1: `storyboard.js`: propoziții, prompt, validare, reguli

**Files:** Create `storyboard.js`, `test/storyboard.test.js`

**Interfaces:**
- Produces:
  - `splitScript(text) -> { sentences: [{ i, text, speaker|null }], characters: string[] }`. Fiecare linie nevidă se împarte în propoziții după `. ! ?` urmate de spațiu, apoi propozițiile lungi se taie ca în Global Constraints. O linie `NUME: …` dă propoziții cu `speaker`. `characters` = numele de vorbitori, în ordinea primei apariții.
  - `STORYBOARD_SCHEMA`: obiect JSON-schema pentru Ollama:
    ```
    { decors: [{ id, prompt }],
      characters: [{ name, hair, shirt }],
      scenes: [{ from, to, decor, camera, characters: [{ name, expression, position }], overlay_type, overlay_text }] }
    ```
  - `buildStoryboardPrompt(sentences, language) -> string`, în engleză. Cere:
    - 4–8 decoruri refolosite, cu prompturi vizuale scurte, în engleză, „no people, no text”;
    - scene de 1–2 propoziții consecutive (`from`/`to` = indici);
    - personaje doar dintre cele date + cel mult 2 noi;
    - expresii, camere, poziții și grafice doar din listele lui `studio.js`;
    - `overlay_text` scurt (≤ 4 cuvinte).
  - `parseStoryboard(raw, split, language) -> story|null`:
    - întoarce un `story.json` gata de `validateStory`;
    - scenele sunt reparate: indici în ordine, fără goluri sau suprapuneri. Propozițiile lipsă se adaugă ca scene proprii, cu decorul scenei anterioare și camera `static`;
    - valorile necunoscute se înlocuiesc cu valorile implicite;
    - personajele vorbitorilor apar mereu în scenele lor;
    - `null` dacă JSON-ul e invalid sau fără decoruri.
  - `rulesStoryboard(split, language) -> story`: o scenă pe propoziție, un decor `scene` cu promptul `"a simple colorful background for a short story"`, camere alternate `zoom-in`/`zoom-out`. Vorbitorul apare `center`, cu `neutral`.
- [ ] **Step 1:** Teste care pică, în `test/storyboard.test.js`:
  - „splitScript splits sentences and dialogue lines”: `"Hello there. How are you?\nMAYOR: Pay them!"` → 3 propoziții, ultima cu `speaker "MAYOR"`; `characters ["MAYOR"]`.
  - „splitScript cuts long sentences at commas and conjunctions”: o propoziție de 20 de cuvinte cu o virgulă la cuvântul 9 → 2 bucăți, textul lipit la loc = originalul.
  - „parseStoryboard keeps every sentence exactly once, in order”: răspuns cu scenele `0–1` și `3–3` (lipsește 2) → scenele acoperă 0..3, textul scenelor lipit = textul original.
  - „parseStoryboard drops unknown expressions/cameras to defaults and adds the speaker to his scene”.
  - „parseStoryboard returns null for garbage”.
  - „rulesStoryboard makes one scene per sentence and passes validateStory”.
  - „buildStoryboardPrompt lists sentences with indices and the allowed values”.
- [ ] **Step 2:** `node --test` → pică.
- [ ] **Step 3:** Implementează. Rezultatul trece prin `S.validateStory`; testele o verifică.
- [ ] **Step 4:** `node --test` → trec.
- [ ] **Step 5:** Commit `feat(story): storyboard from the script (AI prompt, validation, rules)`

### Task 2: Worker-ul de imagini și regenerarea cu seed nou

**Files:**
- Create: `image-worker.js`
- Modify: `studio/imagegen.py` (mod `--serve`), `studio.js` (`generateDecors` cu `runner` și `force`), `testing/fake-tools.js` (imagegen `--serve`)
- Test: `test/studio.test.js`

**Interfaces:**
- Produces:
  - `imagegen.py --serve`: citește din stdin câte o linie JSON = un obiect `jobs` (ca în modul fișier, cu `out` absolut). Modelul se încarcă o dată, la primul job; dimensiunea fixă se ia din primul job. Pentru fiecare job tipărește o linie `{"ok":true,"items":[…]}` sau `{"ok":false,"error":"…"}`. Se oprește la EOF.
  - `image-worker.js`:
    - `createImageWorker({ idleMs = 600_000, spawnFn }) -> { run(jobs) -> Promise<items>, stop() }`;
    - pornește procesul la primul `run`;
    - pune cererile la coadă, una câte una;
    - oprește procesul după `idleMs` fără cereri;
    - dacă procesul moare, cererea curentă e respinsă și următoarea pornește un proces nou.
    
    Pornirea folosește `CLIPTREI_FAKE_TOOLS` la fel ca `proc.run` (comanda falsă = `node fake-tools.js <python> <script> --serve`).
  - `generateDecors(folder, story, { log, runner, force = [] })`:
    - `runner(jobs) -> Promise` (implicit: modul fișier prin `proc.run`);
    - `force` = id-uri de regenerat chiar dacă au imagine;
    - jobs-ul are `out` **absolut**;
    - seed-ul = `seedOf(id) + seeds[id]`, unde `decors.json` devine `{ prompts: {id: prompt}, seeds: {id: n} }`, iar `force` crește `seeds[id]`.
    
    Formatul vechi `{id: prompt}` se citește ca `prompts`.
- [ ] **Step 1:** Teste care pică:
  - „generateDecors with force regenerates with a new seed”: două apeluri `force:["a"]` dau seed-uri diferite pentru `a` în jobs.
  - „image worker runs jobs one at a time and stops after idle”: cu fake-ul, două `run` paralele → ambele primesc rezultat, iar log-ul arată un singur proces pornit. După `idleMs: 50`, procesul e oprit; un al treilea `run` pornește altul.
  - „image worker rejects the current job when the process dies and restarts”: control `imagegenServeDies` → primul `run` respins, al doilea reușește.
  - „generateDecors reads the old decors.json format”.
- [ ] **Step 2:** `node --test` → pică.
- [ ] **Step 3:** Implementează. Fake-ul `--serve` citește liniile stdin, scrie fișierele și răspunde. La `imagegenServeDies` iese cu cod 1 la primul job și șterge flag-ul.
- [ ] **Step 4:** `node --test` → trec. Verificare reală: `imagegen.py --serve` cu 2 joburi trimise din Node; al doilea durează ~21 s, fără reîncărcarea modelului.
- [ ] **Step 5:** Commit `feat(story): keep the image model loaded for quick decor regeneration`

### Task 3: API-ul poveștilor în server

**Files:** Modify `server.js`, `projects.js` (listă: `type`), `subtitles.js` (`top`), `studio/overlays.py` (`sign` la 25%), `story.js` (opțiunea pentru subtitrări sus)
**Test:** `test/stories.test.js` (server pornit ca în `server.test.js`, cu Ollama fals propriu)

**Interfaces:**
- Consumes: Task 1, Task 2, `buildStory` (`story.js`)
- Produces (toate răspund cu proiectul complet = `project.json` + `story` + `decorVersions: {id: mtimeMs}`):
  - `POST /api/stories {language, script, title?}`:
    - verifică: limba `en`/`ro`, text de 20–5000 de caractere, cel mult 40 de scene după împărțire;
    - ia blocarea globală și creează proiectul `type:"story"`, cu `status "storyboarding"`;
    - AI-ul face scenele (cu progres în `storyProgress: {stage}`), iar `story.json` se scrie validat;
    - `status "decors"`: decorurile se fac prin worker;
    - la final `status "editing"`.
    
    La eroare: `status "failed"` + `resumable`.
  - `GET /api/projects/<id>`: pentru `type:"story"` adaugă `story` și `decorVersions`.
  - `POST /api/stories/<id>/scene {index, camera?, overlay?, characters?}`: validează prin `validateStory` pe copia modificată și salvează. Refuzat dacă proiectul nu e în `editing`/`ready`.
  - `POST /api/stories/<id>/decor {decor, prompt}`: cu blocarea `<id>:decor`, salvează promptul și rulează `generateDecors(force:[decor])` prin worker.
  - `POST /api/stories/<id>/upload?decor=<id>`: corp binar ≤ 15 MB, PNG/JPEG/WebP. Scrie `decor-<id>.png` (PIL citește după conținut) și șterge înregistrarea din `prompts`, deci imaginea devine „pusă de mână”.
  - `POST /api/stories/<id>/preview` și `/render`: blocare globală, `status "rendering"`, apoi `buildStory(preview)`. Rezultatul: `preview: url` sau `video: url`, `status "ready"` după randarea finală (`editing` după previzualizare).
  - `POST /api/projects/<id>/resume` pentru povești reia etapele lipsă (scene → decoruri → `editing`).
  - Lista din `/api/projects` are `type` și, pentru povești, `sceneCount`.
  - `buildAss(..., { top: 560 })`: stil `Alignment 8`, `MarginV 560`; `story.js` îl folosește.
- [ ] **Step 1:** Teste care pică, în `test/stories.test.js`:
  - „create story with Ollama down: rules storyboard, decors generated, status editing”;
  - „create story with the AI: scenes follow the AI answer, text unchanged”;
  - „scene edit validates (bad expression → 400) and saves”;
  - „regenerate decor bumps its version; a second call while busy → 409”;
  - „upload rejects non-images and >15 MB, accepts a PNG and marks it hand-placed”;
  - „preview then render: files exist, status ready, video url”;
  - „a second heavy job (YouTube process) is refused while a story is being created”;
  - „project list shows type story and sceneCount; YouTube projects unchanged”;
  - „resume a failed story continues from the missing stage”;
  - `test/subtitles.test.js`: „buildAss with top puts captions at the top”.
- [ ] **Step 2:** `node --test` → pică.
- [ ] **Step 3:** Implementează. Worker-ul e unul singur pe server (`createImageWorker()`), oprit la `server.close`.
- [ ] **Step 4:** `node --test` → trec (inclusiv toate testele vechi). Testele Python trec după mutarea panoului.
- [ ] **Step 5:** Commit `feat(story): stories API (create, edit scenes, regenerate/upload decors, preview, render)`

### Task 4: Interfața: „Poveste nouă” și editorul storyboard (2B)

**Files:**
- Create: `story-ui.js`
- Modify: `index.html` (meniu + secțiuni), `app.js` (rute `#/story/new`, `#/s/<id>`, rânduri de proiect), `ui.css`

**Interfaces:**
- Consumes: API-ul din Task 3.
- Produces:
  - **Ecranul „Scrie povestea”:** ca tabul 1 din machetă (limbă, text, contor de cuvinte și durată estimată ≈ cuvinte / 2,6 s, butonul „Pregătește scenele”). În timpul creării apare progresul etapei (polling `GET /api/projects/<id>` la 3 s, ca la procesare).
  - **Editorul:** ca tabul 2B:
    - grila de cadre 9:16, cu imaginea `decor-<id>.png?v=<version>`, numărul, eticheta vorbitorului și textul;
    - panoul lateral, cu prompt + „Regenerează decorul” (dezactivat cât lucrează, cu mesajul „~20 s”), „Încarcă imagine” (input file → POST binar), camera, graficul (tip + text) și personajele (adaugă/șterge, expresie, poziție);
    - fiecare schimbare se salvează imediat (`/scene`);
    - butoanele „Previzualizare” și „Creează video”, cu un player `<video>` pentru rezultat;
    - după video: „Descarcă” și reamintirea „Pe TikTok, marchează videoul ca generat cu AI.”
  - **„Proiectele mele”:** rândurile de poveste au eticheta „Poveste”, „N scene” și duc la `#/s/<id>`.
- [ ] **Step 1:** Verificare de bază: `node --check story-ui.js app.js`; testele existente trec.
- [ ] **Step 2:** Implementează.
- [ ] **Step 3:** Verificare în browser (server pe port separat, cu Ollama și imagini reale):
  - creez povestea exemplu din text;
  - regenerez un decor;
  - schimb o expresie;
  - previzualizare + video.
  
  Fac capturi ale ecranelor (desktop 1300 px și mobil 390 px), fără derulare orizontală.
- [ ] **Step 4:** Commit `feat(story): story editor UI (script screen, storyboard 2B, preview, render)`

### Task 5: Documentație și rularea reală cap-coadă

**Files:** Modify `CLAUDE.md`, `README.md`, `docs/jurnal.md` (doar la salvarea contextului)

- [ ] **Step 1:** Rulare reală din interfață: povestea exemplu ca text, cu AI real (Ollama). Notez timpii pe etape, câte scene și decoruri a propus AI-ul și dacă a fost nevoie de reguli.
- [ ] **Step 2:** CLAUDE.md: structura (fișierele noi), cifrele, capcanele noi, „Unde am rămas”. README: secțiunea „Povești animate” (din aplicație).
- [ ] **Step 3:** `node --test` și testele Python trec. Commit `docs: stories in the app; measured times`.
