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
- 2026-11-23 — **Preselecția AI: 5 după vorbire + 5 după vârfurile de sunet (A)**: pe GTA, regulile după vorbire ratau 11 din 12 reacții puternice.
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
- `app.js`, `index.html`, `ui.css`, `styles.css`: interfața. `pipeline.js`: etapele procesării și reluarea. `ai.js`: alegerea momentelor cu Ollama (linii, prompt, validare, clasare, rezervă). `loudness.js`: volum pe secundă, vârfuri, amestec de candidați. `test/`: testele (144, inclusiv `server.test.js` end-to-end). `testing/fake-tools.js`: unelte false pentru teste.
- `docs/superpowers/specs|plans/`: designuri și planuri. `docs/jurnal.md`: istoricul sesiunilor.
- Ignorate: `data/` (proiecte și videouri, pot avea GB), `satisfying/`, `.superpowers/` (jurnale de execuție și copii ale fișierelor vechi), `.playwright-mcp/`.

## Cifre de referință (măsurate pe laptopul lui Enea)
- Whisper `small` int8 pe CPU: clip de 34 s → 25,3 s (cu încărcarea modelului); 180 s audio → 76,6 s (factor 0,425; în cod `FACTOR = 0.45`).
- Taie pauzele pe TED (vorbire densă): 34 s → 31,3 s; tăceri > 0,5 s: 2 → 0.
- Transcriere completă TED 14 min (2 bucăți) + descărcare + 3 randări: 439 s.
- Re-randare clip după „Aplică”: ~30 s (plus ~40 s Whisper la primul „Aplică” pe proiecte vechi).
- Video de 6 h (stream): descărcare 6,7 GB în ~5 min; transcriere completă estimată la ~166 min.
- AI (`qwen2.5:7b`, CPU): ~60 s/candidat. TED 14 min: 464 s total. Stream GTA 6 h, din subtitrări existente: 939 s total (analiză volum + 10 candidați + clasare + 3 randări).
- Analiza volumului pe 6 h: 47 s. Vârfuri mari care ajung la AI pe GTA: 1/12 → 6/12 cu preselecția după sunet.

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
- Preselecția doar după vorbire ratează reacțiile de gaming (țipete, râsete au puțină vorbire): de-asta jumătate din candidați vin din vârfurile de volum. Analiza volumului: ffmpeg `astats` pe secundă, ~47 s pentru 6 h.
- Modelul `qwen2.5:7b`: notat separat dă aceeași notă (7/10) tuturor candidaților → runda de clasare comparativă decide; ignoră cererea de lungime → lărgire în cod; amestecă limbile dacă nu i le spui explicit. Testele de server folosesc mereu un Ollama fals (`CLIPTREI_OLLAMA_URL`): nu apelează niciodată modelul real.
- Browserul ținea `ui.css` vechi în cache. Fișierele aplicației se servesc acum cu `Cache-Control: no-cache`.

## Unde am rămas (2026-11-23)
Totul e în `main`, fără PR-uri deschise (PR #1–#8): Whisper + „Taie pauzele”, editor per clip, „Reia”, un singur video odată, protecție cereri, teste end-to-end, „LOCUL n DIN 3”, **alegerea momentelor cu AI** (#7) și **preselecția după sunet** (#8: 5 candidați după vorbire + 5 în jurul vârfurilor de volum, cu indiciu în prompt). 144 de teste.

Primul test real pe stream (GTA 6 h, proiect `data/eafb540b…`, video legat prin hardlink din `data/29520ba6…`, deci fără 6,7 GB în plus): **locurile 1 și 2 alese de AI vin din vârfurile de sunet** (5:35:59 „Never Getting the Good Ending”, 5:54:03 „It Worked! Then Faked It”), locul 3 din vorbire. Enea încă n-a verificat dacă momentele sunt bune.

### Următoarele sarcini (cerute de Enea pe 2026-11-23, în ordinea asta, fiecare pe branch-ul ei)
1. ~~Actualizarea documentației~~ (făcută la salvarea contextului).
2. **Limită totală de timp pentru etapa AI** (~12 min). Ce nu apucă AI-ul se completează din reguli; estimarea se afișează la pornire, ca la Whisper. Acum, în cel mai rău caz, etapa depășește 30 min și blochează singurul job greu.
3. **Descărcarea doar a bucăților necesare.** Întâi doar audio (+ subtitrări), suficient pentru transcriere, analiza volumului și AI; apoi doar cele 3 segmente video (yt-dlp `--download-sections`), plus fereastra pentru „Aplică”. Pe stream-ul de 6 h: 6,7 GB → câteva sute de MB. De gândit: cum se comportă „Aplică”/zoom și „Alege din nou cu AI”, care acum refolosesc `source.mp4`.

### După aceea (propuse, neprioritizate)
- Clasarea AI să vadă tot textul clipului, nu doar titlul + primele 40 de cuvinte.
- Tipul videoului (stream/podcast) stabilit o singură dată, nu pe fiecare candidat.
- Verificare ieftină a limbii titlului (2/9 greșite pe TED) și a românei din motive.
- Mutarea încadrării stânga/dreapta (pan), pentru camera din colț la streamuri.
- Videouri de pe TikTok/Instagram (yt-dlp le suportă deja).
- Probleme mici amânate: în `.superpowers/sdd/*/progress.md` (rânduri „minor (deferred)”).
