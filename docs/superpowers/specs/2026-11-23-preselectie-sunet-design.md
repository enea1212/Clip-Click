# Preselecție după sunet pentru AI — design scurt

Data: 2026-11-23 · Dimensiune: schimbare mică-medie · Branch: `feature/preselectie-sunet`

## De ce
Pe stream-ul GTA de 6 h (proiect `data/29520ba6…`), dintre cele **12 cele mai puternice vârfuri de volum** (reacții, râsete, frustrare — ex. 0:45:45 „I'm about to cry, bro…”, 5:54:13 „Oh my god, it worked…”) **doar 1 ajungea între cei 10 candidați trimiși la AI**. Preselecția de acum alege doar după densitatea vorbirii și cuvinte cheie, deci ratează momentele de gaming cu puțină vorbire. (Măsurat 2026-11-23: 22 062 s analizate, 299 de vârfuri, analiza sunetului 47 s.)

## Decizie (Enea)
- **A: 10 candidați = 5 după vorbire (ca acum) + 5 în jurul celor mai puternice vârfuri de sunet.** Dacă nu sunt destule vârfuri, golul se umple după vorbire.

## Design
1. **Volum pe secundă:** după descărcare, `ffmpeg -vn -af aresample=16000,asetnsamples=16000,astats…,ametadata=print:key=lavfi.astats.Overall.RMS_level` → `loudness.json` (array de dB pe secundă, scriere atomică, refolosit la „Reia”). Eroare la analiză → fără candidați după sunet (nu pică procesarea).
2. **Vârfuri** *(pragurile din testul pe GTA)*: `delta = rms − mediana(±60 s)`; secundă de vârf dacă `delta ≥ 9 dB` și `rms > −25 dB`; secunde la ≤ 8 s distanță se unesc într-un eveniment; scor = `vârf_max × √durată`.
3. **Candidați:** `chooseCandidates` (vorbire) dă 5; apoi cele mai bune evenimente de sunet, fiecare cu fereastra `[vârf − 40 s, vârf + 35 s]` (75 s, limitată la video), fără suprapuneri cu ceilalți candidați, până la 10 în total; dacă lipsesc, se completează după vorbire.
4. **Indiciu pentru AI:** în prompt, pentru candidații de sunet, o linie „Note: the audio gets suddenly loud around mm:ss (possible shouting, laughter or a big reaction).”
5. **Rest neschimbat:** notare, clasare, lărgire, rezervă pe reguli, cache `ai/` (fișierul candidatului ține fereastra, deci cache-ul vechi nu se amestecă).

## Non-obiective
Alt model AI; analiză de imagine; schimbarea alegerii după reguli (când AI-ul lipsește).

## Verificare
- Teste unitare: citirea ieșirii ffmpeg, detectarea vârfurilor (incl. un vârf scurt izolat vs. zgomot constant), amestecul 5+5 cu completare și fără suprapuneri, indiciul din prompt.
- Test de server cu unelte false (volum simulat) că se trimit candidați de sunet.
- Real pe GTA (fără descărcare, din `data/29520ba6…`): câte din cele 12 vârfuri ajung acum la AI (așteptat ≥ 5).

## Lăsat constructorului
Organizarea codului (ex. `loudness.js`), formatul exact al indiciului.
