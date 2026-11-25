import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";

// .github/actions/copy-secrets/copy.sh, run against a fake `npx` that plays `sst secret list` / `sst secret load`.
// The point: no secret value may ever reach the job log (offering run 45499115820 printed a line of a PEM key).
const script = new URL("../.github/actions/copy-secrets/copy.sh", import.meta.url).pathname;

function run(listOutput: string, loadFails = false) {
  const dir = mkdtempSync(join(tmpdir(), "copy-secrets-"));
  writeFileSync(join(dir, "list.txt"), listOutput);
  // load echoes "✓ Setting <line before =>" for every line, as SST does, and copies the file so the test can see it.
  writeFileSync(
    join(dir, "npx"),
    `#!/usr/bin/env bash
if [ "$3" = list ]; then cat "${dir}/list.txt"; exit 0; fi
if [ "$3" = load ]; then
  cp "$6" "${dir}/loaded.txt"
  while IFS= read -r l; do echo "✓  Setting \${l%%=*}"; done < "$6"
  ${loadFails ? 'echo "✕  Could not set secret" >&2; exit 1' : "exit 0"}
fi
exit 2
`,
  );
  chmodSync(join(dir, "npx"), 0o755);
  const r = spawnSync("bash", [script], {
    env: { PATH: `${dir}:${process.env.PATH}`, BASE_STAGE: "staging", STAGE: "pr-7", RUNNER_TEMP: dir },
    encoding: "utf8",
  });
  const loaded = existsSync(join(dir, "loaded.txt")) ? readFileSync(join(dir, "loaded.txt"), "utf8") : null;
  return { status: r.status, log: r.stdout + r.stderr, loaded };
}

const FAKE_KEY = ["-----BEGIN FAKE KEY-----", "QUJDREVGR0hJSktMTU5PUA/fakeline1", "UVJTVFVWV1hZWg==", "-----END FAKE KEY-----"].join("\n");

it("copies single-line secrets and logs only their names", () => {
  // Real `sst secret list` output: a `# <app>/<stage>` header and blank lines around the values.
  const list = "# offering/staging\nAppId=fake-123\n\nToken=fake=with=equals\n\n";
  const r = run(list);
  assert.equal(r.status, 0, r.log);
  assert.equal(r.loaded, list);
  assert.match(r.log, /Copied 2 secret value\(s\) from staging to pr-7/);
  assert.doesNotMatch(r.log, /AppId|Token|fake-123|with=equals|Setting/);
});

it("refuses a multi-line value, copies nothing and never prints its lines", () => {
  const r = run(`# offering/staging\nAppId=fake-123\nPrivateKey=${FAKE_KEY}\nOther=fake-456\n`);
  assert.equal(r.status, 1);
  assert.equal(r.loaded, null);
  assert.match(r.log, /spans several lines \(2 line\(s\) don't start with NAME=\)/);
  // UVJTVFVWV1hZWg== looks like NAME=: it must not be printed as a name either.
  for (const secret of ["fake-123", "fake-456", "QUJD", "UVJT", "BEGIN", "END FAKE", "PrivateKey"]) assert.ok(!r.log.includes(secret), secret);
});

it("does nothing when the base stage has no values", () => {
  const r = run("\n");
  assert.equal(r.status, 0);
  assert.equal(r.loaded, null);
  assert.match(r.log, /has no secret values/);
});

it("on a failed load shows SST's error lines, not its per-secret output", () => {
  const r = run("AppId=fake-123\n", true);
  assert.equal(r.status, 1);
  assert.match(r.log, /Could not set secret/);
  assert.doesNotMatch(r.log, /fake-123|AppId|Setting/);
});
