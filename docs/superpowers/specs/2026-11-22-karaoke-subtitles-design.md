# Subtitrări karaoke pentru Shorts — design scurt

Data: 2026-11-22 · Dimensiune: schimbare mică

## De ce
Subtitrările actuale (o propoziție albă, Arial, jos) arată simplu. Utilizatorul vrea subtitrări „mai frumoase”, în stilul tipic de Shorts: ales **B · Karaoke** din machetele vizuale.

## Obiective
- Cuvinte mari, 3–4 pe ecran, MAJUSCULE, albe cu contur negru gros.
- Cuvântul rostit acum devine galben și puțin mai mare.
- Același stil fix pe toate clipurile, fără setări în interfață.

## Non-obiective
- Setări de stil în aplicație (culoare, poziție) — decis „la fel pentru toate”.
- Transcriere audio (Whisper) pentru videoclipuri fără subtitrări.
- Schimbări la selecția momentelor, decupare sau interfață.

## Anti-obiective
- Text care acoperă fața sau stă sub butoanele YouTube de jos.
- Cuvinte care apar dublat (YouTube auto-subs repetă rândul anterior în fiecare cue).
- Dependențe noi de instalat.

## Abordări luate în calcul
1. **Câte o linie ASS pentru fiecare cuvânt (ALEASĂ).** Pentru fiecare cuvânt, un eveniment `Dialogue` care afișează tot grupul, cu cuvântul activ colorat și mărit prin tag-uri inline. Control complet asupra aspectului, zero dependențe noi.
2. Tag-uri karaoke native ASS (`\k`). Mai simplu, dar doar schimbă culoarea, fără mărire, și nu arată ca macheta.
3. Whisper pentru timpi pe cuvânt. Mai precis și funcționează fără subtitrări, dar instalare nouă și procesare mult mai lentă; rezolvă altă problemă.

## Design
**Constatare:** subtitrările automate YouTube (VTT) conțin timpul fiecărui cuvânt (`<00:00:01.234><c> cuvânt</c>`), dar `parseVtt` din `server.js` șterge aceste tag-uri. Tot acolo, rândurile repetate din auto-subs produc text dublat.

1. **Extragere cuvinte** (`server.js`, funcție nouă `parseVttWords`): returnează listă `{ word, start, end }`.
   - Folosește doar rândul cu tag-uri de timp din fiecare cue (ignoră rândul repetat și cue-urile de ~10 ms) → fără dubluri.
   - Primul cuvânt al rândului începe la începutul cue-ului; fiecare cuvânt se termină când începe următorul (ultimul, la sfârșitul cue-ului).
   - **Fallback** pentru subtitrări fără timpi pe cuvânt (manuale): timpul cue-ului se împarte între cuvinte proporțional cu numărul de litere. *(propunerea mea)*
2. **Grupare**: maxim 4 cuvinte pe grup; grup nou și la punctuație de final (`.?!,`) sau pauză > 0,6 s. *(propunerea mea)*
3. **Fișier `.ass`** per clip, în loc de `.srt`:
   - `PlayResX=1080, PlayResY=1920`; font Arial Black (standard pe Windows), mărime ~90, alb, contur negru 6, umbră 3, aliniere jos-centru, `MarginV≈480` (≈75% din înălțime). *(propunerea mea; valorile exacte se ajustează la test)*
   - Pentru fiecare cuvânt: un `Dialogue` de la `start` la `end`-ul cuvântului (relativ la clip), cu tot grupul; cuvântul activ are `{\c&H00E6FF&\fscx112\fscy112}` (galben). Între cuvinte nu rămân goluri: fiecare eveniment ține până la următorul cuvânt din grup.
   - Text în MAJUSCULE, cu diacritice păstrate.
4. **ffmpeg**: filtrul `subtitles='…captions-N.ass'` fără `force_style` (stilul e în fișier).
5. `parseVtt` rămâne pentru selecția momentelor, dar se reconstruiește din cuvintele deduplicate, ca descrierea clipului din interfață să nu mai aibă text dublat.

## Lăsat constructorului
Valorile exacte de mărime, contur și `MarginV` după ce se vede un clip real; numele funcțiilor; teste pentru parsare și grupare cu un VTT mic de exemplu.

## Verificare
Rulare pe un video public cu auto-subs în română sau engleză: 3 clipuri cu text karaoke sincron, fără cuvinte dublate, fără text peste față.
