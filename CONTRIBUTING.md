# Cum lucrăm în doi la ClipClick

Proiectul are acum doi oameni. Regulile de mai jos există ca să nu lucrăm pe același lucru, ca `main` să meargă mereu și ca fiecare să știe ce a decis celălalt. Ele se aplică la fel și când lucrăm cu Claude Code sau Codex: agentul citește `CLAUDE.md`, care trimite aici.

## 1. Sarcinile
- **Orice lucru începe de la un issue pe GitHub**, cu un singur responsabil (Assignee). Fără issue nu există sarcină.
- **Nu lucrezi pe un issue asignat celuilalt** fără să vă înțelegeți întâi, printr-un comentariu în issue.
- Pe issue-ul la care lucrezi scrii un comentariu „Încep” și, dacă te oprești la jumătate, un rând despre unde ai rămas.
- Ai găsit un bug sau ai o idee: deschizi un issue nou, nu o rezolvi „în treacăt” în alt PR.

## 2. Branch-uri și `main`
- **Nimeni nu face push direct pe `main`.** Totul intră prin pull request.
- Un branch pe sarcină, pornit din `main`-ul la zi: `feature/<ce-face>`, `fix/<ce-repară>` sau `docs/<ce-schimbă>`.
- Înainte să deschizi PR-ul, aduci branch-ul la zi cu `main` (`git pull --rebase origin main` sau merge) și rulezi testele din nou.
- Nu faceți PR-uri înlănțuite (un branch pornit din alt branch nemerguit). Dacă e nevoie, citiți capcana despre PR-uri înlănțuite din `CLAUDE.md`.

## 3. Pull request-uri
- **`node --test` trebuie să treacă**, fără argument de folder (vezi `CLAUDE.md`). PR-ul spune câte teste trec.
- **Funcționalitate nouă înseamnă teste noi.** Testele nu apelează niciodată YouTube, Ollama sau Whisper reali: se folosesc uneltele false din `testing/fake-tools.js` și Ollama-ul fals din `test/server.test.js`.
- Descrierea PR-ului: ce face, cum ai verificat (teste + ce ai încercat de mână) și ce **n-ai** verificat. Pune `Closes #<nr>` ca issue-ul să se închidă singur.
- **Celălalt face review înainte de merge.** Cine a deschis PR-ul dă merge după aprobare, cu „Create a merge commit”, și șterge branch-ul.
- Un PR rezolvă un singur issue. Dacă iese mare (peste ~400 de rânduri de cod), întrebați-vă dacă nu trebuia împărțit.

## 4. Decizii
- Deciziile despre produs (cum arată subtitrările, ce se descarcă, ce face AI-ul) sunt în `CLAUDE.md`, la „Decizii”, **cu data și cine a decis**.
- Schimbi o decizie existentă sau adaugi o dependență nouă (pachet npm/pip, serviciu, model)? Discutați întâi în issue. Nu se schimbă tacit într-un PR.
- Aplicația rămâne **locală și gratuită**: fără API-uri plătite și fără servicii în cloud.

## 5. Documentația comună
- **`CLAUDE.md`**: contextul proiectului (decizii, structură, capcane, unde am rămas). Îl actualizează cine termină o sarcină, în același PR.
- **`docs/jurnal.md`**: o intrare pe sesiune de lucru, cu numele tău în titlu (ex. `## 2026-11-24 — Enea: …`). La conflict în jurnal se păstrează ambele intrări.
- **Cifrele de referință** din `CLAUDE.md` sunt măsurate pe laptopul lui Enea (i5, fără placă video). Când adaugi cifre de pe alt calculator, spune care.
- Codul și mesajele de commit sunt în engleză (ca până acum). Textele din interfață, documentația și discuțiile sunt în română.

## 6. Ce nu se urcă niciodată
- `data/` (proiecte și videouri, pot avea GB), `satisfying/`, `.superpowers/`, fișiere `.env` sau orice parolă/token. Sunt deja în `.gitignore`. Verifică `git status` înainte de commit.

## 7. Când nu sunteți de acord
- Discuția se mută în issue, cu argumente scurte și, dacă se poate, cu o măsurătoare sau un exemplu.
- Dacă nu ajungeți la o concluzie, decide Enea (proiectul e al lui) și decizia se notează în `CLAUDE.md`.
