# Povești animate, partea 1: motorul — plan de implementare

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dintr-un folder cu `story.json` (scris de mână), comanda `node story.js <folder>` produce `story.mp4`: video 1080×1920 cu decoruri generate local, voce, personaje desenate de cod, elemente grafice și subtitrări karaoke.

**Architecture:**
- **Node** (`story.js`) orchestrează pe etape, reluabile după fișierele existente: decoruri → voce → timpi pe cuvânt → subtitrări → randare.
- **Partea grea e în Python**, într-un mediu separat (`studio/venv`), cu trei scripturi chemate prin `proc.run`: `imagegen.py` (SD-Turbo/OpenVINO), `tts.py` (Kokoro/Piper) și `render_story.py` (Pillow, cadre trimise în ffmpeg).
- **Whisper** (`transcribe.py`, Python-ul de sistem) dă timpii.
- **Subtitrările** le face `subtitles.js` existent, cu grupuri de 2 cuvinte.

**Tech Stack:**
- Node 24 (`node:test`);
- Python 3.12 cu `openvino` 2026.4.1, `optimum-intel` 2.2.0, `diffusers` 0.39.0, `kokoro-onnx` 0.6.1, `piper-tts` 1.8.0 (rulat ca proces separat, GPL), `pillow` 13.0.0 și `numpy` 2.4.6;
- ffmpeg.

**Spec:** `docs/superpowers/specs/2026-11-23-povesti-animate-design.md` (partea 1 = etapele 1–3 din „Mărime și ordine sugerată”)

## Global Constraints
- Totul local și gratuit. Testele Node nu rulează niciodată modele reale: `studio/*.py` și `transcribe.py` trec prin `testing/fake-tools.js`.
- `ffmpeg` rulează cu `cwd` = folderul proiectului și primește doar nume de fișiere (capcana `D:` din CLAUDE.md).
- Video 1080×1920, 30 fps; previzualizare 540×960, 15 fps.
- Decoruri 576×1024, SD-Turbo, 2 pași, `guidance_scale 0`, cu stilul comun fix:
  `stylized 3D render, bright daylight, clean cartoonish realism, cinematic lighting, no people, no text`.
  Dacă 576×1024 depășește ~12 s pe imagine pe Iris Xe, se trece la 512×896.
- Dispozitive: `GPU` (Iris Xe), apoi `CPU` dacă placa nu e disponibilă.
- Pauză după fiecare scenă: 0,25 s; după ultima, 0,6 s.
- Subtitrări: grupuri de cel mult 2 cuvinte pe poveste (implicit rămâne 4 pentru clipurile YouTube).
- Textul afișat și cel rostit e exact textul scenei din `story.json`.
- `studio/venv/` și `models/` sunt ignorate de git.
- Testele Python: `studio\venv\Scripts\python -m unittest discover -s studio/tests`. Testele Node: `node --test`.

## Review Focus
1. Un decor lipsă sau o imagine neîncărcabilă: oprire cu mesaj clar care numește decorul, nu cadre negre.
2. Whisper aude alte cuvinte decât textul: subtitrarea afișează tot textul scenariului, cu timpi interpolați și în ordine.
3. Text cu diacritice românești și ghilimele/apostrof („ ” ’) trece prin TTS, aliniere și `.ass` fără să se strice.
4. Reluarea după o cădere la mijloc refolosește decorurile și vocea deja făcute.
5. Placa video indisponibilă: generarea merge pe procesor și scrie asta în log.

---

### Task 1: `studio/`: instalare, căi și formatul `story.json`

**Files:**
- Create: `studio/requirements.txt`, `studio/setup.py`, `studio.js`, `test/studio.test.js`
- Modify: `.gitignore` (+ `studio/venv/`, `models/`)

