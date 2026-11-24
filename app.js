const $ = (selector, root = document) => root.querySelector(selector);
const form = $("#url-form");
const urlInput = $("#youtube-url");
const views = { start: $("#start-view"), results: $("#results-view"), projects: $("#projects-view"), storyNew: $("#story-new-view"), story: $("#story-view") };
const grid = $("#clip-grid");

function isYouTubeUrl(value) {
  try {
    const url = new URL(value);
    return ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"].includes(url.hostname) && url.protocol === "https:";
  } catch { return false; }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]);
}

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options, body: options.body ? JSON.stringify(options.body) : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Cererea a eșuat.");
    error.resumable = data.resumable === true;
    throw error;
  }
  return data;
}

// Bumped on every view change, so a slow request can tell the user has moved on.
let viewToken = 0;

// While something is processing, re-run `reload` every 5 s as long as the user stays on this view.
// `token` must be the viewToken taken right after the view was opened (before any await):
// if the user left meanwhile, the refresh never runs.
function refreshWhileOpen(reload, token) {
  setTimeout(() => { if (token === viewToken) reload(); }, 5000);
}

function showView(name) {
  viewToken += 1;
  // An automatic refresh of the same view must not jump the page back to the top.
  const sameView = !views[name].classList.contains("hidden");
  for (const [key, el] of Object.entries(views)) el.classList.toggle("hidden", key !== name);
  $("#new-link").classList.toggle("active", name === "start");
  $("#history-link").classList.toggle("active", name === "projects");
  $("#story-link").classList.toggle("active", name === "storyNew");
  $("#crumb").textContent = { projects: "Proiectele mele", results: "Proiect", storyNew: "Poveste nouă", story: "Poveste" }[name] || "Creează Shorts";
  if (!sameView) window.scrollTo({ top: 0 });
}

function showMessage(kind, title, text) {
  grid.innerHTML = kind === "loading"
    ? `<div class="processing-state"><div class="loader"></div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span></div>`
    : `<div class="processing-error"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span></div>`;
}

/* ---------- routing ---------- */

