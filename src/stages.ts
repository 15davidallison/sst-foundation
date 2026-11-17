// Stage model. Spec: offering/docs/conventions.md. Stage names are the only environment switch.

export type StageKind = "production" | "staging" | "dev" | "preview";
export type Env = "production" | "nonprod";

export interface StagePolicy {
  stage: string;
  kind: StageKind;
  env: Env;
  removal: "retain" | "remove";
  protect: boolean;
  /** Preview stages are torn down this many minutes after their last deploy (best-effort). */
  ttlMinutes?: number;
}

export const PREVIEW_TTL_MINUTES = 15;

const DEV_STAGE = /^dev-[a-z0-9][a-z0-9-]{0,20}$/;
const PREVIEW_STAGE = /^pr-[1-9][0-9]*$/;

/** Classify a stage name. Throws on unknown names so typos can't create stray environments. */
export function classifyStage(stage: string): StagePolicy {
  if (stage === "production") {
    return { stage, kind: "production", env: "production", removal: "retain", protect: true };
  }
  if (stage === "staging") {
    return { stage, kind: "staging", env: "nonprod", removal: "remove", protect: false };
  }
  if (DEV_STAGE.test(stage)) {
    return { stage, kind: "dev", env: "nonprod", removal: "remove", protect: false };
  }
  if (PREVIEW_STAGE.test(stage)) {
    return {
      stage,
      kind: "preview",
      env: "nonprod",
      removal: "remove",
      protect: false,
      ttlMinutes: PREVIEW_TTL_MINUTES,
    };
  }
  throw new Error(
    `Unknown stage "${stage}". Allowed: production, staging, dev-<name>, pr-<number>.`,
  );
}
