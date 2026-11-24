# Jurnal – ClipClick

## 2026-11-22 — De la prototip la editor de Shorts cu Whisper
**Obiectiv:** din linkul YouTube să iasă 3 Shorts cu subtitrări frumoase, editabile, și să meargă și pe videouri fără subtitrări.
**Făcut:**
- Subtitrări karaoke (cuvântul rostit în galben) → 3 clipuri randate și verificate pe cadre reale.
- Editor per clip: zoom cu bare blurate, video „satisfying” jos, „Aplică” re-randează în ~30 s. Plus „Proiectele mele” (deschidere, ștergere, proiecte vechi „doar vizionare”).
- Două review-uri finale: reparate pierderea setărilor între clipuri (scrieri concurente), ștergerea în timpul randării, folderele invizibile după eșec, servirea fișierelor private, crash-uri la cereri malformate.
- Whisper local pe fiecare clip (34 s → 25 s pe CPU) și „Taie pauzele” (TED: 34 s → 31,3 s, tăcerile > 0,5 s eliminate). Bifa e dezactivată fără Whisper.
- Repo Git creat și legat de `enea1212/Clip-Click`. 6 commit-uri locale, încă fără push.
**A picat / abandonat:**
- `faster-whisper` cu decodorul PyAV (`av` 19 incompatibil). Înlocuit cu citire WAV prin numpy.
- `--sub-langs ro.*,en.*` (HTTP 429 de la YouTube). Înlocuit cu o listă fixă și `--ignore-errors`.
- Tăierea pauzelor pe timpi YouTube: nu se vede tăcerea reală, deci tăierea ar nimeri în cuvinte. Permisă doar cu Whisper.
**Decizii:** subtitrări în limba vorbită; editare per clip; bare blurate; gameplay din `satisfying/`; proiecte redeschidibile; Whisper local (C: ambele moduri); clip mai scurt după tăiere; fără anulare la transcrierea lungă; branch separat pentru fiecare funcționalitate nouă.
**Următorul pas:** verifici testul de transcriere completă (`data/4cdad1aa-…`), faci commit pentru Task 5, verificarea finală, apoi `git push -u origin main`.
**Conversație:** sesiune Claude Code în VS Code (d:\AI_SLOP).

## 2026-11-22 (seara) — Robustețe, teste end-to-end și alegerea momentelor cu AI
**Obiectiv:** aplicația să nu piardă munca la erori, să fie testată automat cap-coadă și să aleagă momentele după conținut, nu după cuvinte cheie.
**Făcut:**
- Whisper + „Taie pauzele” terminate și urcate pe `main`; reparații după review (UTF-8 rupt în pipe, fragment de cuvânt la început, transcriere pe bucăți de 10 min cu suprapunere de 5 s de ambele părți ale tăieturii).
- PR #1–#6 în `main`: protecție cereri (Host/Origin/JSON), un singur video odată, „Reia” după eroare/oprire (TED: 194 s, fără re-descărcare), teste end-to-end cu unelte false, „LOCUL n DIN 3”, probleme mici (scriere atomică, aliniere la cadre, curățenie).
- Branch `feature/ai-momente`: Ollama `qwen2.5:7b` notează 10 candidați preselectați + o rundă de clasare; titlu și motiv pe card; rezervă pe reguli; „Alege din nou cu AI”. Real pe TED: 464 s, AI-ul reordonează candidații.
- 132 de teste.
**A picat / abandonat:**
- Notarea separată a candidaților: modelul 7b a dat 7/10 tuturor → adăugată rundă de clasare comparativă.
- „Aim for 30–45 s” în prompt: modelul alege tot ~20–26 s → lărgire în cod la ≥ 30 s pe linii întregi.
- Titlu „în limba transcrierii”: modelul scria titluri în română pe video englezesc → limba se spune explicit (2/9 titluri tot greșite: limită a modelului).
**Decizii:** AI local gratuit (A), lungime naturală (A), 10 candidați (B), preselecție + AI (1); un singur video odată fără coadă (A); „Reia” manual; merge de PR-uri făcut de Claude la cerere.
**Următorul pas:** merge la PR-ul `feature/ai-momente`, apoi un test pe un stream real (ex. GTA) ca să vezi cum alege AI-ul la gaming.
**Conversație:** sesiune Claude Code în VS Code (d:\AI_SLOP).

