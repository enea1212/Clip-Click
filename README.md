# ClipClick

Aplicatie locala care descarca un video YouTube public, alege trei momente bune (20–50 s, cu AI local sau dupa reguli) si le exporta ca Shorts verticale 1080×1920, cu subtitrari karaoke arse in imagine. Fiecare clip se poate edita separat: zoom cu bare blurate, video „satisfying” jos, taierea pauzelor.

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

Pentru alegerea momentelor cu AI (local, gratuit) ai nevoie de [Ollama](https://ollama.com) pornit si de model:

```powershell
ollama pull qwen2.5:7b
```

Pe un laptop fara placa video dedicata adauga ~8–10 minute pe video. Fara Ollama, momentele se aleg dupa reguli, ca inainte.

Clipurile rezultate se salveaza in `data/<id>/short-1.mp4` etc. Directoarele din `data` pot fi sterse dupa ce descarci clipurile.

## Limite curente

- Momentele le alege un model AI mic, local (qwen2.5:7b): judeca bine, dar nu perfect; uneori scrie titlul in alta limba.
- Videourile fara subtitrari se transcriu local cu Whisper, pe procesor: pe videouri de ore dureaza ore.
- Cadrul vertical se alege cu zoom, centrat. Nu exista inca mutarea stanga/dreapta sau urmarirea automata a persoanei care vorbeste.
- Editarea subtitrarilor inainte de export nu este implementata.
