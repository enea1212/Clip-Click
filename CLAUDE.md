# ClipClick

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
- 2026-11-23 — **Plafon de 12 min pentru etapa AI** (A): termen-limită pe toată etapa, 1/6 păstrat pentru clasare; candidații se întreabă alternat vorbire/sunet, ca o tăiere să păstreze amestecul; ce nu apucă AI-ul → reguli, cu nota „AI-ul a avut timp pentru X din 10 momente”. Răspunsurile din cache nu consumă din plafon. Teste: `CLIPTREI_AI_BUDGET_MS`.
- 2026-11-23 — **Povești animate din scenariu** (issue #18, design `docs/superpowers/specs/2026-11-23-povesti-animate-design.md`): povești scurte pentru TikTok, EN principal + RO. Decoruri fixe cu mișcare de cameră (nu mișcare 3D reală), generate local cu SD-Turbo pe Iris Xe (OpenVINO), înlocuibile. Personaje 2D desenate de cod. Voci gata făcute (Kokoro EN, Piper RO); **fără imitarea vocii unor persoane reale**; clonarea vocii amânată (licențe necomerciale). AI-ul nu rescrie textul lui Enea.
- 2026-11-24 — **Decorurile: SDXL-Turbo** (OpenVINO int8, `models/sdxl-turbo-ov`, ~4,5 GB) în loc de SD-Turbo, ales de Enea dintr-un test pe 4 decoruri (acum / SD-Turbo cu stil nou / DreamShaper LCM / SDXL-Turbo): coerent, cald, fără obiecte dublate. Stil comun „Pixar style 3D animated movie background…”. Aceeași licență Stability AI Community. `models/sd-turbo-ov` nu se mai folosește.
- 2026-11-27 — **Rămânem la SDXL-Turbo; Z-Image Turbo respins** (Enea, după un îndrumar „Open Generative AI” de pe Instagram). Z-Image Turbo are licență Apache 2.0 și o conversie OpenVINO INT4 (`HelloSun/Z-Image-Turbo-OpenVINO-INT4`, 5,5 GB, aceleași versiuni ca `studio/venv`), dar folosește **16,3 GB RAM** la generare și durează 116 s/imagine 1024² chiar pe un Xeon cu 96 de nuclee → nefolosibil pe 16 GB. Open Generative AI e mai ales cloud plătit (MuAPI); Wan2GP (video AI) cere NVIDIA/AMD, nu merge pe Iris Xe. De reluat doar pe o mașină cu ≥ 32 GB RAM sau NVIDIA.
- 2026-11-23 — **Preselecția AI: 5 după vorbire + 5 după vârfurile de sunet (A)**: pe GTA, regulile după vorbire ratau 11 din 12 reacții puternice.
- Git: repo `enea1212/Clip-Click` (public), branch `main`. **Din 2026-11-23 lucrăm în doi: regulile sunt în `CONTRIBUTING.md`.** Pe scurt: fiecare sarcină e un issue cu responsabil, un branch pe sarcină, nimic direct pe `main`, PR cu `node --test` verde și review de la celălalt înainte de merge. Deciziile noi se scriu aici cu data și cine le-a luat.
- Conversația cu Claude se ține în română.

## Mediu de lucru
- Windows 11, laptop i5-1235U (12 fire), 16 GB RAM, Intel Iris Xe, **fără NVIDIA**: Whisper rulează pe CPU.
- Node 24, Python 3.12 (`yt-dlp`, `faster-whisper` 1.2.1 + modelul `small`, int8), ffmpeg 2026 (în PATH).
- Pornire: `node server.js` → http://localhost:4173. Teste: `node --test` (fără argument de folder: `node --test test/` nu merge pe Node 24/Windows).
- Instalare Whisper: `python -m pip install --user faster-whisper`.
- Povești animate: `python studio/setup.py` (o dată, ~10 min): creează `studio/venv` (1,5 GB) și `models/` (5,2 GB: SD-Turbo convertit la OpenVINO, Kokoro, Piper RO). Teste Python: `studio/venv/Scripts/python -m unittest discover -s studio/tests`. Un video: `node story.js <folder cu story.json> [--preview]`; exemplu în `docs/examples/speed-camera/`.

## Structura repo-ului
- `server.js`: HTTP și API (`/api/inspect`, `/api/process`, `/api/projects[/<id>]`, `/api/satisfying`, `/api/render`), job-uri ffmpeg/yt-dlp/Whisper, blocări per clip.
- `subtitles.js`: VTT → cuvinte, grupare, fișier `.ass` karaoke. `clips.js`: alegerea celor 3 momente. `pauses.js`: segmente de vorbire și mutarea cuvintelor pe cronologia tăiată.
- `layout.js`: formula de zoom și graful de filtre ffmpeg; e folosit și în browser, pentru previzualizare. `render.js`: argumentele pentru ffmpeg/ffprobe.
- `whisper.js` + `transcribe.py`: transcrierea locală (videourile lungi pe bucăți de 10 min). `proc.js`: rularea proceselor externe (decodare UTF-8 corectă). `projects.js`: `project.json`, lista de proiecte, blocările, alegerea gameplay-ului. `http-utils.js`: servire statică sigură.
- `app.js`, `index.html`, `ui.css`, `styles.css`: interfața. `pipeline.js`: etapele procesării și reluarea. `ai.js`: alegerea momentelor cu Ollama (linii, prompt, validare, clasare, rezervă). `loudness.js`: volum pe secundă, vârfuri, amestec de candidați. `test/`: testele (154, inclusiv `server.test.js` end-to-end). `testing/fake-tools.js`: unelte false pentru teste.
- `story.js` (orchestrare poveste: decoruri → voce → timpi → subtitrări → randare) și `studio.js` (format `story.json`, căi, apelurile către `studio/`). `storyboard.js`: textul → propoziții, promptul AI pentru scene (cu exemplu), validare/reparare, reguli de rezervă. `stories.js`: API-ul `/api/stories…` (creare, editare scenă, regenerare/încărcare decor, previzualizare, randare). `image-worker.js`: ține `imagegen.py --serve` pornit 10 min. `story-ui.js`: ecranul „Poveste nouă” și editorul storyboard (2B). `studio/`: Python separat — `imagegen.py` (SD-Turbo/OpenVINO), `tts.py` (Kokoro; Piper ca proces separat, e GPL), `render_story.py` + `scene.py`, `characters.py`, `overlays.py` (cadre Pillow → ffmpeg), `setup.py`, `tests/`.
- `CONTRIBUTING.md`: regulile de lucru în doi (issue-uri, branch-uri, PR-uri, review, documentație).
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
- Descărcare parțială, TED 14 min (reguli, fără AI): 293 s total; audio 13 MB + 3 segmente ~30 MB, proiect 71 MB. Segmentele sunt sincronizate cu audio-ul la 1 ms (corelație), A/V pornesc amândouă de la 0.
- **Poveste din aplicație (2026-11-24), 12 rânduri de text, AI real:** scenele 235–253 s (qwen2.5:7b, CPU), decoruri ~21 s fiecare; regenerare decor 45 s prima dată (încărcare model), apoi ~22 s; previzualizare 540×960 60 s; video final 45 s.
- Poveste exemplu (12 scene, 6 decoruri, 38 s): **189 s total** fără mărire — decoruri 103 s (încărcare model ~40 s + ~11,3 s/imagine 576×1024 pe Iris Xe), voce Kokoro 29 s, Whisper 15 s, randare 42 s (~timp real la 1080×1920@30). **Cu Real-ESRGAN (2026-11-24): ~20,7 s/decor** (mărirea pe procesor adaugă ~9 s), decoruri 180 s → o poveste nouă ~4,5 min. **Cu SDXL-Turbo (2026-11-24): ~28 s/decor** cu mărire (încărcare ~35–55 s); 6 decoruri în 201 s. Pe procesor imaginile ar dura ~45 s fiecare; pe Iris Xe prin OpenVINO, de ~6× mai repede.

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
- `AbortSignal.timeout` acceptă doar milisecunde întregi: o fracție (ex. buget/6) aruncă eroare la fiecare întrebare, iar AI-ul pare „căzut”. `timeLeft` rotunjește în jos.
- Browserul ținea `ui.css` vechi în cache. Fișierele aplicației se servesc acum cu `Cache-Control: no-cache`.
- **optimum-intel** retrogradează `huggingface-hub` și strică `diffusers` dacă sunt în același mediu cu versiuni nepotrivite: de-asta `studio/requirements.txt` are versiuni fixate și mediu propriu.
- **SD-Turbo + OpenVINO `reshape`:** biblioteca dublează mereu lotul UNet (presupune guidance), iar SD-Turbo rulează fără → eroare de formă la generare. `imagegen.py` recitește UNet-ul de pe disc și îi dă lotul 1. Fără dimensiune fixă, prima imagine pe placă durează ~60 s.
- **Piper nu scoate niciun sunet** dacă textul conține „ ” (eroare `wave`). `tts.py` scoate ghilimelele tipografice doar din textul trimis vocii.
- **qwen2.5:7b la storyboard** fără exemplu în prompt a dat 1 decor și cameră „static” pentru toate cele 15 scene. Cu un exemplu JSON complet în prompt: 4 decoruri, camere variate, un personaj inventat. Codul transformă oricum „static” în mișcare (rotație). Personajele și graficele rămân rare: se completează din editor.
- **Storyboard fără niciun personaj** (2026-11-27, „The Coffee Shop Trick”): uneori AI-ul nu inventează pe nimeni → codul pune un personaj principal după primul rol din text (owner, șofer…; altfel „HERO”; păr lung dacă textul zice „she/ea”). Tot atunci, decorurile ieșeau pline de clienți: filtrul de oameni nu știa „customer”, iar „busy” aducea mulțimi. Acum „busy/crowded” → „quiet”, iar un decor al cărui subiect e o persoană sau care nu numește un loc („post online”) e scos, iar scenele lui păstrează decorul anterior. `\b` din regex nu vede literele românești: pentru cuvinte RO se folosește `\p{L}` cu flagul `u`.
- `resolveStatic` servea mereu din `<root>/data`, ignorând `CLIPTREI_DATA_DIR`: acum primește folderul de date (altfel miniaturile/videourile nu se văd pe un server de test).
- OpenVINO pe procesor (fp32) nu e mai rapid decât PyTorch; câștigul vine doar de pe placa Iris Xe (`GPU`).
- **SDXL-Turbo pe Iris Xe:** VAE-ul în f16 dă imagini **negre** (depășire numerică); tot modelul în f32 merge, dar ~36 s/imagine. Soluția: doar `vae_decoder` în f32, UNet în f16 + dimensiuni fixe → ~16 s/imagine (+~9 s Real-ESRGAN). Cache-ul de compilare OpenVINO (`unet/model_cache`) poate ajunge la ~8 GB; se poate șterge, se refac.
- **Decoruri pixelate** (observat de Enea 2026-11-24): 576×1024 mărit ~2,2× (+ zoom) arată neclar lângă personajele desenate la rezoluție finală. Rezolvat cu Real-ESRGAN `realesr-general-x4v3` (BSD-3, 5 MB, `studio/upscale.py`) pe procesor; **pe Iris Xe prin OpenVINO dă o imagine greșită** (și în fp32), deci nu se mută pe placă.

## Unde am rămas (2026-11-24, seara)
În `main` (PR #1–#24): Shorts din YouTube (Whisper + „Taie pauzele”, editor per clip, „Reia”, AI pentru momente cu preselecție după sunet și plafon de 12 min, descărcare parțială, interfața ClipClick) și **povești animate din aplicație** (#19 motorul, #20 scene cu AI + editor storyboard 2B, #22 decoruri SDXL-Turbo, #24 decor nou/alt decor din editor, personaje distincte, AI mai bun la planificare). Reguli de lucru în doi în `CONTRIBUTING.md` (#17). 210 teste Node + 15 Python.

**Deschis: PR pe `feature/povesti-grafice-upload` (#25):** graficele se potrivesc cu textul (bani doar la bani, cifre/procente → badge, „sixty-six percent more” → „+66%”, badge fără cifre → panou) și Real-ESRGAN pentru imaginile încărcate (400×712 → 1260×2243 în 6 s). Testate cu teste automate și pe un fișier real; neverificat încă pe o poveste nouă cu AI-ul real.

Test „The Piano Stairs” (poveste nouă prin aplicație): înainte de #24 — 3 decoruri, 4/14 scene cu personaje, personaje identice ca aspect; după — 5 decoruri (inclusiv scările-pian), 14/14 scene cu personaje, personaje distincte. Creare ~7 min (435 s), decor nou 62 s (prima dată), video final ~100 s. Proiectele de test sunt în `data/` (b8df4e7c…, 8f512c12…).

Rămas la povești: descrierea unui decor poate ieși ciudată după scoaterea oamenilor („down the stairs, having fun”); UI-ul n-are teste automate; muzică de fundal și clonarea vocii (licențe) — amânate. **Decizie deschisă a lui Enea:** înregistrarea gratuită la Stability AI dacă monetizează pe TikTok (licența SDXL-Turbo).

Primul test real pe stream (GTA 6 h, proiect `data/eafb540b…`, video legat prin hardlink din `data/29520ba6…`, deci fără 6,7 GB în plus): **locurile 1 și 2 alese de AI vin din vârfurile de sunet** (5:35:59 „Never Getting the Good Ending”, 5:54:03 „It Worked! Then Faked It”), locul 3 din vorbire. Enea încă n-a verificat dacă momentele sunt bune.

Descărcarea parțială (#12): proiectele noi au `mediaMode: "segments"`: audio comprimat (`source.webm`) + subtitrări, apoi cele trei segmente video (`segment-N.mp4`, câte 5 s rezervă). „Aplică” folosește segmentul; „Alege din nou cu AI” refolosește audio-ul și descarcă segmentele noi (are nevoie de internet). Proiectele vechi cu `source.mp4` merg ca înainte.

### Sarcini pentru prieten (issue-uri pe GitHub, 2026-11-23; **încă neasignate**: lipsește username-ul GitHub al prietenului, iar mesajul de prezentare e gata de trimis)
Ordinea recomandată, de la cea mai mică la cea mai mare: #13 → #14 → #15 → #16.
- #13 Clasarea AI să vadă tot textul clipului, nu doar primele 40 de cuvinte.
- #14 Tipul videoului (stream/podcast/other) stabilit o singură dată pe video.
- #15 Verificare ieftină a limbii titlului (2/9 greșite pe TED) și a românei din motiv.
- #16 Pan stânga/dreapta în editorul de clip (camera din colț la streamuri).

De verificat de Enea: momentele AI de pe GTA (încă neverificate) și descărcarea parțială pe un stream lung.

### După aceea (propuse, neprioritizate)
- Videouri de pe TikTok/Instagram (yt-dlp le suportă deja).
- Probleme mici amânate: în `.superpowers/sdd/*/progress.md` (rânduri „minor (deferred)”). Folderul e ignorat de git, deci există doar pe laptopul lui Enea; ce merită făcut se mută în issue-uri.
