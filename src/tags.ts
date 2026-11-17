import type { StagePolicy } from "./stages.ts";

export interface TagInput {
  client: string;
  app: string;
  policy: StagePolicy;
}

/** Required tags on every resource. `client`, `app`, `env` must be activated as cost-allocation tags. */
export function defaultTags({ client, app, policy }: TagInput): Record<string, string> {
  return {
    client,
    app,
    env: policy.env,
    stage: policy.stage,
    "managed-by": "sst",
  };
}
