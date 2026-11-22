# Editor per clip: zoom cu bare blurate și video „satisfying” jos — design

Data: 2026-11-22 · Dimensiune: proiect · Depinde de: `2026-11-22-karaoke-subtitles-design.md` (implementat)

## De ce
Clipurile de acum sunt decupate din centru la 9:16, deci se pierd marginile videoului 16:9. Utilizatorul vrea:
1. să aleagă **el**, pentru fiecare clip, cât din video se vede (zoom), cu bare când dă zoom out;
2. opțiunea de a pune un video „satisfying” (gameplay tip Subway Surfers, slime etc.) în partea de jos a clipului — formatul popular de Shorts care ține atenția.

## Decizii luate de utilizator
- Setările se fac **după procesare, separat pentru fiecare clip** (nu o setare globală înainte).
- Barele de la zoom out sunt **același video, mărit și blurat** (nu negre, nu culoare).
- Videoul de jos vine dintr-un **folder `satisfying/`** de pe calculator; aplicația alege unul la întâmplare, de la un punct la întâmplare.
- Abordarea tehnică: **previzualizare live în browser (CSS), randare cu ffmpeg doar la „Aplică”**, refolosind videoul deja descărcat.

- **Proiectele anterioare se pot redeschide și edita** (butonul „Proiectele mele”) — ales de utilizator.

## Obiective
- Sub fiecare clip: slider **Zoom**, comutator **Video jos**, buton **Aplică**, buton **Descarcă**.
- Previzualizarea se schimbă instant la mișcarea sliderului / comutatorului.
- „Aplică” re-randează doar clipul acela, fără descărcare nouă, în câteva secunde–zeci de secunde.
- Subtitrările karaoke rămân exact ca acum.
- „Proiectele mele” listează videourile procesate; deschiderea unuia arată cele 3 clipuri cu editorul, ca imediat după procesare.

## Non-obiective
- Încărcare de fișiere din aplicație sau link YouTube pentru gameplay.
- Mutare stânga/dreapta a încadrării (pan), alegerea manuală a momentului, editarea textului.
- Descărcarea doar a bucăților necesare din video (îmbunătățire separată, ulterior).
- Subtitrări animate în previzualizarea de editare (o arată modul Rezultat, cu clipul randat).
- Redenumirea proiectelor, căutare sau sortare în listă.

## Anti-obiective
- Previzualizare care arată semnificativ diferit de clipul final (alt zoom, altă poziție a textului).
- Gameplay cu sunet peste vocea din clip.
- Pierderea clipurilor sau a setărilor când serverul repornește sau pagina se reîncarcă.
- Re-descărcarea videoului la „Aplică”.

## Abordări luate în calcul
1. **ALEASĂ — Previzualizare CSS în browser + randare ffmpeg la „Aplică”.** Instantaneu la slider; randarea finală rămâne ffmpeg local. Risc: mici diferențe de pixeli între CSS și ffmpeg, controlate prin aceeași formulă de zoom în ambele.
2. Imagine de previzualizare generată de server la fiecare mișcare. Exactă, dar 1–2 s de așteptare la fiecare mișcare.
3. Randare completă în browser (ffmpeg.wasm). Grea, lentă pe clipuri lungi, biblioteci mari.

## Design

### Aspect (canvas 1080×1920)
- **Fără video jos:** zona video = tot ecranul 1080×1920.
- **Cu video jos:** zona video = jumătatea de sus 1080×960; gameplay = jumătatea de jos 1080×960 (umplut și decupat din centru, fără bare). *(propunerea mea, arătată în machetă, neobiectată)*
- În zona video: fundal = același video scalat să umple zona, blurat și ușor întunecat; peste el, videoul la zoom-ul ales, centrat.

### Zoom
- Valoare `zoom ∈ [0, 1]`, slider 0–100 în interfață.
- Pentru o zonă W×H și o sursă w×h: `fit = min(W/w, H/h)` (tot videoul se vede), `fill = max(W/w, H/h)` (umple zona, ca acum); `scale = fit + zoom × (fill − fit)`.
- Videoul scalat (`w·scale × h·scale`, rotunjit la număr par) e centrat; ce depășește zona se taie, ce lipsește se vede ca fundal blurat.
- **Implicit:** clipurile inițiale se randează cu `zoom = 1`, fără video jos (identic cu acum). *(propunerea mea: nimic nu se schimbă până nu atingi sliderul)*
- Aceeași formulă în browser (CSS) și pe server (filtru ffmpeg).

### Subtitrări
- Fără video jos: ca acum (jos-centru, `MarginV=480`).
- Cu video jos: centrate pe linia dintre cele două jumătăți (y = 960), ex. aliniere ASS 5 (mijloc). *(propunerea mea, arătată în machetă)*
- `buildAss` primește o opțiune de layout; restul comportamentului neschimbat.

### Video „satisfying”
- Folder `satisfying/` în rădăcina proiectului (adăugat în `.gitignore`); fișiere `.mp4 .mov .webm .mkv`.
- La pornirea comutatorului: serverul alege un fișier la întâmplare și un start la întâmplare în `[0, durată − 34 s]` (durata citită cu `ffprobe`); dacă e mai scurt decât clipul, se repetă în buclă.
- Alegerea se **memorează per clip**, ca re-aplicarea cu alt zoom să păstreze același gameplay. Un buton mic **„↻ Alt video”** alege altul. *(propunerea mea)*
- Alegerea se face **separat de randare**: `POST /api/satisfying` `{ id, clip }` alege (sau re-alege) fișierul și startul, produce o copie ușoară pentru previzualizare **`sat-N.mp4`** (segmentul de 34 s, lățime ~640, mp4 H.264, fără sunet, în buclă dacă sursa e scurtă), salvează alegerea în `project.json` și răspunde `{ file, start, preview }`. Se apelează la prima pornire a comutatorului și la „↻”. Copia mp4 rezolvă și formatele pe care browserul nu le poate reda (`.mkv`, `.mov` HEVC). *(decizia mea, din verificarea designului)*
- Oprirea comutatorului păstrează alegerea; repornirea o refolosește (fără apel nou).
- **Fără sunet**: audio-ul clipului vine doar din videoul original.
- Folder gol/inexistent + comutator pornit → mesaj clar: „Pune cel puțin un video în folderul satisfying/”.

