import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";
import { applyEdgeNaming, edgeResourceName, nonprodGateInjection } from "../src/index.ts";

test("edge names carry the app-stage prefix and fit CloudFront's limit", () => {
  assert.equal(edgeResourceName("donut-nook", "staging", "RouterKvStore"), "donut-nook-staging-RouterKvStore");
  assert.equal(edgeResourceName("a", "pr-7", "x.y z"), "a-pr-7-x-y-z");
  const long = edgeResourceName("donut-nook", "staging", "A".repeat(80));
  assert.equal(long.length, 64);
  assert.ok(long.startsWith("donut-nook-staging-"));
  assert.notEqual(long, edgeResourceName("donut-nook", "staging", `${"A".repeat(79)}B`));
});

test("applyEdgeNaming names Functions and KeyValueStores, keeps explicit names", () => {
  const cbs = new Map<unknown, (args: { name?: string }, opts: unknown, name: string) => void>();
  const Fn = class {};
  const Kvs = class {};
  applyEdgeNaming({
    transform: (r, cb) => cbs.set(r, cb),
    cloudfront: { Function: Fn, KeyValueStore: Kvs },
    app: "donut-nook",
    stage: "staging",
  });
  const a: { name?: string } = {};
  cbs.get(Fn)?.(a, {}, "RouterFn");
  assert.equal(a.name, "donut-nook-staging-RouterFn");
  const b = { name: "explicit" };
  cbs.get(Kvs)?.(b, {}, "Kv");
  assert.equal(b.name, "explicit");
});

// Runs the generated code the way CloudFront does: inside the viewer-request handler.
function gate(token: string) {
  const hash = createHash("sha256").update(token).digest("hex");
  const body = `${nonprodGateInjection(hash)}\nreturn event.request;`;
  const fn = new Function("event", "require", body) as (e: unknown, r: NodeRequire) => {
    statusCode?: number;
    headers: Record<string, { value: string }>;
  };
  const require = createRequire(import.meta.url);
  return (headers: Record<string, { value: string }>) => fn({ request: { headers } }, require);
}

test("gate: no or wrong token is 401 with a Basic challenge", () => {
  const run = gate(randomBytes(32).toString("hex"));
  const cases: Record<string, { value: string }>[] = [{}, { "x-nonprod-token": { value: "nope" } }, { authorization: { value: `Basic ${btoa("u:nope")}` } }];
  for (const headers of cases) {
    const res = run(headers);
    assert.equal(res.statusCode, 401);
    assert.match(res.headers["www-authenticate"].value, /^Basic /);
  }
});

test("gate: right token via Basic or header passes and the credential is stripped", () => {
  const token = randomBytes(32).toString("hex");
  const run = gate(token);
  const viaBasic = run({ authorization: { value: `Basic ${btoa(`anyone:${token}`)}` }, host: { value: "h" } });
  assert.equal(viaBasic.statusCode, undefined);
  assert.deepEqual(Object.keys(viaBasic.headers), ["host"]);
  const viaHeader = run({ "x-nonprod-token": { value: token } });
  assert.equal(viaHeader.statusCode, undefined);
  assert.deepEqual(Object.keys(viaHeader.headers), []);
});

test("gate rejects a hash that is not 64 lowercase hex", () => {
  assert.throws(() => nonprodGateInjection("ABC"), /64 lowercase hex/);
});