**Interfaces:**
- Produces:
  - `studio.js`:
    - `studioPython() -> string`: `process.env.CLIPTREI_STUDIO_PYTHON` sau `<ROOT>/studio/venv/Scripts/python.exe` (pe alte sisteme `bin/python`);
    - `MODELS_DIR`: `process.env.CLIPTREI_MODELS_DIR` sau `<ROOT>/models`;
    - `script(name) -> string`: calea absolută la `studio/<name>`;
    - `validateStory(raw) -> story`, care aruncă `Error` cu mesaj în română.
  - Constante în `studio.js`:
    - `CAMERAS = ["zoom-in","zoom-out","pan-left","pan-right","static"]`
    - `EXPRESSIONS = ["neutral","happy","angry","surprised","sad","smug"]`
    - `POSITIONS = ["left","center","right"]`
    - `OVERLAYS = ["badge","sign","money","flash","emoji"]`
    - `HAIR = ["short","long","bald","cap"]`
    - `LANGUAGES = ["en","ro"]`
  - Formatul `story.json`, normalizat de `validateStory`:
    ```
    { language, narrator: { voice },
      characters: [{ name, look: { skin, hair, shirt }, voice }],
      decors: [{ id, prompt }],
      scenes: [{ text, speaker: name|null, decor, camera, characters: [{ name, expression, position }], overlay: { type, text }|null }] }
    ```
    `skin` și `shirt` sunt culori `#rrggbb`.
  - `voice`:
    - `en`: un nume de voce Kokoro (ex. `am_michael`);
    - `ro`: `{ pitch, speed }`, cu `pitch` între 0,8 și 1,25 (Piper are o singură voce românească).
    - Lipsă: naratorul primește `am_michael` / `{pitch:1,speed:1}`; personajele primesc voci diferite dintr-o listă fixă, în ordine.

- [ ] **Step 1:** Teste care pică, în `test/studio.test.js`:
  - „validateStory accepts a minimal story and fills defaults”: o scenă fără `camera`, `characters` și `overlay` → `camera "static"`, `characters []`, `overlay null`, `speaker null`; naratorul `en` primește `am_michael`.
  - „validateStory rejects unknown decor / character / expression with a Romanian message”: mesajele conțin „decorul”, „personajul” și „expresia”, plus valoarea greșită.
  - „validateStory rejects empty scene text and scenes over 40 words”.
  - „characters without a voice get distinct default voices”: 3 personaje `en` → 3 voci diferite, toate diferite de a naratorului.
  - „studioPython honours CLIPTREI_STUDIO_PYTHON”.
- [ ] **Step 2:** `node --test` → testele noi pică (`Cannot find module '../studio'`).
- [ ] **Step 3:** Implementează `studio.js`. `studio/requirements.txt` primește exact versiunile din Tech Stack, plus `torch==2.15.0+cpu` (pentru conversie), `transformers==5.5.4` și `huggingface_hub==1.21.0`.

  `studio/setup.py` (rulat cu Python-ul de sistem):
  1. creează `studio/venv`;
  2. `pip install -r studio/requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu`;
  3. descarcă `kokoro-v1.0.onnx` și `voices-v1.0.bin` (release `model-files-v1.0` din `thewh1teagle/kokoro-onnx`) în `models/kokoro/`;
  4. `python -m piper.download_voices ro_RO-mihai-medium --data-dir models/piper`;
  5. convertește `stabilityai/sd-turbo` cu `OVStableDiffusionPipeline.from_pretrained(..., export=True)` în `models/sd-turbo-ov/`, cu `HF_HOME` temporar în `models/.hf-tmp`, șters la final.
  
  Fiecare pas sare peste ce există deja.
- [ ] **Step 4:** `node --test` → trec toate.
- [ ] **Step 5:** Rulează `python studio/setup.py` pe laptop. Expected: există `models/sd-turbo-ov/`, `models/kokoro/` și `models/piper/`, iar `studio\venv\Scripts\python -c "import openvino, kokoro_onnx, PIL"` merge.
- [ ] **Step 6:** Commit `feat(story): studio setup, paths and story.json validation`

### Task 2: Decorurile (`imagegen.py`)

**Files:**
- Create: `studio/imagegen.py`
- Modify: `testing/fake-tools.js` (comanda `imagegen.py`), `studio.js`
- Test: `test/studio.test.js`

