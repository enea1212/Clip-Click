const { spawn } = require("node:child_process");

// Runs a command and resolves with its trimmed stdout. Output is collected as raw bytes and
// decoded once at the end, so a multi-byte UTF-8 character (ș, ț, ă…) split across two pipe
// chunks is never corrupted. On failure the error carries the exit code and the stderr tail.
function run(command, args, options = {}) {
  // Tests only: route yt-dlp/ffmpeg/ffprobe/python through a fake script (see testing/fake-tools.js).
  const fake = process.env.CLIPTREI_FAKE_TOOLS;
  if (fake) [command, args] = [process.execPath, [fake, command, ...args]];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    const out = [];
    const err = [];
    child.stdout?.on("data", (chunk) => out.push(chunk));
    child.stderr?.on("data", (chunk) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const stdout = Buffer.concat(out).toString("utf8");
      if (code === 0) return resolve(stdout.trim());
      const stderr = Buffer.concat(err).toString("utf8");
      const error = new Error(stderr.trim().split("\n").slice(-5).join("\n") || `${command} exited with ${code}`);
      error.exitCode = code;
      reject(error);
    });
  });
}

module.exports = { run };
