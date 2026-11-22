import { type AccountMap, assertProfile, resolveTarget } from "./accounts.ts";
import { classifyStage } from "./stages.ts";
import { defaultTags } from "./tags.ts";

export interface FoundationAppOptions {
  /** App name, e.g. "acme-site". Also the `app` tag. */
  name: string;
  /** Client slug, e.g. "acme". Also the `client` tag. */
  client: string;
  accounts: AccountMap;
}

/**
 * Use as the `app()` function in sst.config.ts. SST forbids top-level imports there, so import
 * dynamically inside `app()`:
 *   app: async (input) => {
 *     const { foundationApp } = await import("sst-foundation");
 *     return foundationApp({ name, client, accounts }, input);
 *   }
 * NOTE: `defaultTags` and `allowedAccountIds` are Pulumi AWS provider options; whether SST passes
 * them through `providers.aws` is not yet verified (see docs/usage.md, Known limitations).
 */
export function foundationApp(
  opts: FoundationAppOptions,
  input: { stage: string },
  environ: Record<string, string | undefined> = process.env,
) {
  const policy = classifyStage(input.stage);
  const target = resolveTarget(opts.accounts, input.stage, policy.env);
  assertProfile(target, environ);
  const inCI = environ.GITHUB_ACTIONS === "true";
  const protect = policy.protect && !teardownOverride(opts.name, input.stage, environ);

  return {
    name: opts.name,
    home: "aws" as const,
    removal: policy.removal,
    protect,
    providers: {
      aws: {
        ...(inCI ? {} : { profile: target.profile }),
        region: target.region,
        allowedAccountIds: [target.account],
        defaultTags: {
          tags: defaultTags({ client: opts.client, app: opts.name, policy }),
        },
      },
    },
  };
}

/** Env var set only by the teardown job of `app-ops.yml`: `<app>/production`. */
export const TEARDOWN_OVERRIDE_VAR = "SST_FOUNDATION_TEARDOWN";

/**
 * Production is `protect: true`, so SST refuses `sst remove`. The teardown job lifts that for exactly one app's
 * production by setting SST_FOUNDATION_TEARDOWN=<app>/production. `removal` stays `retain`: SST removes the stage
 * and keeps stateful resources (buckets, tables). Any other value, app or stage leaves protection on.
 */
export function teardownOverride(app: string, stage: string, environ: Record<string, string | undefined>): boolean {
  return stage === "production" && environ[TEARDOWN_OVERRIDE_VAR] === `${app}/production`;
}