**Interfaces:**
- Consumes: `studioPython`, `script`, `MODELS_DIR`, `validateStory` (Task 1)
- Produces:
  - `studio/imagegen.py <jobs.json>`, cu `jobs = { model_dir, width, height, steps, style, device_order: ["GPU","CPU"], items: [{ prompt, out, seed }] }`.
    - Încarcă modelul **o singură dată** și îl fixează la dimensiune (`pipe.reshape` corect pentru batch 1, fără CFG; vezi capcana din test: `reshape` implicit cere batch 2).
    - Scrie fiecare `out` (PNG) și tipărește câte o linie JSON `{"out","seconds","device"}` pe imagine.
    - La eșec, exit ≠ 0 cu mesaj.
  - `generateDecors(folder, story) -> Promise<{ generated: string[] }>` în `studio.js`:
    - pentru fiecare decor fără `decor-<id>.png`, scrie `decor-jobs.json` și rulează `imagegen.py` cu `cwd` = folder;
    - `seed` = hash stabil al `id`-ului;
    - un decor care are deja fișierul nu se regenerează.
- Fake (`testing/fake-tools.js`): `args[0]` se termină cu `imagegen.py` → scrie `"fake png"` în fiecare `out` și tipărește liniile JSON. Controlul `imagegenFails` → exit 1.

- [ ] **Step 1:** Teste care pică:
  - „generateDecors writes one image per missing decor, in one imagegen run”: 3 decoruri, `decor-b.png` există dinainte → un singur apel `imagegen.py` în log, iar jobs-ul are 2 itemi, cu promptul compus din promptul decorului + `, ` + stilul comun.
  - „generateDecors names the decor when imagegen fails”: eroarea conține `imagegen`.
- [ ] **Step 2:** `node --test` → pică.
- [ ] **Step 3:** Implementează `generateDecors`, fake-ul și `imagegen.py`.
  - Prima linie a log-ului de stderr: `device=GPU` sau `device=CPU (placa video indisponibilă)`.
  - Dacă `GPU` aruncă la compilare, se reîncearcă pe `CPU`.
- [ ] **Step 4:** `node --test` → trec.
- [ ] **Step 5:** Verificare reală: `studio\venv\Scripts\python studio\imagegen.py` pe un jobs cu 3 prompturi la 576×1024.
  - Expected: 3 PNG, timpul pe imagine după prima ≤ ~12 s pe `GPU`, iar prima imagine fără întârzierea de 60 s din test.
  - Dacă > 12 s, schimbă constanta la 512×896 și scrie `Ruling:` în ledger.
- [ ] **Step 6:** Commit `feat(story): generate decors with SD-Turbo on the Intel GPU`

### Task 3: Vocea (`tts.py`) și cronologia scenelor

**Files:**
- Create: `studio/tts.py`
- Modify: `studio.js`, `testing/fake-tools.js` (comanda `tts.py`)
- Test: `test/studio.test.js`

**Interfaces:**
- Consumes: Task 1
- Produces:
  - `studio/tts.py <tts.json>`, cu `tts = { language, models_dir, gap, last_gap, items: [{ text, voice, out }], combined: "voice.wav" }`:
    - **`en`:** Kokoro (`create(text, voice, lang="en-us")`, 24 kHz).
    - **`ro`:** `python -m piper -m <models>/piper/ro_RO-mihai-medium.onnx -f <out>`, cu textul pe stdin, ca **proces separat** (GPL). `voice.speed` devine `--length-scale 1/speed`, iar `voice.pitch ≠ 1` se aplică cu ffmpeg (`asetrate`, `aresample`, `atempo`).
    - Scrie fiecare `out` (WAV mono 16-bit) și `combined`: scenele lipite, cu `gap` după fiecare și `last_gap` după ultima, la același sample rate.
    - Tipărește JSON `{ "durations": [secunde pe item, fără pauză], "sampleRate" }`.
  - `synthesizeVoices(folder, story) -> Promise<number[]>` (durate). Rezultatul e cache-uit în `voice.json`, cu cheia = hash al textelor + vocilor + limbii. Dacă cheia se potrivește și `voice.wav` există, nu se rulează.
  - `sceneTimeline(durations, gap = 0.25, lastGap = 0.6) -> [{ start, end, speechEnd }]`, pur.