async function route() {
  const hash = location.hash;
  const projectMatch = hash.match(/^#\/p\/([0-9a-f-]{36})$/);
  if (hash === "#/projects") return showProjects();
  if (hash === "#/story/new") return showStoryNew();
  const storyMatch = hash.match(/^#\/s\/([0-9a-f-]{36})$/);
  if (storyMatch) return openStory(storyMatch[1]);
  if (projectMatch) return openProject(projectMatch[1]);
  showView("start");
}

async function openProject(id) {
  showView("results");
  const token = viewToken;
  $("#results-title").innerHTML = `Proiectul <span>tău</span>`;
  $("#video-label").textContent = "";
  showMessage("loading", "Se încarcă proiectul", "");
  try {
    const project = await api(`/api/projects/${id}`);
    if (token !== viewToken) return;
    if (project.status && project.status !== "ready") {
      $("#video-label").textContent = project.title || "";
      return project.status === "failed"
        ? showMessage("error", "Proiect incomplet", `${project.error || ""} Îl poți relua din „Proiectele mele” cu „Reia”.`)
        : (showMessage("loading", "Proiectul se procesează", stageLabel(project)), refreshWhileOpen(() => openProject(id), token));
    }
    renderProject(project);
  } catch (error) {
    const legacy = (await api("/api/projects").catch(() => [])).find((item) => item.id === id && item.legacy);
    if (legacy) return renderLegacy(legacy);
    showMessage("error", "Nu am putut deschide proiectul", error.message);
  }
}

/* ---------- start / processing ---------- */

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isYouTubeUrl(urlInput.value.trim())) {
    urlInput.setCustomValidity("Adaugă un link HTTPS valid de YouTube.");
    urlInput.reportValidity();
    return;
  }
  urlInput.setCustomValidity("");
  const button = $(".submit-button", form);
  const label = $("span", button);
  const originalLabel = label.textContent;
  button.disabled = true;
  const url = urlInput.value.trim();
  // First a quick metadata check: videos without original subtitles need a (long) local transcription.
  label.textContent = "Verific linkul…";
  let transcribe = false;
  let estimate = 0;
  let aiReady = false;
  let aiMinutes = 12;
  try {
    const info = await api("/api/inspect", { method: "POST", body: { url } });
    aiReady = info.ai?.ok === true;
    aiMinutes = info.aiMinutes || aiMinutes;
    if (!info.hasSubtitles && !info.whisperAvailable) {
      throw new Error("Videoul nu are subtitrări, iar transcrierea locală nu e instalată. Instalează faster-whisper: python -m pip install --user faster-whisper");
    }
    if (!info.hasSubtitles) {
      estimate = info.estimateMinutes;
      if (!confirm(`Videoul nu are subtitrări. Transcrierea pe calculatorul tău durează cam ${estimate} minute. Continui?`)) {
        button.disabled = false;
        label.textContent = originalLabel;
        return;
      }
      transcribe = true;
    }
  } catch (error) {
    button.disabled = false;
    label.textContent = originalLabel;
    showView("results");
    showMessage("error", "Nu am putut verifica videoclipul", error.message);
    return;
  }
  label.textContent = "Analizez videoclipul...";
  showView("results");
  $("#results-title").innerHTML = `Pregătim <span>Shorts</span>`;
  const choose = aiReady ? "AI-ul alege momentele" : "alegem momentele după reguli (AI indisponibil)";
  $("#video-label").textContent = transcribe
    ? `Descarcăm audio-ul, îl transcriem cu Whisper, ${choose}, apoi descărcăm segmentele video și randăm clipurile.`
    : `Descarcăm audio-ul, ${choose}, apoi descărcăm segmentele video și randăm clipurile.`;
  const aiNote = aiReady ? ` AI-ul mai adaugă cel mult ${aiMinutes} minute.` : "";
  showMessage("loading", "Pregătim cele 3 Shorts", transcribe
    ? `Transcrierea durează cam ${estimate} minute, plus descărcarea.${aiNote} Poți închide pagina: proiectul apare în „Proiectele mele” când e gata.`
    : `Poate dura câteva minute, în funcție de lungimea videoclipului.${aiNote} Poți urmări progresul în „Proiectele mele”.`);
  const token = viewToken;
  try {
    const project = await api("/api/process", { method: "POST", body: { url, transcribe } });
    // If the user opened something else meanwhile, leave it; the project is in „Proiectele mele”.
    if (token !== viewToken) return;
    history.pushState(null, "", `#/p/${project.id}`);
    renderProject(project);
  } catch (error) {
    if (token === viewToken) {
      showMessage("error", "Nu am putut procesa videoclipul", error.resumable
        ? `${error.message} Ce s-a făcut până acum e păstrat: proiectul e în „Proiectele mele” și îl poți relua de acolo cu „Reia”.`
        : error.message);
    }
  } finally {
    button.disabled = false;
    label.textContent = originalLabel;
  }
});

urlInput.addEventListener("input", () => urlInput.setCustomValidity(""));
// Setting an empty hash that is already empty fires no hashchange, so route directly.
const goStart = () => { if (location.hash) location.hash = ""; else route(); };
$("#back-button").addEventListener("click", goStart);
$("#new-link").addEventListener("click", goStart);
$("#history-link").addEventListener("click", () => { location.hash = "#/projects"; });
$("#story-link").addEventListener("click", () => { location.hash = "#/story/new"; });
window.addEventListener("hashchange", route);

/* ---------- projects list ---------- */

async function showProjects() {
  showView("projects");
  const token = viewToken;
  const list = $("#project-list");
  list.innerHTML = `<div class="processing-state"><div class="loader"></div><strong>Se încarcă proiectele</strong></div>`;
  try {
    const projects = await api("/api/projects");
    if (token !== viewToken) return;
    if (!projects.length) { list.innerHTML = `<div class="empty-projects"><strong>Încă nu ai proiecte</strong><span>Lipește un link YouTube în „Creează Shorts” ca să începi primul set.</span></div>`; return; }
    list.innerHTML = projects.map(projectRow).join("");
    if (projects.some((item) => STAGE_LABELS[item.status])) refreshWhileOpen(showProjects, token);
  } catch (error) {
    list.innerHTML = `<div class="processing-error"><strong>Nu am putut încărca proiectele</strong><span>${escapeHtml(error.message)}</span></div>`;
  }
}

const STAGE_LABELS = {
  downloading: "Se descarcă audio-ul și subtitrările…",
  downloadingSegments: "Se descarcă segmentele video alese…",
  transcribing: "Se transcrie cu Whisper…",
  choosing: "AI notează momentele…",
  rendering: "Se randează…",
  storyboarding: "AI împarte povestea în scene…",
  decors: "Se generează decorurile…",
};

