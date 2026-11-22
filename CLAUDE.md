# ClipTrei

## Scop
Aplicație locală (Node + ffmpeg + yt-dlp + Whisper) care primește un link YouTube, alege 3 momente bune și le exportă ca Shorts verticale (1080×1920). Clipurile au subtitrări karaoke și se pot edita per clip: zoom cu bare blurate, video „satisfying” jos, tăierea pauzelor. „Gata” = Enea poate scoate și edita Shorts din orice video YouTube public, fără servicii plătite.

## Decizii (2026-11-22, toate de Enea, dacă nu scrie altfel)
- Subtitrări stil **karaoke**: 3–4 cuvinte MAJUSCULE, alb cu contur, cuvântul rostit galben și mărit; același stil pe toate clipurile.
- Pe videouri străine, **subtitrările sunt în limba vorbită** (nu traducerea RO a YouTube): „lasă în engleză”.
- **Editare după procesare, separat pentru fiecare clip** (nu o setare globală). Bare la zoom out = **același video blurat**.
- Video jos: din folderul local **`satisfying/`**, ales la întâmplare, fără sunet. Ecranul e împărțit 50/50, cu subtitrarea pe linia din mijloc.
- **Proiectele se pot redeschide** („Proiectele mele”). Folderele vechi fără `project.json` sunt „doar vizionare”.
- **Whisper local (`faster-whisper`)**, nu API plătit, în două feluri: (a) mereu pe cele 3 clipuri, pentru timpi exacți; (b) pe tot videoul când nu există subtitrări originale, după confirmare cu estimarea de timp.
- **Taie pauzele**: clipul rămâne mai scurt, nu se completează la loc. Funcționează doar cu timpi de la Whisper (decizia lui Claude: timpii YouTube nu arată tăcerile).
- **Fără anulare** pentru transcrierea lungă: procesarea merge până la capăt, iar proiectul apare în listă.
- **Un singur video procesat odată**: al doilea e refuzat cu mesaj, fără coadă (A). Procesarea căzută sau întreruptă se reia manual cu „Reia”, nu automat.
- **Momente alese cu AI local** (Ollama `qwen2.5:7b`, gratuit, A), pentru streamuri și podcasturi (C), lungime naturală 20–50 s la limită de frază (A, lărgită în cod la ≥ 30 s), 10 candidați (B), preselecție după reguli + AI (1). Fără Ollama → reguli, fără eroare.
- Git: repo `enea1212/Clip-Click` (public), branch `main`. **Commit și push la final de funcționalitate. De acum, fiecare funcționalitate nouă pe branch-ul ei.**
- Conversația cu Claude se ține în română.

## Mediu de lucru
- Windows 11, laptop i5-1235U (12 fire), 16 GB RAM, Intel Iris Xe, **fără NVIDIA**: Whisper rulează pe CPU.
- Node 24, Python 3.12 (`yt-dlp`, `faster-whisper` 1.2.1 + modelul `small`, int8), ffmpeg 2026 (în PATH).
- Pornire: `node server.js` → http://localhost:4173. Teste: `node --test` (fără argument de folder: `node --test test/` nu merge pe Node 24/Windows).
- Instalare Whisper: `python -m pip install --user faster-whisper`.

## Structura repo-ului
- `server.js`: HTTP și API (`/api/inspect`, `/api/process`, `/api/projects[/<id>]`, `/api/satisfying`, `/api/render`), job-uri ffmpeg/yt-dlp/Whisper, blocări per clip.
- `subtitles.js`: VTT → cuvinte, grupare, fișier `.ass` karaoke. `clips.js`: alegerea celor 3 momente. `pauses.js`: segmente de vorbire și mutarea cuvintelor pe cronologia tăiată.
- `layout.js`: formula de zoom și graful de filtre ffmpeg; e folosit și în browser, pentru previzualizare. `render.js`: argumentele pentru ffmpeg/ffprobe.
- `whisper.js` + `transcribe.py`: transcrierea locală (videourile lungi pe bucăți de 10 min). `proc.js`: rularea proceselor externe (decodare UTF-8 corectă). `projects.js`: `project.json`, lista de proiecte, blocările, alegerea gameplay-ului. `http-utils.js`: servire statică sigură.
- `app.js`, `index.html`, `ui.css`, `styles.css`: interfața. `pipeline.js`: etapele procesării și reluarea. `ai.js`: alegerea momentelor cu Ollama (linii, prompt, validare, clasare, rezervă). `test/`: testele (132, inclusiv `server.test.js` end-to-end). `testing/fake-tools.js`: unelte false pentru teste.
- `docs/superpowers/specs|plans/`: designuri și planuri. `docs/jurnal.md`: istoricul sesiunilor.
- Ignorate: `data/` (proiecte și videouri, pot avea GB), `satisfying/`, `.superpowers/` (jurnale de execuție și copii ale fișierelor vechi), `.playwright-mcp/`.

