# Robustețe: protecție cereri, un singur job, reluare după eroare — design

Data: 2026-11-22 · Dimensiune: trei schimbări mici-medii, fiecare pe branch-ul ei · Sursa: critica de pe dashboard (punctele 1–3), aprobate de Enea („toate 3”).

## De ce
- O procesare de ore care pică la final șterge acum tot folderul (video de GB + transcriere).
- Două click-uri pornesc două procesări grele în paralel (blocarea e pe un UUID nou la fiecare cerere).
- Orice site deschis în browser poate trimite cereri către `localhost:4173` și porni descărcări de GB.

## Decizii
- **Ordine și branch-uri** *(propunerea mea, acceptată)*: `fix/protectie-cereri` → `feature/un-singur-job` → `feature/reluare-procesare`; push pe fiecare branch + Pull Request pe GitHub; Enea dă merge (sau cere să-l dau eu).
- **Al doilea video cât rulează unul: refuz cu mesaj (A)** — decis de Enea. Fără coadă.

## 1. Protecție contra cererilor din alte site-uri (`fix/protectie-cereri`)
- Toate cererile: header-ul `Host` trebuie să fie `localhost:<PORT>` sau `127.0.0.1:<PORT>` (apără și de DNS rebinding); altfel 403.
- Cererile care modifică ceva (`POST`, `DELETE` pe `/api/*`): dacă au `Origin`, trebuie să fie `http://localhost:<PORT>` sau `http://127.0.0.1:<PORT>`; altfel 403. Fără `Origin` (curl, unelte locale) sunt permise — browserele trimit mereu `Origin` la POST/DELETE.
- `POST` cu body: `Content-Type` trebuie să fie `application/json`; altfel 415. (Un formular sau `fetch` cu `text/plain` de pe alt site nu mai trece și nu poate ocoli verificarea prin lipsa preflight-ului.)
- Logica într-o funcție pură testabilă (`checkRequest(method, headers, port)` în `http-utils.js`).
- **Abordări:** (a) verificare Host/Origin/Content-Type pe server — ALEASĂ, zero impact pentru utilizator; (b) token secret în pagină — mai complex, inutil pentru o aplicație locală.

## 2. Un singur job greu (`feature/un-singur-job`)
- „Job greu” = procesarea unui video (`/api/process` și, din punctul 3, „Reia”): descărcare + Whisper + randări.
- O blocare globală: dacă un job greu rulează, un nou `/api/process` sau „Reia” primește **409 „Se procesează deja un video. Încearcă după ce termină.”**, înainte de orice descărcare sau folder nou.
- `/api/inspect`, listarea, deschiderea proiectelor și „Aplică” pe clipuri existente rămân permise (sunt scurte).
- Interfața arată mesajul ca eroare normală.
- **Abordări:** (a) blocare globală în memorie — ALEASĂ; (b) coadă — respinsă de Enea.

## 3. Reluare după eroare (`feature/reluare-procesare`)
- `project.json` se scrie **de la început** și se actualizează după fiecare etapă, cu `status`: `downloading` → `transcribing` → `rendering` → `ready`; la eroare `failed` + `error` (mesajul). Se salvează și `url` și `transcribe`, ca să se poată relua.
- **La eroare nu se mai șterge folderul** — doar dacă nu s-a descărcat nimic (fără `source.mp4`), caz în care nu e nimic de reluat.
- **Transcrierea lungă e reluabilă pe bucăți**: fiecare bucată de 10 min transcrisă se salvează (`chunks/chunk-N.json`); la reluare se transcriu doar bucățile lipsă.
- **Oprirea serverului în timpul unui job**: la repornire, proiectele cu status diferit de `ready`/`failed` și fără job activ sunt tratate ca întrerupte (`failed`, „Procesarea a fost întreruptă.”).
- **„Proiectele mele”**: proiectele `failed`/întrerupte apar cu eticheta „incomplet”, mesajul erorii, butoanele **„Reia”** și „Șterge”. Proiectele în lucru apar „se procesează…” (fără „Reia”, fără „Șterge” — ștergerea e oricum blocată cât rulează).
- **„Reia”** = `POST /api/projects/<id>/resume`: sare peste ce există (videoul descărcat, `words.json`, bucățile de transcriere, momentele alese, clipurile randate) și face doar ce lipsește; respectă blocarea din punctul 2.
- Folderele vechi fără `project.json` rămân „doar vizionare”, ca acum.
- **Abordări:** (a) etape salvate în `project.json` + reluare manuală cu „Reia” — ALEASĂ; (b) reluare automată la pornirea serverului — riscă să pornească singură o transcriere de ore fără să vrei; (c) job-uri în fundal cu stare și anulare — mai mult decât s-a cerut (Enea a ales anterior „fără anulare”).

## Non-obiective
- Coadă de procesare, anulare, bară de progres reală.
- Autentificare sau acces din rețea (aplicația rămâne doar pe `localhost`).

## Verificare
- Teste unitare pentru `checkRequest`, blocarea globală, planul de reluare (ce etape lipsesc dintr-un folder).
- Live: cerere cu `Origin` străin → 403; `text/plain` → 415; aplicația merge normal din browser. Două procesări → a doua primește 409 instant. Reluare: un proces oprit forțat în mijlocul transcrierii pe bucăți, apoi „Reia” → continuă de la bucata următoare, fără re-descărcare.
