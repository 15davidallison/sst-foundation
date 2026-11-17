import assert from "node:assert/strict";
import { test } from "node:test";
import { type AccountMap, assertProfile, classifyStage, defaultTags, foundationApp } from "../src/index.ts";

const sandbox = { account: "111111111111", profile: "x-power", region: "us-west-2" };
const accounts: AccountMap = { production: sandbox, nonprod: sandbox };

test("production is retained and protected", () => {
  const p = classifyStage("production");
  assert.deepEqual([p.env, p.removal, p.protect], ["production", "retain", true]);
});

test("nonprod stages are removable; previews carry a 15 min TTL", () => {
  assert.equal(classifyStage("staging").env, "nonprod");
  assert.equal(classifyStage("dev-alice").kind, "dev");
  const pr = classifyStage("pr-42");
  assert.equal(pr.kind, "preview");
  assert.equal(pr.ttlMinutes, 15);
  assert.equal(pr.removal, "remove");
});

test("unknown or malformed stage names throw", () => {
  for (const bad of ["prod", "sandbox", "pr-0", "pr-x", "dev-", "Dev-a", ""]) {
    assert.throws(() => classifyStage(bad), /Unknown stage/, bad);
  }
});

test("default tags include the required keys", () => {
  const tags = defaultTags({ client: "c", app: "a", policy: classifyStage("staging") });
  assert.deepEqual(tags, { client: "c", app: "a", env: "nonprod", stage: "staging", "managed-by": "sst" });
});

test("assertProfile rejects a mismatching AWS_PROFILE but ignores CI", () => {
  assert.throws(() => assertProfile(sandbox, { AWS_PROFILE: "other" }), /does not match/);
  assert.doesNotThrow(() => assertProfile(sandbox, { AWS_PROFILE: "x-power" }));
  assert.doesNotThrow(() => assertProfile(sandbox, { AWS_PROFILE: "other", GITHUB_ACTIONS: "true" }));
});

test("overrides win over the env mapping", () => {
  const other = { ...sandbox, account: "222222222222" };
  const app = foundationApp(
    { name: "a", client: "c", accounts: { ...accounts, overrides: { "dev-bob": other } } },
    { stage: "dev-bob" }, {},
  );
  assert.deepEqual(app.providers.aws.allowedAccountIds, ["222222222222"]);
});

test("foundationApp wires removal, protection and tags", () => {
  const app = foundationApp({ name: "a", client: "c", accounts }, { stage: "production" }, {});
  assert.equal(app.removal, "retain");
  assert.equal(app.protect, true);
  assert.equal(app.providers.aws.defaultTags.tags.env, "production");
});
