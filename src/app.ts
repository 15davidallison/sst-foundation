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

  return {
    name: opts.name,
    home: "aws" as const,
    removal: policy.removal,
    protect: policy.protect,
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