### Previzualizare (browser)
- La procesare, serverul mai produce pentru fiecare clip un fișier ușor **`raw-N.mp4`**: segmentul original, la rezoluție redusă (ex. lățime 640), raport original, fără subtitrări, cu sunet.
- Scena de previzualizare 9:16 din card: două `<video>` cu `raw-N.mp4` (fundal: `object-fit: cover` + `filter: blur()`; prim-plan: scalat după formula de zoom), plus, cu video jos, un `<video>` mut cu `sat-N.mp4`. Videourile pornesc/se opresc/sar împreună.
- **Două moduri ale cardului** *(decizia mea, din verificarea designului)*: **Rezultat** — playerul cu clipul randat (`short-N…mp4`, cu subtitrările karaoke), butoane „Editează” și „Descarcă”; **Editare** — scena live + controalele. Cardul pornește în Rezultat; „Editează” trece în Editare; după un „Aplică” reușit revine în Rezultat cu clipul nou. Un buton „Renunță” în Editare revine la Rezultat și resetează controalele la ultima randare.
- O etichetă statică „SUBTITRARE” arată unde va sta textul.
- Fișierele din `satisfying/` sunt servite de serverul existent (sunt sub rădăcină).

### Stare și API
- **`data/<id>/project.json`**: `{ id, title, url, createdAt, track, sourceWidth, sourceHeight, clips: [{ start, end, caption, zoom, satisfyingOn, satisfying: { file, start, preview } | null, video, raw }] }`, scris la procesare, actualizat la fiecare „Aplică” și alegere de gameplay. Sursa de adevăr pentru redeschidere.
- `title` = titlul real al videoului YouTube (citit cu yt-dlp), nu „source.mp4” ca acum — necesar ca lista de proiecte să fie utilă.
- `POST /api/process` (existent) returnează proiectul complet (forma de mai sus).
- **`GET /api/projects`** → `[{ id, title, createdAt, clipCount, thumb? }]`, cele mai noi primele (din `data/*/project.json`).
- **`GET /api/projects/<id>`** → proiectul complet.
- **`DELETE /api/projects/<id>`** → șterge folderul (sursa poate avea GB). *(propunerea mea: fără ștergere, discul se umple repede — un singur video de 6 h a avut 6,7 GB)*
- **`POST /api/satisfying`** `{ id, clip }` — vezi secțiunea Video „satisfying”.
- **`POST /api/render`** `{ id, clip, zoom, satisfying: boolean }` → validează (`id` UUID cu `project.json` existent, `clip` 1–3, `zoom` număr 0–1; dacă `satisfying` e true trebuie să existe deja o alegere), re-randează, salvează în `project.json`, răspunde clipul actualizat.
- Fișier nou la fiecare randare (`short-N-<timestamp>.mp4`), ca browserul să nu arate versiunea veche din cache; versiunea anterioară a clipului respectiv se șterge.
- O singură randare simultană per clip (butonul e dezactivat cât durează).

### Interfață (card de clip)
```
┌──────────────────────┐
│  [scenă 9:16 live]   │
├──────────────────────┤
│ Short 1   00:55–01:29│
│ Zoom  ○────────●  100│
│ [ ] Video jos  ↻     │
│ [ Aplică ] [Descarcă]│
└──────────────────────┘
```
- „Descarcă” descarcă mereu ultima randare (din modul Rezultat).
- În timpul randării: „Se randează…”, controalele dezactivate; la eroare, mesajul serverului sub butoane, cardul rămâne în Editare.

### Proiectele mele
- Butonul existent „Proiectele mele” din bara laterală deschide o listă: titlu, data, „3 clipuri”, buton „Deschide” și „Șterge” (cu confirmare).
- „Deschide” încarcă `GET /api/projects/<id>` și arată ecranul de rezultate cu editorul.
- Adresa paginii primește `#/p/<id>` la deschiderea/crearea unui proiect, ca un refresh să redeschidă același proiect; `#/projects` pentru listă. *(propunerea mea)*
- **Folderele vechi** (fără `project.json`, deci fără momentele de start salvate) nu pot fi convertite fidel: momentul de start al clipurilor nu a fost salvat nicăieri. Apar în listă ca **„doar vizionare”**: se pot vedea și descărca `short-N.mp4`, fără editor, și se pot șterge. *(decizia mea)*

## Constrângeri
- Fără dependențe noi (Node, ffmpeg/ffprobe, yt-dlp deja instalate).
- Windows: ffmpeg rulează cu `cwd` = folderul clipului; căile din filtre rămân nume simple de fișiere (căile cu `D:` strică filtrele).
- `source.mp4` rămâne pe disc (poate avea GB); asta e deja comportamentul actual.

## Lăsat constructorului
- Structura exactă a filtrului ffmpeg (split/blur/overlay/vstack), intensitatea blur-ului și a întunecării (în spiritul machetei).
- Rezoluția exactă a `raw-N.mp4`, sincronizarea videourilor în previzualizare.
- Organizarea codului (ex. modul nou pentru construirea filtrului, testabil fără ffmpeg).
- Stilul vizual al controalelor, în stilul existent al aplicației (`ui.css`, variabila `--lime`).
