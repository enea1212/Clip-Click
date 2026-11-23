# Limită totală de timp pentru etapa AI — design scurt

**Data:** 2026-11-23 · **Aprobat de:** Enea · **Branch:** `feature/limita-ai`

## De ce
Etapa „choosing” notează 10 candidați (câte 3 min limită pe răspuns) și mai face o rundă de clasare. În cel mai rău caz sunt ~33 min, timp în care singurul job greu e blocat. Enea vrea un plafon de ~12 min; ce nu apucă AI-ul se completează din reguli, iar estimarea apare la pornire, ca la Whisper.

## Obiective / non-obiective
- Etapa AI nu depășește ~12 min, indiferent cât de lent răspunde Ollama.
- Tăierea nu trebuie să sacrifice candidații după sunet (de acolo au venit locurile 1–2 pe GTA).
- Non-obiectiv: AI mai rapid sau mai puțini candidați din start.
- Anti-obiectiv: procesarea nu eșuează niciodată din cauza plafonului; în cel mai rău caz decid regulile.

## Abordări
- **Termen-limită pe toată etapa (ales).** Fiecare întrebare primește `min(3 min, timp rămas)`. E singura variantă care garantează plafonul.
- Limită mai mică pe fiecare răspuns: plafonul total rămâne 11 × limita, deci nu rezolvă cazul rău.
- Mai puțini candidați: scade calitatea și când AI-ul e rapid.

## Design
1. **Buget:** `AI_BUDGET_MS = 12 min` (suprascris în teste prin `CLIPTREI_AI_BUDGET_MS`), măsurat de la începutul notării. Timeout-ul fiecărei întrebări de candidat este `min(ANSWER_TIMEOUT_MS, rămas − rezervă)`, deci clasarea are mereu rezerva ei. Clasarea primește `min(ANSWER_TIMEOUT_MS, rămas)`.
2. **Rezerva pentru clasare:** când rămân sub `RANK_RESERVE_MS = 2 min` (proporțional în teste), nu se mai întreabă candidați noi. Clasarea primește timpul rămas, cel mult 3 min. Dacă expiră, decid notele individuale, ca acum.
3. **Ordinea întrebărilor alternează** vorbire / sunet. Indicii fișierelor `ai/candidate-N.json` rămân cei din `mixCandidates`, deci cache-ul existent rămâne valabil.
4. **Răspunsurile din cache nu consumă buget.** „Reia” și „Alege din nou cu AI” primesc din nou 12 min pentru ce lipsește.
5. **Candidații neîntrebați** nu se scriu în cache și nu se socotesc „fără răspuns”. Nota proiectului: „AI-ul a avut timp pentru X din 10 momente”, atunci când regulile completează.
6. **Interfață:**
   - La pornire: „AI-ul mai adaugă cel mult 12 minute.”
   - În timpul notării: progresul plus timpul rămas, din `aiProgress.deadline` (timestamp).

## Lăsat constructorului
Numele exacte ale funcțiilor, formatul timpului rămas, testele (Ollama fals lent + buget mic).
