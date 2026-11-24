// Animated stories UI: the script screen (#/story/new) and the storyboard editor (#/s/<id>),
// layout 2B chosen by Enea (grid of 9:16 frames + a side panel for the selected scene).
// Loaded before app.js: its helpers ($, api, showView, escapeHtml, viewToken, refreshWhileOpen)
// are only used inside functions, when app.js has run.

const STORY_LABELS = {
  camera: { static: "fixă", "zoom-in": "apropiere", "zoom-out": "depărtare", "pan-left": "panoramare stânga", "pan-right": "panoramare dreapta" },
  expression: { neutral: "neutru", happy: "fericit", angry: "furios", surprised: "surprins", sad: "trist", smug: "șmecher" },
  position: { left: "stânga", center: "centru", right: "dreapta" },
  overlay: { "": "fără", badge: "badge (cifră mare)", sign: "panou cu text", money: "bani care cad", flash: "flash", emoji: "emoji" },
};
const WORDS_PER_SECOND = 2.6;
const storyState = { project: null, selected: 0, busy: false };

const storyEl = (id) => document.getElementById(id);
const countWords = (text) => String(text).trim().split(/\s+/).filter(Boolean).length;
const options = (labels, current) => Object.entries(labels).map(([value, label]) => `<option value="${value}"${value === (current ?? "") ? " selected" : ""}>${label}</option>`).join("");

/* ---------- script screen ---------- */

function showStoryNew() {
  showView("storyNew");
  storyEl("story-create-status").innerHTML = "";
  storyEl("story-text").focus();
}

function updateStoryCount() {
  const words = countWords(storyEl("story-text").value);
  storyEl("story-count").innerHTML = `${words} cuvinte · ~${Math.max(1, Math.round(words / WORDS_PER_SECOND))} s de voce · replicile se scriu <b>NUME: replica</b>`;
}

storyEl("story-text").addEventListener("input", updateStoryCount);
storyEl("story-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = storyEl("story-create");
  const script = storyEl("story-text").value.trim();
  const language = document.querySelector('input[name="story-lang"]:checked').value;
  if (countWords(script) < 4) { alert("Scrie mai întâi povestea."); return; }
  button.disabled = true;
  const started = Date.now();
  const status = storyEl("story-create-status");
  const tick = () => {
    const seconds = Math.round((Date.now() - started) / 1000);
    status.innerHTML = `<div class="processing-state"><div class="loader"></div><strong>Pregătesc scenele… ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}</strong><span>AI-ul împarte povestea în scene (~3–5 min), apoi se generează decorurile (~20 s fiecare). Poți închide pagina: povestea apare în „Proiectele mele”.</span></div>`;
  };
  tick();
  const timer = setInterval(tick, 1000);
  try {
    const project = await api("/api/stories", { method: "POST", body: { language, script } });
    storyEl("story-text").value = "";
    updateStoryCount();
    location.hash = `#/s/${project.id}`;
    status.innerHTML = "";
  } catch (error) {
    status.innerHTML = `<div class="processing-error"><strong>Nu am putut pregăti povestea</strong><span>${escapeHtml(error.message)}${error.resumable ? " O poți relua din „Proiectele mele”." : ""}</span></div>`;
  } finally {
    clearInterval(timer);
    button.disabled = false;
  }
});

/* ---------- storyboard editor ---------- */

function storyMessage(kind, title, text) {
  storyEl("story-body").innerHTML = kind === "loading"
    ? `<div class="processing-state"><div class="loader"></div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span></div>`
    : `<div class="processing-error"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span></div>`;
}