- Fake: `tts.py` → scrie fișiere goale și tipărește durate `words × 0.4` s.

- [ ] **Step 1:** Teste care pică:
  - „sceneTimeline adds 0.25 s after each scene and 0.6 s after the last”: `[2, 3]` → `[{start:0,end:2.25,speechEnd:2},{start:2.25,end:5.85,speechEnd:5.25}]`.
  - „synthesizeVoices uses the speaker's voice per scene and the narrator otherwise”: jobs-ul scris are vocea personajului pe scena cu `speaker`.
  - „synthesizeVoices is skipped when voice.json matches”: al doilea apel nu rulează `tts.py`.
- [ ] **Step 2:** `node --test` → pică.
- [ ] **Step 3:** Implementează.
- [ ] **Step 4:** `node --test` → trec.
- [ ] **Step 5:** Verificare reală pe 3 scene EN și 2 RO, cu un personaj cu `pitch 1.15`. Expected: `voice.wav` are durata = suma duratelor + pauzele (±0,05 s), iar vocea personajului se aude diferit.
- [ ] **Step 6:** Commit `feat(story): narrator and character voices (Kokoro EN, Piper RO)`

### Task 4: Timpii pe cuvânt și subtitrările

**Files:**
- Modify: `studio.js`, `subtitles.js` (`groupWords(words, { maxGroup = 4 } = {})`; `buildAss(..., { split, maxGroup })`)
- Test: `test/studio.test.js`, `test/subtitles.test.js`

**Interfaces:**
- Consumes: `sceneTimeline` (Task 3)
- Produces:
  - `alignWords(scriptWords: string[], heard: {word,start,end}[]) -> {word,start,end}[]`, pur, în `studio.js`.
    - Întoarce **exact** `scriptWords`, în ordine, fiecare cu timpi.
    - Potrivire după forma normalizată (litere mici, fără punctuație și diacritice), cu cea mai lungă subsecvență comună.
    - Cuvintele nepotrivite primesc timpi interpolați liniar între vecinii potriviți (sau între capetele intervalului).
    - Timpii sunt crescători, iar fiecare cuvânt durează ≥ 0,05 s.
  - `storyWords(folder, story, timeline) -> Promise<words>`:
    - convertește `voice.wav` la 16 kHz (`W.audioArgs({ output: "voice16.wav", source: "voice.wav" })`) și rulează `transcribe.py voice16.wav <language>`;
    - aliniază **pe fiecare scenă** cuvintele auzite în `[start, speechEnd]` cu cuvintele scenei, ca greșelile să nu treacă dintr-o scenă în alta;
    - scrie `words.json` (cache).
  - `captions.ass` = `buildAss(words, 0, total, { maxGroup: 2 })`.

- [ ] **Step 1:** Teste care pică:
  - „alignWords keeps the script words and their order when Whisper mishears”: script `["Stockholm","had","a","speeding","problem."]`, auzit `["stock","home","had","a","speeding","problem"]` → cuvintele întoarse sunt exact cele din script, crescătoare, iar `had` are timpii lui `had` auzit.
  - „alignWords interpolates when nothing matches”: auzit gol, interval 0–4 s → 5 cuvinte, crescătoare, în [0, 4].
  - „alignWords keeps diacritics and quotes in the output”: `„Nimic”` și `s-a` rămân neschimbate.
  - `test/subtitles.test.js`: „groupWords with maxGroup 2 never groups more than 2 words”; testele existente (implicit 4) rămân verzi.
- [ ] **Step 2:** `node --test` → pică.
- [ ] **Step 3:** Implementează.
- [ ] **Step 4:** `node --test` → trec.
- [ ] **Step 5:** Commit `feat(story): word timings aligned to the script; 2-word captions`

### Task 5: Randarea (`render_story.py`, personaje, elemente grafice)

