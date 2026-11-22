# Transcriere cu Whisper și tăierea pauzelor — design

Data: 2026-11-22 · Dimensiune: proiect · Depinde de: karaoke (`2026-11-22-karaoke-subtitles-design.md`) și editorul per clip (`2026-11-22-clip-editor-design.md`), ambele implementate.

## De ce
1. Videourile fără subtitrări YouTube dau acum eroare („Nu am găsit subtitrări”). Utilizatorul vrea să meargă și ele.
2. Pe subtitrările scrise de mână (fără timp pe cuvânt) cuvântul galben e aproximativ. Whisper dă timpi exacți pe cuvânt.
3. Tăcerile din clip scad ritmul; utilizatorul vrea clipuri mai alerte, chiar dacă devin mai scurte.

## Decizii luate de utilizator
- **Whisper în ambele cazuri (C):** (a) mereu pe cele 3 clipuri alese, ca să refacă timpii cuvintelor; (b) pe tot videoul, ca rezervă, când nu există subtitrări.
- **Pauzele tăiate scurtează clipul** (34 s → ex. 27 s); nu se completează la loc.
- **Implementare:** `faster-whisper` local, în Python, apelat de server (nu whisper.cpp, nu API plătit).
- **Fără buton de anulare (A):** transcrierea lungă rulează ca o cerere obișnuită; dacă pagina se închide, serverul termină oricum și proiectul apare în „Proiectele mele”. Pentru oprire, utilizatorul oprește serverul.
- **Subtitrările sunt în limba vorbită** (decizie anterioară „lasă în engleză”, confirmată la verificarea designului): Whisper autodetectează limba; traducerile automate YouTube nu se folosesc ca text.

## Context hardware
Laptop i5-1235U (12 fire), 16 GB RAM, placă Intel Iris Xe — fără NVIDIA, deci Whisper rulează pe procesor. Un clip de 34 s: secunde; o oră de video: zeci de minute; 6 ore: ore.

## Obiective
- Videouri fără subtitrări RO/EN se procesează (cu avertisment de durată înainte).
- Cuvântul galben e sincron cu vorbirea pe toate clipurile, indiferent de sursa subtitrărilor.
- Bifă **„Taie pauzele”** în editorul fiecărui clip; clipul randat nu mai are tăceri lungi, iar subtitrările rămân sincrone.

## Non-obiective
- Dublaj, traducere, voce AI.
- Bară de progres reală, anulare sau reluare pentru transcrierea lungă (se arată doar o estimare; decis A).
- Alegerea modelului Whisper din interfață.
- Previzualizare live a tăierii pauzelor în editor (vezi mai jos).
- Suport pentru GPU.

## Anti-obiective
- Procesare care pornește o transcriere de ore fără ca utilizatorul să fi fost avertizat.
- Subtitrări desincronizate după tăierea pauzelor.
- Cuvinte tăiate la jumătate (tăietura prea agresivă).
- Ca o eroare Whisper pe un clip să strice procesarea, când există subtitrări YouTube (se revine la ele).

## Abordări luate în calcul
1. **ALEASĂ — `faster-whisper` (Python, CTranslate2, int8 pe CPU) apelat de server ca proces separat.** Python există deja (yt-dlp). Local, gratuit.
2. `whisper.cpp` (exe separat). Fără Python, dar încă un binar de întreținut, nu mai rapid pe acest CPU.
3. Whisper prin API OpenAI. Rapid, dar plătit per minut și trimite audio în afara calculatorului.

## Design

### Instalare
- `python -m pip install --user faster-whisper` (de adăugat în README).
- Model **`small`** (~500 MB, multilingv, bun pe română), descărcat automat la prima folosire în cache-ul implicit. *(propunerea mea: compromis viteză/calitate pe CPU; `medium` ar fi de ~3× mai lent)*
- `compute_type="int8"`, `device="cpu"`, `vad_filter=True`, `word_timestamps=True`.
- Dacă `faster-whisper` lipsește: procesarea videourilor **cu** subtitrări merge mai departe ca acum (fără rafinare, cu un avertisment în consolă); cele **fără** subtitrări dau mesaj clar: „Instalează faster-whisper: python -m pip install --user faster-whisper”.

### Script `transcribe.py`
- Intrare: un fișier audio (WAV 16 kHz mono extras de ffmpeg), opțional `--language ro|en|…` (altfel autodetectare).
- Ieșire: JSON pe stdout: `{ "language": "en", "words": [{ "word", "start", "end" }] }`, timpi în secunde relativ la fișier.
- Cuvintele trec prin aceeași curățare ca acum (fără tokeni fără litere/cifre).

### (a) Rafinare pe clipuri — mereu
- După alegerea celor 3 momente (din subtitrările YouTube, ca acum): pentru fiecare clip se extrage audio `[start, end]` și se transcrie; timpii se decalează cu `start`.
- Limba: **autodetectare** pe fiecare clip (nu limba pistei YouTube, care poate fi o traducere automată — ex. `ro` tradus pe un video în engleză). *(decizia mea, din verificarea designului)*
- Rezultatul se salvează per clip în `words-N.json` și se folosește pentru subtitrări și pauze. Textul vine tot de la Whisper (de obicei identic cu subtitrările automate; mai precis decât traducerile).
- Eroare Whisper pe un clip → se folosesc cuvintele din `words.json` (YouTube) pentru clipul acela; avertisment în consolă.