async function openStory(id) {
  showView("story");
  const token = viewToken;
  storyEl("story-title").innerHTML = `Povestea <span>ta</span>`;
  storyMessage("loading", "Se încarcă povestea", "");
  try {
    const project = await api(`/api/projects/${id}`);
    if (token !== viewToken) return;
    storyEl("story-title").textContent = project.title || "Poveste";
    if (project.status === "failed") return storyMessage("error", "Poveste incompletă", `${project.error || ""} O poți relua din „Proiectele mele” cu „Reia”.`);
    if (!["editing", "ready"].includes(project.status)) {
      storyMessage("loading", stageLabel(project), "Pagina se actualizează singură.");
      return refreshWhileOpen(() => openStory(id), token);
    }
    if (storyState.project?.id !== id) storyState.selected = 0;
    storyState.project = project;
    renderStory();
  } catch (error) {
    if (token === viewToken) storyMessage("error", "Nu am putut deschide povestea", error.message);
  }
}

const decorUrl = (project, decorId) => `/data/${project.id}/decor-${decorId}.png?v=${project.decorVersions?.[decorId] || 0}`;

function renderStory() {
  const { project } = storyState;
  const { story } = project;
  const words = countWords(story.scenes.map((s) => s.text).join(" "));
  storyEl("story-kicker").innerHTML = `<span class="eyebrow-icon" aria-hidden="true">✦</span> POVESTE · ${story.scenes.length} SCENE · ~${Math.round(words / WORDS_PER_SECOND)} S`;
  const note = project.storyNote ? `<div class="selection-note"><span>Scenele au fost făcute după reguli (${escapeHtml(project.storyNote)}). Le poți ajusta mai jos.</span></div>` : "";
  storyEl("story-body").innerHTML = `
    ${note}
    <div class="story-board">
      <div>
        <div class="story-strip">${story.scenes.map((scene, index) => `
          <button type="button" class="story-frame${index === storyState.selected ? " on" : ""}" data-index="${index}" aria-label="Scena ${index + 1}">
            <img src="${decorUrl(project, scene.decor)}" alt="" loading="lazy" />
            <span class="story-num">${String(index + 1).padStart(2, "0")}</span>
            ${scene.speaker ? `<span class="story-who">${escapeHtml(scene.speaker)}</span>` : ""}
            <span class="story-cap">${escapeHtml(scene.text)}</span>
          </button>`).join("")}
        </div>
        <div class="story-output" id="story-output">${outputHtml(project)}</div>
      </div>
      <aside class="story-side" id="story-side"></aside>
    </div>`;
  renderSide();
}

function outputHtml(project) {
  const parts = [];
  if (project.video) {
    parts.push(`<div class="story-video"><video controls playsinline preload="metadata" src="${escapeHtml(project.video)}"></video>
      <div><strong>Video final</strong><span class="story-note">Pe TikTok, marchează videoul ca „generat cu AI”.</span>
      <a class="submit-button story-download" href="${escapeHtml(project.video.split("?")[0])}" download="poveste.mp4"><span>Descarcă</span></a></div></div>`);
  }
  if (project.preview) {
    parts.push(`<div class="story-video small"><video controls playsinline preload="metadata" src="${escapeHtml(project.preview)}"></video>
      <div><strong>Previzualizare</strong><span class="story-note">Rezoluție mică, doar pentru ritm și încadrare.</span></div></div>`);
  }
  return parts.join("") || `<p class="story-note">Apasă „Previzualizare” ca să vezi ritmul poveștii (~1 min), apoi „Creează video”.</p>`;
}

