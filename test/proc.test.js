const test = require("node:test");
const assert = require("node:assert/strict");
const { run } = require("../proc");

test("run: a multi-byte character split across two output chunks stays intact", async () => {
  // "ș" is 0xC8 0x99 in UTF-8; write the two bytes in separate chunks with a pause between.
  const script = "process.stdout.write(Buffer.from([0x50,0xC8]));setTimeout(()=>process.stdout.write(Buffer.from([0x99,0x41])),50);";
  const out = await run(process.execPath, ["-e", script]);
  assert.equal(out, "PșA");
});

test("run: a failing command rejects with its exit code and stderr tail", async () => {
  await assert.rejects(run(process.execPath, ["-e", "console.error('bad thing');process.exit(3)"]), (error) => {
    assert.equal(error.exitCode, 3);
    assert.match(error.message, /bad thing/);
    return true;
  });
});