### (b) Rezervă pentru videouri fără subtitrări
- **Verificare înainte de descărcare:** endpoint nou `POST /api/inspect { url }` → `{ title, duration, hasSubtitles, estimateMinutes }`, din metadatele yt-dlp (fără descărcare). `hasSubtitles` = există o pistă RO/EN **în limba originală** a videoului: subtitrare manuală RO/EN, sau pista automată originală (`ro-orig`/`en-orig`, ori `automatic_captions` RO/EN când limba videoului din metadate e `ro`/`en`). Traducerile automate YouTube **nu** contează. *(decizia mea, din verificarea designului: un video în germană doar cu traducere automată în engleză merge pe Whisper și primește subtitrări în germană)*
- Alegerea momentelor pentru videourile cu subtitrări folosește aceeași regulă: se preferă pistele în limba originală (cele cu timp pe cuvânt, cum face deja `pickCaptionTrack`).
- Dacă `hasSubtitles` e fals, interfața întreabă: „Videoul nu are subtitrări. Transcrierea pe calculatorul tău durează cam X minute. Continui?” → la „Da”, `POST /api/process { url, transcribe: true }`.
- Server: descarcă, extrage audio-ul întreg, transcrie tot (autodetectare limbă), salvează `words.json`, apoi exact fluxul de acum (alegere momente → rafinarea (a) nu mai e necesară, cuvintele sunt deja de la Whisper; `words-N.json` = felia din `words.json`).
- `estimateMinutes` = durata × factor măsurat la implementare pe acest calculator (constantă în cod). Mesajul de încărcare din interfață repetă estimarea.
- `/api/process` fără `transcribe: true` pe un video fără subtitrări → eroarea de acum (protecție împotriva unei transcrieri lungi pornite din greșeală).

### Tăierea pauzelor
- **Pauză** = tăcere între două cuvinte consecutive mai lungă de **0,4 s**; se păstrează **0,1 s** înainte și după fiecare bucată de vorbire, iar tăcerea de la începutul și sfârșitul clipului se taie. *(propunerea mea; valori de ajustat după test)*
- Din `words-N.json` se calculează **segmentele de vorbire** ale clipului (`[{start, end}]`, timpi relativi la clip, ordonate, fără suprapuneri).
- ffmpeg: din sursă se taie segmentele (video + audio) și se lipesc, apoi se aplică exact același layout ca acum (zoom, bare blurate, video jos, subtitrări). Gameplay-ul de jos **nu** se taie: curge continuu pe durata clipului scurtat.
- Subtitrările: timpii cuvintelor se mută pe noua cronologie (fiecare cuvânt își păstrează poziția în segmentul lui; cuvintele care cad în afara segmentelor nu există, prin construcție).
- Durata nouă a clipului se afișează în card („27 s”).
- **Implicit pornit** pentru toate clipurile, inclusiv la prima randare după procesare. *(propunerea mea: e motivul pentru care a fost cerut; se poate debifa per clip)*
- **Doar cu timpi de la Whisper** (`wordsSource === "whisper"`). Timpii YouTube nu arată tăcerile reale (la subtitrările automate fiecare cuvânt ține până la următorul; la cele manuale sunt estimați), deci tăierea ar nimeri în cuvinte. Când clipul are timpi YouTube (Whisper lipsește sau a dat eroare): bifa e dezactivată cu textul „Necesită transcriere Whisper”, `cutPauses = false`, iar serverul refuză `cutPauses: true` pentru acel clip. *(decizia mea, din verificarea designului)*
- **Previzualizarea din editor** arată în continuare segmentul netăiat (încadrare, video jos); sub bifă apare textul „Pauzele se taie la Aplică”. Rezultatul exact se vede în modul Rezultat. *(propunerea mea)*

### Stare și compatibilitate
- `project.json`: per clip `cutPauses: boolean`, `duration: number` (secunde după tăiere), `wordsSource: "whisper" | "youtube"`.
- Proiectele create înainte de această schimbare (fără `words-N.json`): la primul „Aplică” se rulează rafinarea (a) pentru clipul respectiv; `cutPauses` lipsă = `false` (comportamentul vechi până când utilizatorul bifează).
- `POST /api/render` primește în plus `cutPauses: boolean`.

## Constrângeri
- Dependențe noi permise: doar `faster-whisper` (Python) + modelul. Fără pachete npm.
- Pe Windows: ffmpeg cu `cwd` = folderul proiectului; filtrele folosesc nume simple de fișiere.
- Toate sunt pe calculatorul utilizatorului; nimic nu pleacă în afară în afară de descărcarea de pe YouTube și a modelului.

## Lăsat constructorului
- Structura exactă a filtrului ffmpeg pentru tăiere (trim/atrim + concat sau select/aselect).
- Factorul de estimare (măsurat), formatul exact al apelului Python, unde stă cache-ul modelului.
- Organizarea codului (ex. `pauses.js` testabil fără ffmpeg).