function renderSide() {
  const { project, selected } = storyState;
  const { story } = project;
  const scene = story.scenes[selected];
  const decor = story.decors.find((d) => d.id === scene.decor);
  const uses = story.scenes.filter((s) => s.decor === scene.decor).length;
  const handPlaced = (project.handPlaced || []).includes(decor.id);
  const names = story.characters.map((c) => c.name);
  storyEl("story-side").innerHTML = `
    <div class="story-preview">
      <img src="${decorUrl(project, scene.decor)}" alt="Decorul scenei" />
      <div class="story-stack">
        <h3>Scena ${selected + 1}</h3>
        <p class="story-quote">${scene.speaker ? `<b>${escapeHtml(scene.speaker)}:</b> ` : ""}${escapeHtml(scene.text)}</p>
        <button class="text-button" type="button" data-act="regen" title="Schimbă imaginea în toate scenele care folosesc decorul">↻ Regenerează decorul${uses > 1 ? ` (${uses} scene)` : ""}</button>
        <button class="text-button" type="button" data-act="newdecor" title="Un decor nou, după descrierea de mai jos, doar pentru scena asta">＋ Decor nou doar aici</button>
        <label class="text-button story-upload">⤒ Încarcă imagine<input type="file" accept="image/png,image/jpeg,image/webp" data-act="upload" hidden /></label>
        <span class="story-note" id="story-decor-status">${handPlaced ? "Imagine încărcată de tine." : "~20 s pentru un decor nou."}</span>
      </div>
    </div>
    <div class="story-fields">
      <div class="full"><label class="story-label" for="story-prompt">Descrierea decorului (în ${uses} ${uses === 1 ? "scenă" : "scene"})</label>
        <input id="story-prompt" value="${escapeHtml(decor.prompt)}" maxlength="300" /></div>
      ${story.decors.length > 1 ? `<div class="full"><label class="story-label" for="story-decor">Folosește alt decor</label><select id="story-decor">${story.decors.map((d) => `<option value="${escapeHtml(d.id)}"${d.id === scene.decor ? " selected" : ""}>${escapeHtml(d.id)} — ${escapeHtml(d.prompt.slice(0, 40))}</option>`).join("")}</select></div>` : ""}
      <div><label class="story-label" for="story-camera">Cameră</label><select id="story-camera">${options(STORY_LABELS.camera, scene.camera)}</select></div>
      <div><label class="story-label" for="story-overlay">Grafic</label><select id="story-overlay">${options(STORY_LABELS.overlay, scene.overlay?.type || "")}</select></div>
      ${scene.overlay && ["badge", "sign", "emoji"].includes(scene.overlay.type) ? `<div class="full"><label class="story-label" for="story-overlay-text">Textul graficului</label><input id="story-overlay-text" value="${escapeHtml(scene.overlay.text)}" maxlength="40" /></div>` : ""}
      <div class="full"><span class="story-label">Personaje</span>
        <div class="story-people">${scene.characters.map((c, i) => `
          <div class="story-person" data-i="${i}">
            <select data-field="name">${names.map((n) => `<option${n === c.name ? " selected" : ""}>${escapeHtml(n)}</option>`).join("")}</select>
            <select data-field="expression">${options(STORY_LABELS.expression, c.expression)}</select>
            <select data-field="position">${options(STORY_LABELS.position, c.position)}</select>
            <button type="button" class="story-x" data-act="remove" aria-label="Scoate personajul"${c.name === scene.speaker ? " disabled title=\"Vorbește în scena asta\"" : ""}>✕</button>
          </div>`).join("") || `<span class="story-note">niciunul</span>`}
          ${names.length && scene.characters.length < 3 ? `<button type="button" class="text-button" data-act="add">+ Adaugă personaj</button>` : ""}
        </div>
      </div>
    </div>`;
}

// Saves the selected scene (camera, overlay, characters) and redraws with the server's answer.
async function saveScene(changes) {
  const { project, selected } = storyState;
  try {
    storyState.project = await api(`/api/stories/${project.id}/scene`, { method: "POST", body: { index: selected, ...changes } });
    renderStory();
  } catch (error) {
    alert(error.message);
    renderSide();
  }
}

function sceneCharacters() {
  return [...document.querySelectorAll("#story-side .story-person")].map((row) => ({
    name: row.querySelector('[data-field="name"]').value,
    expression: row.querySelector('[data-field="expression"]').value,
    position: row.querySelector('[data-field="position"]').value,
  }));
}

async function decorAction(work, busyText) {
  if (storyState.busy) return;
  storyState.busy = true;
  document.querySelectorAll("#story-side [data-act]").forEach((el) => { el.disabled = true; });
  storyEl("story-decor-status").textContent = busyText;
  try {
    storyState.project = await work();
    renderStory();
  } catch (error) {
    alert(error.message);
    renderSide();
  } finally {
    storyState.busy = false;
  }
}