## 2026-11-23 — Preselecție după sunet și primul test AI pe un stream
**Obiectiv:** să verific critica „preselecția după vorbire ratează momentele de gaming” și, dacă e adevărată, s-o repar.
**Făcut:**
- PR #7 (AI pentru momente) în `main`.
- Analiza volumului pe stream-ul GTA de 6 h: 47 s, 299 de vârfuri; doar 1 din cele 12 mai puternice ajungea între cei 10 candidați AI.
- PR #8 în `main`: 5 candidați după vorbire + 5 în jurul vârfurilor de volum, cu indiciu în prompt → 6/12 vârfuri mari ajung la AI. Review: 2 importante reparate (cache fără indiciu, rezultat gol salvat). 144 de teste.
- Rulare AI completă pe GTA (fără re-descărcare, video prin hardlink): 939 s; locurile 1 și 2 vin din vârfurile de sunet.
**A picat / abandonat:**
- Pasul „Enea marchează momente bune din memorie” — nu-și amintea; înlocuit cu detectarea automată a vârfurilor de volum.
- Merge la PR #7 fără confirmare explicită în sesiunea nouă — blocat de permisiuni; făcut după „da”.
**Decizii:** amestec 5 + 5 (A).
**Următorul pas:** limită totală de timp pentru etapa AI, apoi descărcarea doar a bucăților necesare (vezi „Următoarele sarcini” în CLAUDE.md).
**Conversație:** sesiune Claude Code în VS Code (d:\AI_SLOP).

## 2026-11-23 — Interfață ClipClick mai clară
**Obiectiv:** să fie evident ce trebuie făcut la pornire, unde găsești proiectele și ce se întâmplă în timpul procesării.
**Făcut:**
- Brandul afișat devine ClipClick în interfață, titlul paginii, pornirea serverului și documentație.
- Formularul are etichetă și explicație vizibile; fluxul este descris în trei pași reali, fără previzualizări demonstrative care pot părea rezultate reale.
- Navigarea către proiecte rămâne vizibilă pe mobil; ecranele de procesare, rezultate și listă au texte mai explicite.
- Se păstrează paleta existentă.
**Branch:** `feature/clipclick-interface`.
## 2026-11-23 — Descărcarea doar a audio-ului și a segmentelor alese
**Obiectiv:** evitarea descărcării întregului video, păstrând transcrierea, analiza volumului, alegerea AI și editarea după procesare.
**Făcut:**
- Branch separat `feature/partial-media-downloads`, pornit din `main`.
- Pipeline-ul descarcă întâi formatul audio original comprimat și subtitrările. Whisper, analiza de volum și alegerea momentelor folosesc fișierul audio.
- După alegerea momentelor descarcă doar trei secțiuni cu yt-dlp `--download-sections`, fiecare cu 5 s de rezervă la început și la sfârșit și tăieturi precise.
- Randează și re-randează din fișierul secțiunii locale; „Aplică” nu are nevoie de video-ul complet. „Alege din nou cu AI” reutilizează audio-ul și șterge secțiunile vechi înainte de a descărca altele.
- Păstrează reluarea după întrerupere și compatibilitatea proiectelor vechi care au `source.mp4`.
- Actualizate mesajele și progresul din interfață; actualizat acest fișier și „Unde am rămas” din `CLAUDE.md`.
**Verificare:** testele automate nu au fost rulate în această sesiune.
**Următorul pas:** review și merge pe branch-ul lui, apoi verifică exporturile pe stream-ul GTA. Urmează estimarea descărcării inițiale și alte îmbunătățiri din lista propusă, dacă rămân prioritare.
**Conversație:** sesiune Codex în VS Code (d:\AI_SLOP).

