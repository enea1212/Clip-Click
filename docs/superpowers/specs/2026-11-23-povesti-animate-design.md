# Povești animate din scenariu — design

**Data:** 2026-11-23 · **Cerut de:** Enea · **Stare:** propunere, de aprobat

## De ce
Enea vrea ca ClipClick să facă, pe lângă tăierea videourilor YouTube, **povești scurte pentru TikTok**: scrie un scenariu, iar aplicația produce un video vertical cu narațiune, imagini și subtitrări. Referința e Short-ul „The Speed Camera That Paid Good Drivers” (https://www.youtube.com/shorts/KY7XFLpxBrI, 58 s), care are:
- o poveste adevărată spusă de un narator;
- ~20 de scene de 2–4 s, cu decoruri 3D desenate (autostradă, casă, sufragerie);
- personaje 2D foarte simple (cap rotund, expresii, corp din bețe) puse peste decor;
- elemente grafice („112 MPH”, „$150 → $300”, bancnote care zboară, „FLASHED!”);
- subtitrări de 1–2 cuvinte pe mijloc.

## Obiective
- Din scenariul lui Enea iese un video **1080×1920, sub ~90 s**, gata de urcat pe TikTok.
- **Totul local și gratuit**, pe laptopul lui Enea (i5-1235U, Iris Xe, 16 GB RAM, fără NVIDIA).
- **Engleza e limba principală, româna e a doua.** Limba se alege pe poveste.
- Înainte de randare, Enea vede și poate corecta lista de scene, la fel ca editorul per clip.
- Un video de un minut e gata în **~10–15 minute**, cu Enea uitându-se la listă la mijloc.

## Non-obiective (versiunea 1)
- Mișcare reală în scene (mașini care trec prin cadru, camera care zboară). Aprobat de Enea: decoruri fixe cu mișcare de cameră sunt suficiente.
- Scrierea poveștii de către AI dintr-o idee. Enea scrie textul.
- Clonarea vocii (a lui Enea sau a prietenului său). Modelele locale bune au licențe necomerciale; rămâne pentru o etapă ulterioară.
- Muzică de fundal. Ar fi ușor de adăugat ulterior, dintr-un folder local, ca `satisfying/`.
- Urcarea automată pe TikTok.

## Anti-obiective (ce ar face proiectul un eșec)
- **Imitarea vocii unei persoane reale** (celebritate, actor de dublaj) fără acordul ei. Aplicația nu oferă așa ceva. Vocile sunt sintetice, gata făcute, iar personajele sunt inventate de Enea.
- **AI-ul rescrie textul lui Enea.** Narațiunea se spune exact cum a scris-o el; AI-ul doar împarte textul în scene și le adnotează.
- **Un decor ratat obligă la refacerea tuturor.** Fiecare decor se regenerează sau se înlocuiește separat.
- **Fără placă video sau driver, procesarea cade.** Se trece pe procesor (mai încet), cu mesaj.

## Constrângeri
- Aplicația rămâne Node (`server.js`) + Python + ffmpeg. Fără servicii în cloud și fără API-uri plătite.
- Un singur job greu odată (regula existentă `locks.heavy`). Povestea și procesarea unui video YouTube nu rulează în paralel.
- Dependențele noi sunt grele (vezi mai jos) și au intrat în conflict cu diffusers în test. Stau într-un **mediu Python separat**, `studio/venv`, creat de un script de instalare, iar modelele în `models/`. Ambele sunt ignorate de git.
- Testele nu rulează niciodată modelele reale (regula proiectului): imaginile, vocea și Whisper au variante false în `testing/fake-tools.js`.

## Măsurători (testul din 2026-11-23, laptopul lui Enea)
Testul a folosit SD-Turbo la 512×896, cu 4 decoruri ca în video:

| Variantă | Timp pe imagine |
|---|---|
| PyTorch, procesor, 2 pași | 46–54 s |
| PyTorch, procesor, 1 pas | 31–39 s |
| OpenVINO, procesor | 39–45 s |
| **OpenVINO, Iris Xe, 2 pași** | **~7,5 s** (după pornire) |

- Pornirea pe placă: 40–75 s, o singură dată. Prima imagine durează 10–60 s, pentru că modelul se adaptează la dimensiune; cu dimensiunea fixată corect ar trebui să dispară.
- Conversia modelului la OpenVINO: 118 s, o singură dată. Modelul are 4,9 GB descărcat.
- Calitatea e bună pentru decoruri (stil „3D desenat, însorit”, aproape de referință). Textul din imagini iese încâlcit, iar modelul ratează uneori obiectele cerute; promptul mai precis a ajutat.
- Licența SD-Turbo, Stability AI Community License: folosire gratuită, inclusiv comercială, sub 1 milion $ venit pe an. **Pentru uz comercial cere înregistrare gratuită la Stability AI.** Imaginile aparțin utilizatorului.

## Abordări luate în calcul
**Sursa decorurilor**, aleasă de Enea: **A + înlocuire manuală**.
- **A. Imagini generate local** (SD-Turbo prin OpenVINO pe Iris Xe). Aleasă: se potrivesc cu scena, sunt locale și gratuite, iar stilul e unitar.
- **B. Fotografii gratuite** (Pexels/Pixabay). Respinsă ca sursă principală: cer internet și cheie API, des nu se potrivesc cu scena, iar stilul variază.
- **C. Înlocuire manuală:** păstrată ca rezervă. Din lista de scene, orice decor se poate înlocui cu o imagine încărcată de Enea.

**Mișcarea din scene**, aleasă de Enea: decoruri fixe cu mișcare de cameră și personaje/elemente animate peste ele. Mișcarea reală în 3D (program 3D sau generator video AI în cloud) e respinsă: nu e locală, gratuită sau automată.

**Motorul de randare** (decizia lui Claude):
- **Python + Pillow, cadru cu cadru, trimis în ffmpeg. Ales.** Animații libere (curbe de accelerare, săritură, clipit), cod ușor de testat (o funcție „cadrul la timpul t”), fără dependențe noi grele.
- Doar filtre ffmpeg: respins. Animațiile cu expresii ffmpeg devin greu de citit și de depanat.
- Canvas în browser + captură: respins. Ar avea previzualizare identică, dar randarea prin browser headless e lentă și e o dependență în plus.
- Previzualizarea în interfață e o **randare rapidă la rezoluție mică** a aceluiași cod, deci arată identic cu rezultatul.

## Cum funcționează (fluxul)
Interfața are o intrare nouă în meniu, **„Poveste nouă”**, lângă „Creează Shorts” și „Proiectele mele”. Proiectele-poveste apar în aceeași listă, marcate „Poveste”.

### 1. Scenariul (intrare)
Enea scrie textul poveștii și alege limba (EN/RO). Liniile de dialog se scriu `NUME: replica`; ele sunt spuse de vocea personajului, restul de narator. Exemplu:
```
In 2010, Stockholm had a speeding problem. They doubled the fines. Nothing changed.
MAYOR: What if we paid the good drivers instead?
```

### 2. Lista de scene (AI local, Ollama `qwen2.5:7b`)
AI-ul primește textul împărțit **de cod** în propoziții și răspunde în JSON cu schemă fixă (ca `ANSWER_SCHEMA`):
- **Scene:** fiecare acoperă 1–2 propoziții consecutive (după indici, deci textul nu se poate schimba), cu:
  - `decor`: id-ul unui decor din listă;
  - `camera`: `zoom-in`, `zoom-out`, `pan-left`, `pan-right` sau `static`;
  - `characters`: `[{ name, expression, position: left|center|right }]`;
  - `overlay`: opțional, `{ type: badge|sign|money|flash|emoji, text }`.
- **Decoruri:** o listă **refolosită** între scene, fiecare cu `id` și `prompt` în engleză. Ținta e 5–10 decoruri pentru ~20 de scene, ca în referință.
- **Personaje:** fiecare cu `name` și `look`: culoarea pielii, părul (`short|long|bald|cap`), culoarea hainei.

Codul împarte și propozițiile lungi (peste ~12 cuvinte, adică peste ~4 s de voce) la virgulă sau „and/but/și/dar”, ca scenele să păstreze ritmul de 2–4 s din referință.

Validarea e în cod (ca `parseAnswer`): indici valizi, fiecare propoziție într-o singură scenă, valori din liste fixe. Dacă AI-ul nu răspunde sau răspunsul e invalid, se aplică **reguli**: o scenă pe propoziție, un singur decor generic, fără personaje. Exact ca la momente, unde regulile preiau fără eroare.

Pe CPU, modelul scrie ~4–6 cuvinte-cheie pe secundă, deci JSON-ul pentru 20 de scene durează **~3–5 min**. Plafon: 6 min (ca la `AI_BUDGET_MS`), apoi se aplică regulile.

### 3. Editorul listei de scene
Fiecare scenă e un rând cu:
- textul (needitabil aici, doar vizibil);
- decorul (miniatură, prompt editabil, buton „Regenerează”, buton „Încarcă imagine”);
- camera, personajele cu expresia (liste de alegere) și elementul grafic (tip + text).

Butonul **„Creează video”** pornește etapele 4–6. Decorurile se generează imediat după etapa 2, ca Enea să vadă miniaturile în editor.

### 4. Decorurile (SD-Turbo, OpenVINO)
- **Proces Python de lungă durată**, `studio/imagegen.py`, pornit la nevoie și oprit după 10 min de inactivitate (ca `keep_alive` la Ollama). Încarcă modelul o singură dată, ca „Regenerează” să dureze ~8 s, nu ~80 s. Comunică cu serverul prin stdin/stdout, câte un rând JSON pe cerere.
- Dimensiunea e fixă, **576×1024**, cu modelul fixat la ea (ca să nu mai fie lentă prima imagine), apoi mărită la 1080×1920 la randare. 2 pași, `guidance 0`. Testul a măsurat 512×896; 576×1024 are ~30% mai mulți pixeli și trebuie măsurat. Dacă depășește ~12 s pe imagine, rămâne 512×896.
- Promptul final e promptul decorului + un **stil comun fix** („stylized 3D render, bright daylight, clean cartoonish realism, cinematic lighting, no people, no text”), pentru aspect unitar.
- Ordinea dispozitivelor: Iris Xe (`GPU`), apoi procesorul (`CPU`) dacă placa nu e disponibilă, cu mesaj „Generare pe procesor: ~45 s pe imagine”.
- Fiecare decor se salvează ca `decor-<id>-<versiune>.png`; versiunea veche se păstrează până la randare.

### 5. Vocea și timpii pe cuvânt
- **Engleză: Kokoro** (`kokoro-onnx`, licență Apache-2.0, ~300 MB, merge pe procesor mai repede decât timpul real). Vocea naratorului se alege din lista Kokoro; fiecare personaj primește automat o voce diferită, schimbabilă din editor.
- **Română: Piper** (`piper-tts`, vocea `ro_RO-mihai-medium`). **De verificat la implementare:** licența vocii și calitatea. Dacă licența nu permite uz comercial, se notează în interfață.
- Se generează audio **pe scenă**. Durata scenei = durata audio + 0,25 s de pauză. Cele două se lipesc într-un `voice.wav`.
- **Timpii pe cuvânt:** se folosește Whisper local, deja în aplicație (`whisper.js`), pe audio-ul fiecărei scene. Textul afișat rămâne **cel din scenariu**: cuvintele Whisper se aliniază cu cuvintele scenariului (secvență comună, ca `difflib`), iar timpii lipsă se interpolează.
- Subtitrările folosesc **stilul karaoke existent** (`subtitles.js`, `.ass`). Pe poveste, grupurile au 1–2 cuvinte, ca în referință (parametru nou al grupării, implicit 3–4 ca acum).

### 6. Randarea
`studio/render_story.py` primește `story.json` (scene, durate, decoruri, personaje, elemente grafice) și scrie cadre RGB la 30 fps în ffmpeg. ffmpeg adaugă vocea și arde subtitrările `.ass`.

Pe fiecare cadru:
- **Decorul**, cu mișcarea de cameră a scenei: zoom 1,0→1,15 sau panoramare ±8%, cu accelerare lină. Între scene, tăietură simplă (ca în referință).
- **Personajele**, desenate de cod (`studio/characters.py`): cap rotund cu contur negru, ochi, sprâncene și gură după expresie, păr după `look`, corp-dreptunghi colorat și picioare-bețe.
  - Expresii: `neutral`, `happy`, `angry`, `surprised`, `sad`, `smug`.
  - Animație: apariție cu mică săritură, legănare ușoară, clipit la 3–5 s, gura se mișcă pe replicile personajului (după volumul vocii).
  - Fiind desenate de cod, arată la fel în fiecare scenă.
- **Elementul grafic**, desenat de cod:
  - `badge`: casetă cu cifre mari, ca „112 MPH”;
  - `sign`: panou cu text;
  - `money`: bancnote care cad;
  - `flash`: lumină albă scurtă;
  - `emoji`: o pictogramă din set fix, desenată de cod.
  
  Textul îl desenăm noi, niciodată modelul de imagini.

Estimare pentru 60 s: 1800 de cadre, ~2–4 min pe procesor.

### Estimare totală pentru un video de 60 s (de confirmat la implementare)

| Etapă | Timp |
|---|---|
| Lista de scene (AI) | 3–5 min |
| 8 decoruri, cu pornire | ~2 min |
| Voce (Kokoro) | <1 min |
| Whisper pe narațiune | ~1 min |
| Randare | 2–4 min |
| **Total** | **~10–13 min**, plus timpul lui Enea în editor |

## Date și fișiere
- Proiectele-poveste stau tot în `data/<id>/`, cu `project.json` de tip `"type": "story"`. Proiectele existente nu au câmpul și rămân de tip clip.
- Fișiere: `script.txt`, `storyboard.json`, `decor-*.png`, `voice-<scena>.wav`, `voice.wav`, `words.json`, `captions.ass`, `story-<timestamp>.mp4`.
- Reluarea („Reia”) merge pe etape, după fișierele existente, ca `resumePlan`.

## Interfață (schiță)
```
Poveste nouă
┌─────────────────────────────────────────────┐
│ Limba: (•) English  ( ) Română              │
│ ┌─────────────────────────────────────────┐ │
│ │ In 2010, Stockholm had a speeding...    │ │
│ │ MAYOR: What if we paid the good...      │ │
│ └─────────────────────────────────────────┘ │
│                      [ Pregătește scenele → ] │
└─────────────────────────────────────────────┘

Scene (20)                                  [ Creează video ]
┌────┬──────────────────────────┬──────────────────────────┐
│[🖼]│ 1 · "In 2010, Stockholm…"│ cameră: zoom-in ▾        │
│    │ decor: highway ✎ ↻ ⤒     │ MAYOR (smug) · stânga ▾  │
│    │                          │ grafic: badge "112 MPH"  │
└────┴──────────────────────────┴──────────────────────────┘
```

## Instalare (nouă)
`studio/setup.py` (rulat o dată):
1. creează `studio/venv`;
2. instalează `openvino`, `optimum-intel`, `diffusers`, `kokoro-onnx`, `onnxruntime`, `piper-tts`, `pillow`, `numpy`, cu versiuni fixate;
3. descarcă SD-Turbo și îl convertește la OpenVINO în `models/sd-turbo-ov/`;
4. descarcă vocile Kokoro și Piper RO în `models/`.

Spațiul total estimat e ~5–6 GB; varianta PyTorch și modelul original se șterg după conversie. README-ul primește secțiunea „Povești animate”, iar CLAUDE.md primește deciziile și capcanele (conflictul `huggingface-hub` între optimum-intel și diffusers; `reshape` cu batch 2 la SD-Turbo).

## Decizii luate de Claude (de verificat de Enea)
1. Dialogul se scrie `NUME: replica`; fiecare personaj are vocea lui, restul e narator.
2. AI-ul nu poate schimba textul: primește propozițiile numerotate și răspunde doar cu indici.
3. Randare în Python + Pillow, cu previzualizare la rezoluție mică din același cod.
4. Un proces de imagini care rămâne pornit 10 min, ca regenerarea unui decor să dureze secunde.
5. Subtitrările folosesc stilul karaoke existent, cu 1–2 cuvinte pe grup.
6. Lungimea maximă e ~90 s; peste, aplicația avertizează (TikTok acceptă mai mult, dar formatul de referință e sub un minut).
7. TikTok cere ca conținutul generat cu AI să fie marcat la urcare. Interfața afișează un rând de reamintire lângă butonul de descărcare.

## Lăsat constructorului
Valorile exacte de animație (amplitudini, durate), lista de voci Kokoro oferite, desenul exact al personajelor și al elementelor grafice (cu o captură de verificat cu Enea), formatul mesajelor cu procesul de imagini, împărțirea pe module în `studio/`.

## Mărime și ordine sugerată
E un proiect mare (de ordinul a 4–6 PR-uri). Ordinea propusă, fiecare cu issue și branch propriu:
1. instalarea și procesul de imagini;
2. vocea și timpii pe cuvânt;
3. randarea (personaje, elemente grafice, cameră) dintr-un `story.json` scris de mână;
4. lista de scene cu AI și regulile de rezervă;
5. interfața (scenariu, editor de scene, previzualizare);
6. integrarea cu „Proiectele mele” și „Reia”.

Se poate verifica pe un video real după pasul 3, cu o listă de scene scrisă de mână.

## Actualizare 2026-11-24 (după partea 1)
- **Editorul de scene ales de Enea: varianta 2B, „storyboard”** (macheta: grilă de cadre verticale 9:16 cu textul scenei, plus un panou lateral pentru scena selectată: decor cu prompt, Regenerează, Încarcă imagine, Previzualizează; cameră; grafic; personaje cu expresie și poziție; player dedesubt). Varianta 2A (listă de rânduri) respinsă.
- Decorurile sunt mărite cu Real-ESRGAN (`studio/upscale.py`), pe procesor: ~21 s pe decor în total.
- Subtitrările poveștii se mută deasupra capetelor personajelor (sus, la ~30% din înălțime), iar panoul (`sign`) urcă la ~25%, ca să nu se suprapună.
