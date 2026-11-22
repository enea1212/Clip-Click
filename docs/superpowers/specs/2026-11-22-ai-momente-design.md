# Alegerea momentelor cu AI — design

Data: 2026-11-22 · Dimensiune: proiect · Branch: `feature/ai-momente`

## De ce
Acum momentele se aleg după densitatea vorbirii și o listă de ~25 de cuvinte cheie: aplicația nu înțelege ce se spune, deci alege adesea bucăți banale sau tăiate în mijlocul unei fraze. Enea vrea momente cu adevărat bune pentru Shorts.

## Decizii luate de Enea
- Tipuri de videouri: **și streamuri/gaming, și podcasturi/interviuri (C)**. AI-ul își dă seama singur ce fel de video e.
- **AI local, gratuit: Ollama cu `qwen2.5:7b` (A).** Nimic nu pleacă de pe calculator.
- **Lungime naturală a clipurilor (A):** AI-ul alege începutul și sfârșitul, la limită de frază, între ~20 și ~50 s.
- **Abordare: preselecție după reguli + AI pe candidați (1).** Viteză previzibilă și pe videouri de ore.
- **10 candidați (B)**: estimat ~7–8 min în plus pe laptopul lui Enea (măsurat: qwen2.5:3b = 13 s/candidat + 5 s încărcare; 7b estimat ~40–50 s/candidat). Progres vizibil: „AI notează momentele: 4/10”.

## Ce caută AI-ul *(propunerea mea, acceptată de Enea)*
- **Stream/gaming:** reacții puternice, momente amuzante, eșecuri sau victorii spectaculoase, replici bune.
- **Podcast/interviu:** o idee tare spusă scurt, o poveste cu final, o opinie controversată, un sfat clar.
- **Mereu:** clipul se înțelege fără context și începe cu ceva care prinde în primele 2–3 secunde.
- Pe fiecare card: **titlu scurt propus** (în limba videoului) și **motivul** alegerii (în română).

## Obiective
- Cele 3 clipuri sunt alese de AI, cu început și sfârșit la limită de frază, 20–50 s.
- Timp adăugat: ~7–8 min (10 candidați), indiferent de lungimea videoului; progresul se vede pe ecran.
- Dacă AI-ul nu e disponibil (Ollama oprit, model nedescărcat, răspunsuri invalide), procesarea **nu pică**: alege ca acum, după reguli, și cardul spune asta.

## Non-obiective
- AI pe imagine/video (doar pe text).
- Alegerea modelului din interfață; mai mult sau mai puțin de 3 clipuri.
- Servicii plătite / API extern.

## Anti-obiective
- Clipuri care încep sau se termină în mijlocul unei fraze.
- Clipuri suprapuse sau aproape identice.
- O procesare de ore care pică la final pentru că AI-ul a răspuns prost.

## Abordări luate în calcul
1. **ALEASĂ — Preselecție după reguli (10 zone candidate de ~75 s) + AI care notează fiecare zonă și alege începutul/sfârșitul, titlul și motivul; se păstrează cele mai bune 3 fără suprapuneri.**
2. AI pe toată transcrierea, pe bucăți de 5 min, plus o rundă finală. Nu ratează nimic, dar pe 6 h ar dura peste o oră pe CPU.
3. Claude prin API (plătit) — respins de Enea (local, gratuit).

## Design

### Instalare
- `ollama pull qwen2.5:7b` (~4,7 GB, o singură dată); în README.
- Modelul și adresa se pot schimba din variabile de mediu: `CLIPTREI_MODEL` (implicit `qwen2.5:7b`), `CLIPTREI_OLLAMA_URL` (implicit `http://127.0.0.1:11434`). *(propunerea mea; și pentru teste)*

### 1. Candidați (reguli)
- Din cuvintele transcrierii se construiesc **ferestre de ~75 s** (pas 15 s), notate cu scorul de acum (densitate + cuvinte cheie).
- Se păstrează **cele mai bune 10**, fără suprapuneri. Pe videouri scurte, câte încap.
- Funcție pură, testabilă: `chooseCandidates(transcript, { count: 10, length: 75 })`.

### 2. Linii (fraze) pentru AI
- Fiecare candidat se împarte în **linii**: o linie se termină la punctuație de final (`.?!`), la o pauză > 0,5 s sau după ~15 cuvinte (subtitrările automate YouTube n-au punctuație).
- Fiecare linie are index, ora de început (mm:ss) și text. AI-ul răspunde cu **indexul primei și al ultimei linii**, nu cu secunde — astfel începutul și sfârșitul cad mereu la limită de frază.