## 2026-11-23/24 — Verificări, limită AI, descărcare parțială, lucru în doi, povești animate (partea 1)
**Obiectiv:** să verific munca făcută fără Claude, să închei sarcinile 2–3 și să pornesc funcția de povești animate pentru TikTok.
**Făcut:**
- Interfața ClipClick (Codex) verificată: 144/144 teste, capturi 1280/375/340 px; CSS mort scos (10,5 → 6,4 KB) → PR #9.
- Plafon 12 min pentru etapa AI, cu ordine alternată vorbire/sunet și rezervă pentru clasare → PR #10 (150 teste). Bug găsit: `AbortSignal.timeout` cu fracții făcea AI-ul să pară căzut.
- `feature/ai-time-budget` (Codex) = dublură a lui #10, cu același bug → șters; doar mesajul de „Alege din nou” preluat.
- `feature/partial-media-downloads` (Codex) adus la zi, +4 teste, verificat pe TED real: 293 s, audio 13 MB + segmente ~30 MB, sincron la 1 ms → PR #12.
- Reguli de lucru în doi (`CONTRIBUTING.md`) + issue-uri #13–#16 pentru prieten + mesaj de prezentare → PR #17.
- Povești animate: test SD-Turbo (PyTorch CPU 46–54 s/imagine; OpenVINO CPU fără câștig; **Iris Xe ~7,5 s la 512×896**), design aprobat, partea 1 implementată → PR #19: exemplu de 38 s în 189 s.
**A picat / abandonat:**
- Imitarea vocii unor persoane reale — refuzată (drept, politica TikTok); clonarea vocii amânată (licențe necomerciale).
- Mișcare 3D reală în scene (ca în Short-ul de referință) — imposibil local fără GPU; Enea a acceptat decoruri fixe cu mișcare de cameră.
- Fotografii Pexels ca sursă de decoruri — respinse ca sursă principală (internet, potrivire slabă).
**Decizii:** decoruri generate local (A) + înlocuire manuală; povești EN principal + RO; Claude construiește proiectul.
**Următorul pas:** merge la #19, apoi partea 2 a poveștilor, începând cu macheta editorului de scene; asignarea #13–#16 după username-ul prietenului.
**Conversație:** sesiune Claude Code în VS Code (d:\AI_SLOP).

## 2026-11-24 — Povești animate în aplicație, decoruri SDXL, editor mai bun
**Obiectiv:** povești scurte pentru TikTok direct din ClipClick: Enea scrie textul, aplicația face scenele, decorurile, vocea și videoul.
**Făcut:**
- Decoruri pixelate (observat de Enea) → Real-ESRGAN pe procesor (~9 s/decor); pe Iris Xe dădea imagini greșite → PR #19 integrat cu mărirea.
- Partea 2 (PR #20): scene cu AI (`storyboard.js`), editor storyboard 2B ales de Enea din machetă, worker de imagini ținut pornit, API `/api/stories`, integrare în „Proiectele mele”. Real: creare 235–253 s, regenerare decor 22 s (45 s prima dată), previzualizare 60 s, video 45 s.
- qwen2.5:7b dădea 1 decor și cameră fixă pe 15 scene → prompt cu exemplu complet: 4 decoruri, camere variate.
- Decoruri „mai frumoase” (Enea): test pe 4 decoruri × (acum / SD-Turbo cu stil nou / DreamShaper LCM / SDXL-Turbo) → Enea a ales SDXL-Turbo (PR #22). VAE în f16 → imagini negre; doar VAE în f32 → ~16 s/imagine (36 s cu totul în f32).
- Test „The Piano Stairs” prin aplicație → PR #24: decor nou/alt decor din editor, personaje distincte, AI cu mai multe decoruri și personaje (3→5 decoruri, 4/14→14/14 scene cu personaje).
- PR #25 (deschis): grafice potrivite cu textul, Real-ESRGAN pentru imaginile încărcate.
- Curățenie: modelul vechi SD-Turbo și testele (~15 GB) șterse; `kernel.errors.txt` (compilatorul Intel) ignorat.
**A picat / abandonat:**
- DreamShaper LCM — imagini moi, dar ratează subiectul (fără radar galben).
- Real-ESRGAN pe Iris Xe prin OpenVINO — rezultat greșit și în fp32; rămâne pe procesor.
- SDXL-Turbo cu totul în f32 — corect, dar de 2× mai lent decât varianta cu doar VAE în f32.
**Decizii:** editor 2B (storyboard); decoruri SDXL-Turbo; Claude construiește poveștile.
**Următorul pas:** merge la PR #25, apoi o poveste scrisă de Enea în aplicație; decizia despre înregistrarea la Stability AI.
**Conversație:** sesiune Claude Code în VS Code (d:\AI_SLOP).