**Files:**
- Create: `studio/scene.py` (timp, cameră, pur), `studio/characters.py`, `studio/overlays.py`, `studio/render_story.py`, `studio/tests/test_scene.py`, `studio/tests/test_draw.py`
- Modify: `testing/fake-tools.js` (comanda `render_story.py`)

**Interfaces:**
- Consumes: formatul `story.json` (Task 1), cronologia (Task 3)
- Produces:
  - `studio/render_story.py <render.json>`, cu `render = { width, height, fps, voice, subtitles, out, scenes: [{ start, end, decor_file, camera, characters: [{ name, look, expression, position, talking }], overlay }] }`.
    - Rulează din folderul proiectului.
    - Pornește `ffmpeg -f rawvideo -pix_fmt rgb24 -s WxH -r fps -i - -i <voice> -vf ass=<subtitles> -c:v libx264 -preset veryfast -crf 22 -c:a aac -b:a 160k -shortest -movflags +faststart <out>`.
    - Scrie cadrele în stdin.
    - Tipărește la final `{"frames","seconds"}`.
  - `scene.py`:
    - `scene_at(scenes, t) -> (index, local_t)`;
    - `camera_transform(camera, progress) -> (scale, dx, dy)`, cu `ease = 3p²−2p³`:
      - `zoom-in`: scale 1,0→1,15;
      - `zoom-out`: 1,15→1,0;
      - `pan-left` / `pan-right`: scale 1,1 și dx −0,08→+0,08 (respectiv +0,08→−0,08) din lățime;
      - `static`: (1,0,0).
    - `mouth_open(envelope, t) -> float 0..1`: volumul vocii la timpul t, normalizat.
  - `characters.py`: `draw_character(img, look, expression, x, y, height, blink: bool, mouth: float)`. Personajul are:
    - capul: cerc, piele `look.skin`, contur negru de 4 px;
    - ochii: buline, care devin linii la `blink`;
    - sprâncenele și gura după expresie;
    - părul după `look.hair`;
    - corpul: dreptunghi rotunjit `look.shirt`;
    - picioarele: două bețe.
    
    Mișcare (se aplică la `y` și `height`):
    - intră cu o săritură în primele 0,3 s ale scenei;
    - se leagănă ±2% din înălțime, cu perioada 2 s;
    - clipește 0,12 s la fiecare 3–5 s (determinist după nume).
  - `overlays.py`: `draw_overlay(img, overlay, local_t, rng)`:
    - `badge`: casetă rotunjită închisă la culoare, cu contur cyan și text mare roșu/verde (cifrele), în partea de sus;
    - `sign`: panou alb cu contur, text negru, la mijloc;
    - `money`: 12 bancnote verzi care cad și se rotesc;
    - `flash`: alb 100%→0% în 0,25 s;
    - `emoji`: un glif din fontul de sistem `seguiemj.ttf`, dacă există, altfel se sare peste el.
    
    Textele folosesc `arialbd.ttf` din `C:\Windows\Fonts`, cu rezervă `ImageFont.load_default`.
  - Pozițiile: `left` = 25% din lățime, `center` = 50%, `right` = 75%. Personajul are înălțimea = 38% din înălțimea cadrului, cu picioarele la 82%.
  - Decorul se scalează să umple cadrul (cover), apoi i se aplică `camera_transform`.
- Fake: `render_story.py` → citește `render.json` și scrie `"fake mp4"` în `out`.

- [ ] **Step 1:** Teste Python care pică:
  - `test_scene.py`:
    - `scene_at` la granițe (exact `end` → scena următoare; după ultima → ultima);
    - `camera_transform("zoom-in", 0)` = `(1.0,0,0)`, la 1 = `(1.15,0,0)`, monoton;
    - `pan-left` la 0 și 1 e simetric;
    - o cameră necunoscută aruncă `ValueError`.
  - `test_draw.py`:
    - `draw_character` pe o imagine albă 540×960 desenează doar în dreptunghiul așteptat (pixelii din afara lui rămân albi);
    - `angry` și `happy` diferă în zona gurii;
    - `blink=True` schimbă zona ochilor;
    - `draw_overlay(flash)` la t=0 face cadrul alb, la t=0,3 îl lasă neschimbat.