// Stage text, with the AI's progress while it scores candidates ("AI notează momentele: 4/10").
function stageLabel(item) {
  if (item.status === "choosing" && item.aiProgress?.ranking) return "AI compară momentele…";
  if (item.status === "choosing" && item.aiProgress?.total) {
    const { done, total, deadline } = item.aiProgress;
    // The AI stage has a time cap: show how long it can still take, at most.
    const left = deadline ? ` · mai are cel mult ${Math.max(1, Math.ceil((deadline - Date.now()) / 60_000))} min` : "";
    return `AI notează momentele: ${done}/${total}${left}`;
  }
  return STAGE_LABELS[item.status] || "se procesează…";
}

function projectRow(item) {
  const date = escapeHtml(new Date(item.createdAt).toLocaleString("ro-RO"));
  const title = escapeHtml(item.legacy ? "Proiect vechi" : item.title || "Video în curs de descărcare");
  let detail;
  let buttons = `<button class="text-button open-project">Deschide</button><button class="text-button danger delete-project">Șterge</button>`;
  if (item.legacy) {
    detail = item.clipCount ? "doar vizionare" : "incomplet — doar ștergere";
  } else if (item.status === "failed") {
    detail = `incomplet — ${escapeHtml(item.error || "procesarea s-a oprit")}`;
    buttons = `<button class="text-button resume-project">Reia</button><button class="text-button danger delete-project">Șterge</button>`;
  } else if (item.status && item.status !== "ready") {
    detail = escapeHtml(stageLabel(item));
    buttons = "";
  } else {
    detail = item.type === "story" ? `poveste · ${item.sceneCount} scene` : `${item.clipCount} clipuri`;
  }
  return `
    <div class="project-row${item.status === "failed" ? " incomplete" : ""}" data-id="${escapeHtml(item.id)}" data-type="${escapeHtml(item.type || "clips")}">
      <div class="project-main"><strong>${title}</strong><span>${date} · ${detail}</span></div>
      ${buttons}
    </div>`;
}

$("#project-list").addEventListener("click", async (event) => {
  const row = event.target.closest(".project-row");
  if (!row) return;
  const projectHash = (row.dataset.type === "story" ? "#/s/" : "#/p/") + row.dataset.id;
  if (event.target.closest(".open-project")) location.hash = projectHash;
  const resume = event.target.closest(".resume-project");
  if (resume) {
    resume.disabled = true;
    resume.textContent = "Se reia…";
    // Resuming can take hours: only jump to the project if the user is still on this list.
    const token = viewToken;
    try {
      await api(`/api/projects/${row.dataset.id}/resume`, { method: "POST", body: {} });
      if (token === viewToken) location.hash = projectHash;
    } catch (error) {
      if (token === viewToken) {
        alert(error.message);
        showProjects();
      }
    }
    return;
  }
  if (event.target.closest(".delete-project")) {
    if (!confirm("Ștergi proiectul și toate fișierele lui? Nu se poate anula.")) return;
    try {
      await api(`/api/projects/${row.dataset.id}`, { method: "DELETE" });
      row.remove();
      if (!$(".project-row", $("#project-list"))) $("#project-list").innerHTML = `<div class="empty-projects"><strong>Încă nu ai proiecte</strong><span>Lipește un link YouTube în „Creează Shorts” ca să începi primul set.</span></div>`;
    } catch (error) {
      alert(error.message);
    }
  }
});

/* ---------- results ---------- */

function renderLegacy(item) {
  $("#results-title").innerHTML = `Clipuri <span>vechi</span>`;
  $("#video-label").textContent = "Doar vizionare: acest proiect a fost creat înainte de editor.";
  grid.innerHTML = item.videos.map((video, index) => `
    <article class="clip-card">
      <video class="clip-video" controls preload="metadata" src="${escapeHtml(video)}"></video>
      <div class="clip-info">
        <h3 class="clip-name">Short ${index + 1}</h3>
        <div class="clip-actions"><a class="download-button" href="${escapeHtml(video)}" download="short-${index + 1}.mp4">Descarcă</a></div>
      </div>
    </article>`).join("");
}

function renderProject(project) {
  $("#results-title").innerHTML = `${project.clips.length} Shorts, <span>gata</span>`;
  $("#video-label").textContent = project.title;
  grid.innerHTML = "";
  if (project.selection === "reguli") grid.append(rulesNote(project));
  for (const clip of project.clips) grid.append(createCard(project, clip));
}

