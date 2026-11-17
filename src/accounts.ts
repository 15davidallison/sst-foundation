import type { Env } from "./stages.ts";

/** Where a stage deploys. Account IDs are non-secret identifiers. */
export interface Target {
  account: string;
  /** Local SSO profile. Not used in GitHub Actions (OIDC credentials come from the environment). */
  profile: string;
  region: string;
}

/**
 * The one checked-in map from stage to target. Moving an app between accounts means editing this
 * and redeploying; prod in its own account is just a different `production` entry.
 */
export interface AccountMap {
  production: Target;
  nonprod: Target;
  /** Exact-stage overrides, e.g. send one personal dev stage somewhere else. */
  overrides?: Record<string, Target>;
}

export function resolveTarget(map: AccountMap, stage: string, env: Env): Target {
  return map.overrides?.[stage] ?? map[env];
}

/**
 * Refuse to run if AWS_PROFILE disagrees with the pinned profile (SST lets AWS_PROFILE win over config).
 * No default account: a mismatch is an error, never a silent switch.
 */
export function assertProfile(
  target: Target,
  environ: Record<string, string | undefined> = process.env,
): void {
  if (environ.GITHUB_ACTIONS === "true") return;
  if (environ.AWS_PROFILE && environ.AWS_PROFILE !== target.profile) {
    throw new Error(
      `AWS_PROFILE=${environ.AWS_PROFILE} does not match pinned profile ${target.profile}. Unset it (or run: env -u AWS_PROFILE sst ...).`,
    );
  }
}
