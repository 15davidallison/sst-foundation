// CloudFront helpers: stage-scoped names for edge resources, and the non-prod access gate.
// Design and IAM: offering/docs/runbooks/06-nonprod-edge.md.
import { createHash } from "node:crypto";

const MAX_EDGE_NAME = 64; // CloudFront Function and KeyValueStore names: [A-Za-z0-9_-]{1,64}

/**
 * `<app>-<stage>-<logical>`, sanitized for CloudFront. Names longer than 64 characters are
 * truncated and suffixed with a short hash of the full name, so they stay unique and keep the
 * `<app>-<stage>-` prefix that the deploy role's IAM policy scopes on.
 */
export function edgeResourceName(app: string, stage: string, logical: string): string {
  const full = `${app}-${stage}-${logical}`.replace(/[^A-Za-z0-9_-]/g, "-");
  if (full.length <= MAX_EDGE_NAME) return full;
  const hash = createHash("sha256").update(full).digest("hex").slice(0, 8);
  return `${full.slice(0, MAX_EDGE_NAME - 9)}-${hash}`;
}

/** The SST globals `applyEdgeNaming` needs, passed in so this module has no SST dependency. */
export interface EdgeNamingDeps {
  // biome-ignore lint/suspicious/noExplicitAny: SST's $transform is generic over Pulumi resource classes
  transform: (resource: any, cb: (args: any, opts: any, name: string) => void) => void;
  // biome-ignore lint/suspicious/noExplicitAny: the aws.cloudfront namespace from @pulumi/aws
  cloudfront: { Function: any; KeyValueStore: any };
  app: string;
  stage: string;
}

/**
 * Give every CloudFront Function and KeyValueStore a `<app>-<stage>-` name. SST auto-names them
 * otherwise, and the non-prod deploy role can only update or delete edge resources with its own
 * stage prefixes. Call it first thing in `run()`:
 *   applyEdgeNaming({ transform: $transform, cloudfront: aws.cloudfront, app: $app.name, stage: $app.stage });
 * Explicit names set by a component are left alone.
 */
export function applyEdgeNaming(deps: EdgeNamingDeps): void {
  for (const resource of [deps.cloudfront.Function, deps.cloudfront.KeyValueStore]) {
    deps.transform(resource, (args, _opts, name) => {
      args.name ??= edgeResourceName(deps.app, deps.stage, name);
    });
  }
}

/**
 * CloudFront Function code (for `edge.viewerRequest.injection` on a Router or site) that rejects
 * requests without the non-prod token. Accepts HTTP Basic auth (any user, token as password; what
 * browsers prompt for) or an `x-nonprod-token` header (agents, CI). Only the SHA-256 hex of the token
 * is embedded, so reading the function code does not reveal the token. Use a random token of at
 * least 32 bytes: a hash of a short or human-chosen password can be cracked offline.
 */
export function nonprodGateInjection(tokenSha256Hex: string): string {
  if (!/^[0-9a-f]{64}$/.test(tokenSha256Hex)) {
    throw new Error("nonprodGateInjection: expected the token's SHA-256 as 64 lowercase hex characters");
  }
  return `
  {
    const gateHeaders = event.request.headers;
    let gateToken = "";
    const gateAuth = gateHeaders.authorization ? gateHeaders.authorization.value : "";
    if (gateAuth.indexOf("Basic ") === 0) {
      const decoded = atob(gateAuth.slice(6));
      gateToken = decoded.slice(decoded.indexOf(":") + 1);
    } else if (gateHeaders["x-nonprod-token"]) {
      gateToken = gateHeaders["x-nonprod-token"].value;
    }
    if (!gateToken || require("crypto").createHash("sha256").update(gateToken).digest("hex") !== "${tokenSha256Hex}") {
      return {
        statusCode: 401,
        statusDescription: "Unauthorized",
        headers: {
          "www-authenticate": { value: 'Basic realm="non-production", charset="UTF-8"' },
          "cache-control": { value: "no-store" },
        },
      };
    }
    delete gateHeaders.authorization;
    delete gateHeaders["x-nonprod-token"];
  }
`;
}