// Moments chosen by rules (AI unavailable): say why, and offer to choose again with the AI
// (reuses the downloaded video and the transcript).
function rulesNote(project) {
  const note = document.createElement("div");
  note.className = "selection-note";
  note.innerHTML = `<span>Momente alese după reguli${project.selectionNote ? ` (AI indisponibil: ${escapeHtml(project.selectionNote)})` : ""}.</span>
    <button class="text-button rechoose-button">Încearcă alte momente cu AI</button>`;
  $(".rechoose-button", note).addEventListener("click", async () => {
    if (!confirm("Clipurile și setările lor (zoom, video jos, pauze) se refac. Continui?")) return;
    const token = viewToken;
    showMessage("loading", "AI alege din nou momentele", "AI-ul alege în cel mult 12 minute (ce nu apucă se completează după reguli), apoi se descarcă cele trei segmente video. Poți închide pagina: proiectul se termină oricum.");
    try {
      const updated = await api(`/api/projects/${project.id}/rechoose`, { method: "POST", body: {} });
      if (token === viewToken) renderProject(updated);
    } catch (error) {
      if (token === viewToken) {
        alert(error.message);
        openProject(project.id);
      }
    }
  });
  return note;
}

function createCard(project, clip) {
  const card = document.createElement("article");
  card.className = "clip-card";
  const state = { zoom: clip.zoom, sat: clip.satisfyingOn, cut: clip.cutPauses === true, busy: false };
  // Pause cutting needs Whisper word timings; clips from older projects get them on the first „Aplică”.
  const canCut = () => clip.wordsSource !== "youtube";

  function info() {
    const seconds = Number(clip.duration) || clip.end - clip.start;
    const why = clip.source === "ai" && clip.reason
      ? `<p class="clip-reason">${escapeHtml(clip.reason)}</p>`
      : clip.source === "reguli" ? `<p class="clip-reason rules">ales după reguli</p>` : "";
    return `<h3 class="clip-name">${escapeHtml(clip.title || `Short ${clip.n}`)}</h3>
      ${why}
      <p class="clip-description">${escapeHtml(clip.caption)}</p>
      <div class="clip-meta"><span>${escapeHtml(clip.time)} · ${Math.round(seconds)} s</span><span class="clip-score">${clip.rank ? `LOCUL ${Number(clip.rank)} DIN 3` : escapeHtml(clip.score || "")}</span></div>`;
  }

  function showResult() {
    card.innerHTML = `
      <video class="clip-video" controls preload="metadata" src="${escapeHtml(clip.video)}"></video>
      <div class="clip-info">${info()}
        <div class="clip-actions">
          <button class="edit-button">Editează</button>
          <a class="download-button" href="${escapeHtml(clip.video)}" download="short-${clip.n}.mp4">Descarcă</a>
        </div>
      </div>`;
    $(".edit-button", card).addEventListener("click", showEditor);
  }

  function showEditor() {
    card.innerHTML = `
      <div class="stage">
        <div class="stage-top">
          <video class="stage-bg" muted playsinline preload="auto" src="${escapeHtml(clip.raw)}"></video>
          <video class="stage-fg" playsinline preload="auto" src="${escapeHtml(clip.raw)}"></video>
        </div>
        <div class="stage-bottom"><video class="stage-sat" muted loop playsinline preload="auto"></video></div>
        <div class="stage-sub">SUBTITRARE</div>
        <button class="stage-play" aria-label="Pornește previzualizarea">▶</button>
      </div>
      <div class="clip-info">${info()}
        <div class="editor">
          <label class="zoom-row">Zoom <input class="zoom-input" type="range" min="0" max="100" step="1"> <span class="zoom-value"></span></label>
          <div class="sat-row">
            <label><input class="sat-input" type="checkbox"> Video jos</label>
            <button class="reroll-button">↻ Alt video</button>
          </div>
          <div class="pause-row">
            <label><input class="pause-input" type="checkbox"> Taie pauzele</label>
            <span class="pause-hint"></span>
          </div>
          <div class="clip-actions">
            <button class="primary apply-button">Aplică</button>
            <button class="cancel-button">Renunță</button>
          </div>
          <p class="clip-error"></p>
        </div>
      </div>`;
    const fg = $(".stage-fg", card);
    const bg = $(".stage-bg", card);
    const sat = $(".stage-sat", card);
    const play = $(".stage-play", card);
    const zoomInput = $(".zoom-input", card);
    const satInput = $(".sat-input", card);
    zoomInput.value = Math.round(state.zoom * 100);
    satInput.checked = state.sat;
    const pauseInput = $(".pause-input", card);
    pauseInput.checked = state.cut && canCut();
    pauseInput.disabled = !canCut();
    $(".pause-hint", card).textContent = canCut() ? "Pauzele se taie la Aplică" : "Necesită transcriere Whisper";
    pauseInput.addEventListener("change", () => { state.cut = pauseInput.checked; });

    const syncOthers = () => {
      if (Math.abs(bg.currentTime - fg.currentTime) > 0.25) bg.currentTime = fg.currentTime;
      if (state.sat && sat.duration) {
        const target = fg.currentTime % sat.duration;
        if (Math.abs(sat.currentTime - target) > 0.25) sat.currentTime = target;
      }
    };
    const toggle = () => {
      if (fg.paused) { syncOthers(); fg.play(); bg.play(); if (state.sat) sat.play(); play.textContent = "❚❚"; }
      else { fg.pause(); bg.pause(); sat.pause(); play.textContent = "▶"; }
    };
    play.addEventListener("click", toggle);
    fg.addEventListener("timeupdate", syncOthers);
    fg.addEventListener("ended", () => { bg.pause(); sat.pause(); play.textContent = "▶"; });

    zoomInput.addEventListener("input", () => { state.zoom = zoomInput.value / 100; layoutStage(); });
    satInput.addEventListener("change", async () => {
      state.sat = satInput.checked;
      if (state.sat && !clip.satisfying) await pickSatisfying();
      layoutStage();
    });
    $(".reroll-button", card).addEventListener("click", async () => { await pickSatisfying(); layoutStage(); });
    $(".apply-button", card).addEventListener("click", apply);
    $(".cancel-button", card).addEventListener("click", () => { state.zoom = clip.zoom; state.sat = clip.satisfyingOn; state.cut = clip.cutPauses === true; showResult(); });
    layoutStage();
  }

  // Same formula as the ffmpeg render (layout.js), expressed in % of the top box.
  function layoutStage() {
    const top = $(".stage-top", card);
    if (!top) return;
    const box = Layout.boxFor(state.sat);
    const size = Layout.zoomSize(project.sourceWidth, project.sourceHeight, box.w, box.h, state.zoom);
    const fg = $(".stage-fg", card);
    const width = (size.w / box.w) * 100;
    const height = (size.h / box.h) * 100;
    Object.assign(fg.style, { width: `${width}%`, height: `${height}%`, left: `${(100 - width) / 2}%`, top: `${(100 - height) / 2}%` });
    top.style.height = state.sat ? "50%" : "100%";
    const bottom = $(".stage-bottom", card);
    bottom.classList.toggle("hidden", !state.sat);
    const sat = $(".stage-sat", card);
    if (state.sat && clip.satisfying && sat.getAttribute("src") !== clip.satisfying.preview) sat.src = clip.satisfying.preview;
    if (state.sat && !$(".stage-fg", card).paused) sat.play();
    $(".stage-sub", card).classList.toggle("split", state.sat);
    $(".zoom-value", card).textContent = Math.round(state.zoom * 100);
    $(".reroll-button", card).classList.toggle("hidden", !state.sat);
  }

  function setBusy(busy, label) {
    state.busy = busy;
    card.querySelectorAll(".editor input, .editor button").forEach((el) => { el.disabled = busy; });
    const pauseInput = $(".pause-input", card);
    if (pauseInput && !canCut()) pauseInput.disabled = true;
    const apply = $(".apply-button", card);
    if (apply) apply.textContent = busy && label ? label : "Aplică";
  }

  function setError(message) {
    const el = $(".clip-error", card);
    if (el) el.textContent = message || "";
  }

  async function pickSatisfying() {
    setError("");
    setBusy(true, "Caut un video…");
    try {
      clip.satisfying = await api("/api/satisfying", { method: "POST", body: { id: project.id, clip: clip.n } });
    } catch (error) {
      state.sat = false;
      const input = $(".sat-input", card);
      if (input) input.checked = false;
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setError("");
    setBusy(true, "Se randează…");
    try {
      const updated = await api("/api/render", { method: "POST", body: { id: project.id, clip: clip.n, zoom: state.zoom, satisfying: state.sat, cutPauses: state.cut && canCut() } });
      Object.assign(clip, updated);
      showResult();
    } catch (error) {
      setBusy(false);
      setError(error.message);
    }
  }

  showResult();
  return card;
}

route();
