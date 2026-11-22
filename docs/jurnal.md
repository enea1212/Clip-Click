# Jurnal – ClipTrei

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