- [ ] **Step 2:** `studio\venv\Scripts\python -m unittest discover -s studio/tests` → pică (module lipsă).
- [ ] **Step 3:** Implementează modulele și `render_story.py`. Plicul vocii se citește o dată din `voice.wav` (RMS pe cadru). Fiecare decor se încarcă o dată și se păstrează în memorie.
- [ ] **Step 4:** Testele Python trec.
- [ ] **Step 5:** Verificare reală: un `render.json` de 6 s, cu 2 scene și un decor generat în Task 2. Expected:
  - `ffprobe` arată 1080×1920, 30 fps, ~6 s, audio AAC;
  - un cadru extras arată personajul, elementul grafic și subtitrarea (verificat vizual);
  - viteza de randare e notată în ledger.
- [ ] **Step 6:** Commit `feat(story): frame renderer with characters, overlays and camera moves`

### Task 6: Orchestrarea `node story.js <folder>` și primul video real

**Files:**
- Create: `story.js`, `test/story.test.js`, `docs/examples/speed-camera/story.json`
- Modify: `CLAUDE.md` (structura, decizii, capcane, cifre), `README.md` (secțiunea „Povești animate (în lucru)”)

**Interfaces:**
- Consumes: `validateStory`, `generateDecors`, `synthesizeVoices`, `sceneTimeline`, `storyWords`, `buildAss` și scriptul de randare (Task 1–5)
- Produces:
  - `buildStory(folder, { preview = false, log = console.log }) -> Promise<{ video, seconds }>`:
    1. citește și validează `story.json`;
    2. decoruri, voce, cronologie, cuvinte, `captions.ass`;
    3. scrie `render.json`: `talking` = personajul e `speaker` al scenei; `decor_file` = `decor-<id>.png`; `out` = `story.mp4` sau `story-preview.mp4`;
    4. rulează `render_story.py`.
    
    Fiecare etapă scrie un rând de log cu timpul ei.
  - CLI: `node story.js <folder> [--preview]`. Exit ≠ 0 cu mesajul erorii.
  - `docs/examples/speed-camera/story.json`: povestea de referință rescrisă de Claude în engleză, ~45 s, cu 12–14 scene, 5–6 decoruri, 2 personaje (`MAYOR`, `DRIVER`) și cel puțin un element grafic din fiecare tip.

- [ ] **Step 1:** Teste care pică, în `test/story.test.js` (cu `CLIPTREI_FAKE_TOOLS`, `CLIPTREI_FAKE_CONTROL` și `CLIPTREI_STUDIO_PYTHON` setate în test, într-un folder temporar):
  - „buildStory runs decors, voice, whisper and render in order and writes render.json”: ordinea comenzilor în log este `imagegen.py`, `tts.py`, `ffmpeg … voice16.wav`, `transcribe.py`, `render_story.py`. `render.json` are câte o scenă pentru fiecare scenă din story, cu `start`/`end` crescători. Personajul `speaker` are `talking: true`.
  - „buildStory resumes: a second run only renders”: al doilea apel nu mai rulează `imagegen.py` și nici `tts.py`.
  - „buildStory with a missing decor file and failing imagegen stops with the decor named”.
  - „buildStory --preview renders 540×960 at 15 fps into story-preview.mp4”.
- [ ] **Step 2:** `node --test` → pică.
- [ ] **Step 3:** Implementează `story.js` și exemplul.
- [ ] **Step 4:** `node --test` trece; testele Python trec.
- [ ] **Step 5:** Verificare reală: `node story.js <copie a exemplului în data/story-test>`. Expected:
  - `story.mp4` de 1080×1920, cu durata ≈ suma vocii;
  - timpii pe etape notați;
  - 6 cadre extrase și verificate vizual (decor, personaje, elemente grafice, subtitrare sincronizată).
  
  Cifrele intră în CLAUDE.md.
- [ ] **Step 6:** Commit `feat(story): node story.js builds a video from story.json; example; docs`
