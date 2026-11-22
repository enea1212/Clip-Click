# ClipTrei

Aplicatie locala care descarca un video YouTube public, selecteaza trei secvente de 34 de secunde pe baza subtitrarilor disponibile si le exporta vertical, cu subtitrari arse in imagine.

## Pornire

Ai nevoie de Node.js, Python, `yt-dlp` si `ffmpeg` disponibile in PATH.

```powershell
node server.js
```

Apoi deschide <http://localhost:4173>.

Pentru instalarea yt-dlp:

```powershell
python -m pip install --user yt-dlp
```

Pentru transcrierea locala cu Whisper (timpi exacti pe cuvant, videouri fara subtitrari, taierea pauzelor):

```powershell
python -m pip install --user faster-whisper
```

La prima folosire se descarca modelul `small` (~500 MB). Ruleaza pe procesor: aproximativ 0,45 secunde de procesare pentru fiecare secunda de audio.

Clipurile rezultate se salveaza in `data/<id>/short-1.mp4` etc. Directoarele din `data` pot fi sterse dupa ce descarci clipurile.

## Limite curente

- Selectia este euristica si foloseste densitatea vorbirii si cateva cuvinte cheie; nu este inca o selectie semantica bazata pe un model AI.
- Sunt necesare subtitrari YouTube in romana sau engleza. Transcrierea audio automata pentru videoclipuri fara subtitrari nu este conectata.
- Cadrul vertical este decupat din centrul imaginii. Nu exista inca detectarea si urmarirea automata a persoanei care vorbeste.
- Editarea subtitrarilor inainte de export nu este implementata.