## Cifre de referință (măsurate pe laptopul lui Enea)
- Whisper `small` int8 pe CPU: clip de 34 s → 25,3 s (cu încărcarea modelului); 180 s audio → 76,6 s (factor 0,425; în cod `FACTOR = 0.45`).
- Taie pauzele pe TED (vorbire densă): 34 s → 31,3 s; tăceri > 0,5 s: 2 → 0.
- Transcriere completă TED 14 min (2 bucăți) + descărcare + 3 randări: 439 s.
- Re-randare clip după „Aplică”: ~30 s (plus ~40 s Whisper la primul „Aplică” pe proiecte vechi).
- Video de 6 h (stream): descărcare 6,7 GB în ~5 min; transcriere completă estimată la ~166 min.

## Capcane cunoscute
- `faster-whisper` 1.2.1 + `av` 19 crapă (`open()` nu mai acceptă `metadata_errors`). Ocolire: `transcribe.py` citește WAV-ul cu `wave` + numpy și îi dă lui Whisper eșantioanele.
- Nu rula `transcribe.py` cu `python -I`: modul izolat nu vede pachetele `--user`.
- Whisper desparte cuvintele cu cratimă („ non” + „-procrastinators”). `parseTranscript` lipește bucățile fără spațiu în față.
- `--sub-langs ro.*` aduce zeci de traduceri automate și duce la HTTP 429. Lista e fixă: `ro,ro-orig,ro-RO,en,en-orig,en-US,en-GB`, cu `--ignore-errors`.
- Căile cu `D:` strică filtrele ffmpeg: ffmpeg rulează cu `cwd` = folderul proiectului și primește doar nume de fișiere.
- Subtitrările automate YouTube repetă rândul anterior în fiecare cue. Cue-urile se citesc după liniile `-->`, nu după rândurile goale.
- În Git Bash, heredoc-urile pot strica `\\` din cod JS. Pentru cod cu backslash se folosește editorul de fișiere.
- La transcrierea pe bucăți, o bucată care începe fix în punctul de tăiere aude cuvântul tăiat ca pe unul nou (dublură). Audio-ul fiecărei bucăți începe cu 5 s înainte de tăiere; cuvântul aparține bucății în care începe.
- Output-ul proceselor se decodează o singură dată, la final (`proc.js`): decodat pe bucăți, rupea diacriticele.
- Cuvintele aflate mai mult în afara clipului se ignoră la tăierea pauzelor; altfel apare un fragment de 60 ms la început.
- **PR-uri înlănțuite pe GitHub:** la merge cu ștergerea branch-ului, PR-ul următor (care avea branch-ul șters ca bază) e **închis**, nu mutat. Mută întâi PR-urile de deasupra pe `main` (`gh pr edit N --base main`), apoi dă merge, și abia la final șterge branch-urile.
- **Teste de server:** `CLIPTREI_FAKE_TOOLS` (unelte false din `testing/fake-tools.js`) și `CLIPTREI_DATA_DIR` / `CLIPTREI_SATISFYING_DIR` (foldere temporare). Fișierele din `test/` sunt toate tratate ca teste de `node --test`, de-asta scriptul fals stă în `testing/`.
- Shell-ul rămas într-un folder din `data/` blochează ștergerea lui pe Windows (EBUSY).
- Modelul `qwen2.5:7b`: notat separat dă aceeași notă (7/10) tuturor candidaților → runda de clasare comparativă decide; ignoră cererea de lungime → lărgire în cod; amestecă limbile dacă nu i le spui explicit. Testele de server folosesc mereu un Ollama fals (`CLIPTREI_OLLAMA_URL`): nu apelează niciodată modelul real.
- Browserul ținea `ui.css` vechi în cache. Fișierele aplicației se servesc acum cu `Cache-Control: no-cache`.

## Unde am rămas
Funcționalitatea Whisper + tăierea pauzelor e **gata**: toate task-urile, review-ul final și reparațiile lui au commit și sunt urcate pe `main`. Probleme mici amânate: drift de până la un cadru pe segment tăiat, coduri de limbă nealiniate între `/api/inspect` și `--sub-langs`, VTT descărcate inutil la `transcribe: true`. Lista completă e în `.superpowers/sdd/2026-11-22-whisper-pauses/progress.md`.

Robustețea, testele end-to-end, „LOCUL n DIN 3” și problemele mici sunt în `main` (PR #1–#6).

**Alegerea momentelor cu AI** e pe branch-ul `feature/ai-momente`, cu PR deschis (#7, încă fără merge): Ollama `qwen2.5:7b` notează 10 candidați preselectați de reguli, apoi o rundă de clasare comparativă; titlu + motiv pe card; rezervă pe reguli; „Alege din nou cu AI”. Măsurat pe TED: ~60 s/candidat, total 464 s. Probleme amânate: fără limită totală de timp pentru etapa AI; ecranul „Alege din nou” fără progres. Detalii: `.superpowers/sdd/2026-11-22-ai-momente/progress.md`.

Următorul pas: merge la PR-ul AI, apoi un test pe un stream de gaming real.
