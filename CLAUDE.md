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
- `whisper.js` + `transcribe.py`: transcrierea locală. `projects.js`: `project.json`, lista de proiecte, blocările, alegerea gameplay-ului. `http-utils.js`: servire statică sigură.
- `app.js`, `index.html`, `ui.css`, `styles.css`: interfața. `test/`: testele (67).
- `docs/superpowers/specs|plans/`: designuri și planuri. `docs/jurnal.md`: istoricul sesiunilor.
- Ignorate: `data/` (proiecte și videouri, pot avea GB), `satisfying/`, `.superpowers/` (jurnale de execuție și copii ale fișierelor vechi), `.playwright-mcp/`.

## Cifre de referință (măsurate pe laptopul lui Enea)
- Whisper `small` int8 pe CPU: clip de 34 s → 25,3 s (cu încărcarea modelului); 180 s audio → 76,6 s (factor 0,425; în cod `FACTOR = 0.45`).
- Taie pauzele pe TED (vorbire densă): 34 s → 31,3 s; tăceri > 0,5 s: 2 → 0.
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
- Browserul ținea `ui.css` vechi în cache. Fișierele aplicației se servesc acum cu `Cache-Control: no-cache`.

## Unde am rămas
Funcționalitatea Whisper + tăierea pauzelor: Task-urile 0–4 și 6 sunt făcute, cu commit. **Task 5** (`/api/inspect` și transcrierea completă) e scris în `server.js`, dar **nu are încă commit**: testul real cu `transcribe: true` pe TED rula la salvare (folderul `data/4cdad1aa-…`). Urmează: verifici rezultatul, faci commit pentru Task 5, verificarea finală cu un reviewer, apoi `git push -u origin main`. Planul e în `docs/superpowers/plans/2026-11-22-whisper-pauses.md`, iar progresul în `.superpowers/sdd/2026-11-22-whisper-pauses/progress.md`.