storyEl("story-body").addEventListener("click", (event) => {
  const frame = event.target.closest(".story-frame");
  if (frame) {
    storyState.selected = Number(frame.dataset.index);
    document.querySelectorAll(".story-frame").forEach((el) => el.classList.toggle("on", el === frame));
    renderSide();
    if (window.matchMedia("(max-width: 900px)").matches) storyEl("story-side").scrollIntoView({ behavior: "smooth" });
    return;
  }
  const act = event.target.closest("[data-act]")?.dataset.act;
  const scene = storyState.project?.story.scenes[storyState.selected];
  if (act === "newdecor") {
    const prompt = storyEl("story-prompt").value.trim();
    decorAction(() => api(`/api/stories/${storyState.project.id}/new-decor`, { method: "POST", body: { index: storyState.selected, prompt } }), "Se generează decorul nou… (~30 s, ~1 min prima dată)");
  } else if (act === "regen") {
    const prompt = storyEl("story-prompt").value.trim();
    decorAction(() => api(`/api/stories/${storyState.project.id}/decor`, { method: "POST", body: { decor: scene.decor, prompt } }), "Se generează decorul… (~20 s, ~1 min prima dată)");
  } else if (act === "add") {
    const used = new Set(scene.characters.map((c) => c.name));
    const name = storyState.project.story.characters.map((c) => c.name).find((n) => !used.has(n)) || storyState.project.story.characters[0].name;
    saveScene({ characters: [...sceneCharacters(), { name, expression: "neutral", position: "center" }] });
  } else if (act === "remove") {
    const index = Number(event.target.closest(".story-person").dataset.i);
    saveScene({ characters: sceneCharacters().filter((_, i) => i !== index) });
  }
});

storyEl("story-body").addEventListener("change", (event) => {
  const target = event.target;
  if (target.dataset.act === "upload" && target.files[0]) {
    const file = target.files[0];
    if (file.size > 15 * 1024 * 1024) { alert("Imaginea e prea mare (cel mult 15 MB)."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const scene = storyState.project.story.scenes[storyState.selected];
      decorAction(() => api(`/api/stories/${storyState.project.id}/upload`, { method: "POST", body: { decor: scene.decor, data: reader.result } }), "Se încarcă imaginea…");
    };
    reader.readAsDataURL(file);
  } else if (target.id === "story-decor") {
    saveScene({ decor: target.value });
  } else if (target.id === "story-camera") {
    saveScene({ camera: target.value });
  } else if (target.id === "story-overlay" || target.id === "story-overlay-text") {
    const type = storyEl("story-overlay").value;
    const text = storyEl("story-overlay-text")?.value ?? (type === "badge" ? "100%" : type === "sign" ? "TEXT" : type === "emoji" ? "😮" : "");
    saveScene({ overlay: type ? { type, text } : null });
  } else if (target.closest(".story-person")) {
    saveScene({ characters: sceneCharacters() });
  }
});

async function storyRender(preview) {
  const { project } = storyState;
  if (!project || storyState.busy) return;
  storyState.busy = true;
  const buttons = [storyEl("story-preview"), storyEl("story-render")];
  buttons.forEach((b) => { b.disabled = true; });
  storyEl("story-output").innerHTML = `<div class="processing-state"><div class="loader"></div><strong>${preview ? "Fac previzualizarea…" : "Creez videoul…"}</strong><span>${preview ? "~1 min" : "~1–2 min (vocea se face o singură dată)"}. Nu închide pagina.</span></div>`;
  try {
    storyState.project = await api(`/api/stories/${project.id}/${preview ? "preview" : "render"}`, { method: "POST", body: {} });
    renderStory();
  } catch (error) {
    storyEl("story-output").innerHTML = `<div class="processing-error"><strong>Nu a mers</strong><span>${escapeHtml(error.message)}</span></div>`;
  } finally {
    storyState.busy = false;
    buttons.forEach((b) => { b.disabled = false; });
  }
}

storyEl("story-preview").addEventListener("click", () => storyRender(true));
storyEl("story-render").addEventListener("click", () => storyRender(false));