### 3. Întrebarea către AI (per candidat)
- Prin API-ul Ollama `/api/generate`, `stream: false`, `temperature` mică (~0,2), răspuns forțat **JSON după o schemă** (`format`):
  `{ "kind": "stream|podcast|other", "score": 0–10, "start_line": int, "end_line": int, "title": string, "reason": string }`.
- Prompt în engleză (modelul înțelege mai bine), cu criteriile de mai sus, regula 20–50 s și: titlu în limba videoului, motiv în română, max ~12 cuvinte fiecare.
- Timeout per candidat (~3 min); o eroare sau un răspuns invalid pentru un candidat îl elimină doar pe el.
- După fiecare candidat se salvează progresul (`aiProgress: { done, total }`), afișat ca „AI notează momentele: 4/10”.

### 4. Validare și alegere
- Răspunsul se validează: indici în interval, `start_line ≤ end_line`, durata 20–50 s. Dacă durata iese din interval, se ajustează adăugând/scoțând linii la capete (cât mai aproape de propunerea AI); dacă nu se poate, candidatul cade.
- Clipul = de la începutul primei linii (−0,1 s) până la sfârșitul ultimei (+0,2 s).
- Se aleg **cele mai bune 3 după nota AI**, fără suprapuneri (la egalitate, scorul regulilor). Rangul („LOCUL n DIN 3”) = ordinea notei AI.
- Dacă AI-ul dă mai puțin de 3 clipuri valide, restul se completează după reguli (ca acum, 34 s). *(decizia mea, din verificarea designului)*
  - Fiecare clip are `source: "ai" | "reguli"`. Proiectul are `selection: "ai"` dacă cel puțin un clip e ales de AI, altfel `"reguli"`.
  - Clipurile AI sunt clasate primele (după nota AI), apoi cele după reguli (după scorul regulilor).
  - Un clip „reguli” arată „Short N” și eticheta „ales după reguli” în loc de titlu și motiv.

### 5. Etapă nouă, reluabilă
- Între transcriere și randare: status **`choosing`** („AI alege momentele…”).
- Fiecare răspuns AI se salvează în `ai/candidate-N.json` (scriere atomică); la „Reia” se notează doar candidații lipsă.
- Proiectul ține `selection: "ai" | "reguli"` și, pentru „reguli”, motivul (ex. „Ollama nu rulează”).

### 6. Interfață
- Pe card: **titlul propus** (în locul lui „Short N”) și **motivul**, sub el. „LOCUL n DIN 3” rămâne.
- Ecranul de încărcare / „Se procesează” arată etapa AI cu progres („AI notează momentele: 4/10”).
- Dacă `selection` e „reguli”: o notă discretă pe pagina proiectului: „Momente alese după reguli (AI indisponibil: …)”.
- Verificarea dinainte (`/api/inspect`) spune dacă AI-ul e disponibil; mesajul de încărcare menționează etapa AI.

### „Alege din nou cu AI” *(decizia mea, din verificarea designului)*
- Pe proiectele cu `selection: "reguli"`, pagina proiectului are butonul **„Alege din nou cu AI”**.
- Folosește videoul și transcrierea existente (fără descărcare, fără Whisper): șterge clipurile randate și `ai/`, golește lista de clipuri și reia procesarea de la etapa de alegere, sub blocarea de job greu.
- Înainte, confirmare: „Clipurile și setările lor (zoom, video jos, pauze) se refac. Continui?”.
- Dacă AI-ul tot nu e disponibil, mesaj clar, fără să atingă clipurile existente (se verifică AI-ul înainte de ștergere).

### Rezervă (AI indisponibil)
- Verificare la începutul etapei: Ollama răspunde și modelul există (`/api/tags`). Dacă nu → alegere după reguli (exact ca acum, clipuri de 34 s), `selection: "reguli"`, fără eroare.

## Constrângeri
- Fără pachete npm noi (HTTP cu `fetch` din Node 24).
- Totul local; Ollama pe `127.0.0.1`.
- Procesarea rămâne un singur job greu (blocarea existentă).

## Verificare
- Teste unitare: candidați, împărțirea în linii, validarea și ajustarea răspunsului AI, alegerea finală (suprapuneri, completare după reguli).
- Teste de server cu un Ollama fals (server HTTP în test, `CLIPTREI_OLLAMA_URL`): flux AI complet; Ollama oprit → reguli; răspuns invalid pentru un candidat; „Reia” nu repetă candidații deja notați.
- Real: un podcast și un stream, comparat cu alegerea după reguli; timp măsurat pe laptopul lui Enea.

## Lăsat constructorului
- Textul exact al promptului; pragurile exacte (pas, număr de candidați) după primul test real.
- Organizarea codului (ex. `ai.js` pentru Ollama + validare).
