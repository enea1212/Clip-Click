const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const P = require("../projects");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cliptrei-"));
const ID = (n) => `00000000-0000-4000-8000-00000000000${n}`;

test("ids: only UUIDs are valid", () => {
  assert.equal(P.isValidId("7bb46251-cf59-437a-b47a-994b472c24da"), true);
  for (const bad of ["../etc", "..\\x", "", "7bb46251-cf59-437a-b47a-994b472c24dZ", undefined]) assert.equal(P.isValidId(bad), false, String(bad));
});

test("save then read round-trips; invalid or missing id reads null", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, ID(1)));
  P.saveProject(dir, { id: ID(1), title: "T", clips: [] });
  assert.equal(P.readProject(dir, ID(1)).title, "T");
  assert.equal(fs.existsSync(path.join(dir, ID(1), "project.json.tmp")), false);
  assert.equal(P.readProject(dir, ID(2)), null);
  assert.equal(P.readProject(dir, "../x"), null);
});

test("list: new projects first, legacy folders marked, empty and corrupt folders skipped", () => {
  const dir = tmp();
  for (const n of [1, 2, 3, 4, 5]) fs.mkdirSync(path.join(dir, ID(n)));
  P.saveProject(dir, { id: ID(1), title: "A", createdAt: "2026-01-01T00:00:00.000Z", clips: [{}, {}, {}] });
  P.saveProject(dir, { id: ID(2), title: "B", createdAt: "2026-02-01T00:00:00.000Z", clips: [{}, {}, {}] });
  fs.writeFileSync(path.join(dir, ID(3), "short-1.mp4"), "");
  fs.utimesSync(path.join(dir, ID(3)), new Date("2025-06-01"), new Date("2025-06-01"));
  fs.writeFileSync(path.join(dir, ID(5), "project.json"), "{broken");
  fs.mkdirSync(path.join(dir, "not-a-project"));
  const list = P.listProjects(dir);
  assert.deepEqual(list.map((p) => p.id), [ID(2), ID(1), ID(3)]);
  assert.equal(list[0].legacy, false);
  assert.equal(list[0].clipCount, 3);
  assert.equal(list[2].legacy, true);
  assert.deepEqual(list[2].videos, [`/data/${ID(3)}/short-1.mp4`]);
});

test("delete removes the folder and rejects bad ids", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, ID(1)));
  fs.writeFileSync(path.join(dir, ID(1), "short-1.mp4"), "");
  assert.equal(P.deleteProject(dir, "../" + ID(1)), false);
  assert.equal(P.deleteProject(dir, ID(1)), true);
  assert.equal(fs.existsSync(path.join(dir, ID(1))), false);
});

test("satisfying: allowed extensions only, missing folder gives []", () => {
  const dir = tmp();
  for (const f of ["d.webm", "a.MP4", "c.txt", "b.mkv"]) fs.writeFileSync(path.join(dir, f), "");
  assert.deepEqual(P.listSatisfying(dir), ["a.MP4", "b.mkv", "d.webm"]);
  assert.deepEqual(P.listSatisfying(path.join(dir, "missing")), []);
});

test("pick: start within range; short file starts at 0; empty list throws the Romanian message", async () => {
  assert.deepEqual(await P.pickSatisfying(["x.mp4"], async () => 100, 34, () => 0.5), { file: "x.mp4", start: 33 });
  assert.deepEqual(await P.pickSatisfying(["x.mp4"], async () => 20, 34, () => 0.9), { file: "x.mp4", start: 0 });
  await assert.rejects(P.pickSatisfying([], async () => 0, 34), /satisfying\//);
});

test("safe names reject traversal", () => {
  for (const bad of ["../x.mp4", "a\\b.mp4", "a/b.mp4", "x.exe", ""]) assert.equal(P.safeSatisfyingName(bad), false, bad);
  assert.equal(P.safeSatisfyingName("slime.mp4"), true);
});

test("updateClip merges into the latest saved state (no lost updates between clips)", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, ID(1)));
  P.saveProject(dir, { id: ID(1), title: "T", clips: [{ n: 1, zoom: 1 }, { n: 2, zoom: 1 }] });
  const stale = P.readProject(dir, ID(1));
  P.updateClip(dir, ID(1), 2, { zoom: 0, video: "/data/x/short-2-2.mp4" });
  const merged = P.updateClip(dir, ID(1), 1, { zoom: 0.5 });
  assert.equal(merged.zoom, 0.5);
  const saved = P.readProject(dir, ID(1));
  assert.equal(saved.clips[1].zoom, 0);
  assert.equal(saved.clips[1].video, "/data/x/short-2-2.mp4");
  assert.equal(stale.clips[1].zoom, 1);
});

test("locks: per-clip keys block the same clip and mark the whole project busy", () => {
  const locks = P.createLocks();
  assert.equal(locks.acquire(`${ID(1)}:1`), true);
  assert.equal(locks.acquire(`${ID(1)}:1`), false);
  assert.equal(locks.acquire(`${ID(1)}:2`), true);
  assert.equal(locks.isProjectBusy(ID(1)), true);
  assert.equal(locks.isProjectBusy(ID(2)), false);
  locks.release(`${ID(1)}:1`);
  locks.release(`${ID(1)}:2`);
  assert.equal(locks.isProjectBusy(ID(1)), false);
});

test("list: folders without a readable project.json but with files are shown so they can be deleted", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, ID(1)));
  fs.writeFileSync(path.join(dir, ID(1), "source.mp4"), "");
  fs.writeFileSync(path.join(dir, ID(1), "short-1-123.mp4"), "");
  fs.mkdirSync(path.join(dir, ID(2)));
  fs.writeFileSync(path.join(dir, ID(2), "project.json"), "{}");
  fs.writeFileSync(path.join(dir, ID(2), "source.mp4"), "");
  const list = P.listProjects(dir);
  const one = list.find((p) => p.id === ID(1));
  assert.equal(one.legacy, true);
  assert.deepEqual(one.videos, [`/data/${ID(1)}/short-1-123.mp4`]);
  const two = list.find((p) => p.id === ID(2));
  assert.equal(two.legacy, true);
  assert.equal(two.clipCount, 0);
});

test("gameplay start is clamped if the file became shorter after it was picked", () => {
  assert.equal(P.clampSatisfyingStart(80, 100, 34), 66);
  assert.equal(P.clampSatisfyingStart(80, 20, 34), 0);
  assert.equal(P.clampSatisfyingStart(10, 100, 34), 10);
  assert.equal(P.clampSatisfyingStart(10, 0, 34), 0);
});

test("heavy lock: only one processing job at a time", () => {
  const locks = P.createLocks();
  assert.equal(locks.heavyBusy(), false);
  assert.equal(locks.acquireHeavy(), true);
  assert.equal(locks.heavyBusy(), true);
  assert.equal(locks.acquireHeavy(), false);
  locks.releaseHeavy();
  assert.equal(locks.heavyBusy(), false);
  assert.equal(locks.acquireHeavy(), true);
});
