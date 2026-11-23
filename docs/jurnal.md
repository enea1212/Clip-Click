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
