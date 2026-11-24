// Keeps studio/imagegen.py --serve running, so the image model loads once (~40 s) and a decor
// regeneration takes ~20 s instead of ~60 s. One job at a time (queue); the process stops after
// `idleMs` without work and is started again on the next job. If it dies mid-job, that job fails
// and the next one starts a fresh process.
const { spawn } = require("node:child_process");
const { StringDecoder } = require("node:string_decoder");
const S = require("./studio");

function command() {
  const args = [S.script("imagegen.py"), "--serve"];
  // Tests: the same fake tools as proc.run.
  const fake = process.env.CLIPTREI_FAKE_TOOLS;
  return fake ? [process.execPath, [fake, S.studioPython(), ...args]] : [S.studioPython(), args];
}

function createImageWorker({ idleMs = 600_000 } = {}) {
  let child = null;
  let pending = null;
  let timer = null;
  let queue = Promise.resolve();

  function start() {
    const [cmd, args] = command();
    const proc = spawn(cmd, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => {
      buffer += decoder.write(chunk);
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line || !pending) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        const done = pending;
        pending = null;
        if (message.ok) done.resolve(message.items || []);
        else done.reject(new Error(`Generarea imaginilor a eșuat: ${message.error || "eroare necunoscută"}`));
      }
    });
    proc.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString("utf8")).slice(-2000); });
    proc.stdin.on("error", () => { /* the exit handler reports it */ });
    proc.on("exit", (code) => {
      if (child === proc) child = null;
      if (pending) {
        const done = pending;
        pending = null;
        const tail = stderr.trim().split("\n").slice(-3).join(" ");
        done.reject(new Error(`Procesul de imagini s-a oprit (cod ${code})${tail ? `: ${tail}` : ""}`));
      }
    });
    proc.on("error", (error) => { if (pending) { const done = pending; pending = null; done.reject(error); } });
    return proc;
  }

  function armIdle() {
    clearTimeout(timer);
    timer = setTimeout(stop, idleMs);
    timer.unref?.();
  }

  function stop() {
    clearTimeout(timer);
    if (!child) return;
    const proc = child;
    child = null;
    try { proc.stdin.end(); } catch { /* already closed */ }
    proc.kill();
  }

  function run(jobs) {
    const task = queue.then(() => new Promise((resolve, reject) => {
      clearTimeout(timer);
      if (!child) child = start();
      pending = { resolve, reject };
      child.stdin.write(`${JSON.stringify(jobs)}\n`);
    }));
    queue = task.catch(() => {}).then(armIdle);
    return task;
  }

  return { run, stop };
}

module.exports = { createImageWorker };
