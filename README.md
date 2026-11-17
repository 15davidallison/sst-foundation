# sst-foundation

Opinionated SST defaults for web apps. An sst-foundation app gets a consistent stage model, resource tagging,
account targeting and CI/CD by calling one function and one reusable workflow, instead of re-deriving
them per app.

- **Stages with built-in policy.** `production` (retained, protected), `staging`, `dev-<name>`, and
  per-PR `pr-<n>` previews (15 min TTL). Any other name is rejected, so a typo can't create a stray
  environment.
- **Required tags on every resource:** `client`, `app`, `env`, `stage`, `managed-by`. Prod and non-prod
  can share an AWS account and still be separable in cost reports.
- **One stage → account map per app.** Moving an app between AWS accounts is a one-file edit plus a
  redeploy. Deploys are pinned to the expected account and refuse a mismatching `AWS_PROFILE`.
- **Default CI/CD** as a reusable GitHub Actions workflow: lint, typecheck, test, OIDC deploy (no stored
  AWS keys), smoke check. Customizable per app.
- **Versioned.** Apps pin a git tag and upgrade one at a time. See [CHANGELOG.md](CHANGELOG.md).

Detailed options, troubleshooting and verification status: [docs/usage.md](docs/usage.md).

## Quickstart (new app)

Prerequisites: an SST v4 app, a GitHub repo, and an AWS account with a GitHub OIDC deploy role.

1. Install, pinned to a release tag:

   ```
   npm i --save-exact github:15davidallison/sst-foundation#v0.3.0
   ```

   Also set `"allowImportingTsExtensions": true` in your `tsconfig.json`. The package ships TypeScript
   source, and your typecheck reads it.

2. Declare where stages deploy, in `accounts.ts`:

   ```ts
   import type { AccountMap } from "sst-foundation";

   export const accounts: AccountMap = {
     production: { account: "123456789012", profile: "acme-power", region: "us-west-2" },
     nonprod: { account: "123456789012", profile: "acme-power", region: "us-west-2" },
   };
   ```

3. Use it in `sst.config.ts`:

   ```ts
   /// <reference path="./.sst/platform/config.d.ts" />

   // SST forbids top-level imports in this file, so import dynamically inside the functions.
   export default $config({
     app: async (input) => {
       const { foundationApp } = await import("sst-foundation");
       const { accounts } = await import("./accounts");
       return foundationApp({ name: "acme-site", client: "acme", accounts }, input);
     },
     async run() {
       // your resources
     },
   });
   ```

   Stages must be `production`, `staging`, `dev-<name>` or `pr-<number>`. SST's default stage (your
   username) is rejected, so pass one: `npx sst dev --stage dev-<name>`.

4. Call the default workflow from `.github/workflows/ci.yml`:

   ```yaml
   name: ci
   on:
     pull_request:
     push:
       branches: [main]
   permissions:
     contents: read
   jobs:
     ci:
       uses: 15davidallison/sst-foundation/.github/workflows/app-ci.yml@v0.3.0
       permissions:
         contents: read
         id-token: write
       with:
         deploy-stage: staging
         role-arn: ${{ vars.AWS_DEPLOY_ROLE_ARN }}
         production-stage: production # optional: staging -> smoke -> production
   ```

## Best practices

- **Stage names are the only environment switch.** Never branch on environment in app code.
- **Pin sst-foundation by tag**, and upgrade apps one at a time. Read the changelog before bumping.
- **No account IDs or profiles outside `accounts.ts`.**
- **No AWS keys in CI.** Deploy through the OIDC role; leave `role-arn` empty for checks-only.
- **Secrets are referenced, not written.** Use `sst.Secret` and set values out of band
  (`sst secret set <Name> --stage <stage>`). Never put values in code, fixtures, logs or docs.
- **Always pass the intended profile locally** and never rely on a default. If your shell exports
  `AWS_PROFILE`, run SST as `env -u AWS_PROFILE sst ...`.
- **Keep the deploy workflow's `main` gate.** Only `main` deploys; PRs run checks.

## Handing an app off (eject)

sst-foundation ships plain TypeScript source with no build step, no runtime dependencies and no network
calls, so an app can drop it without a rewrite:

1. Copy `node_modules/sst-foundation/src` into the app (for example `infra/foundation/`).
2. Change the `import("sst-foundation")` in `sst.config.ts` to the local path, and remove the dependency.
3. Copy `.github/workflows/app-ci.yml` into the app's own workflows and call it locally.

The license (MIT) lets anyone keep and modify the code.

## About

An independent project, not affiliated with or endorsed by the SST project. Licensed under MIT; see
[LICENSE](LICENSE).

## Develop sst-foundation itself

```
npm ci
npm run lint && npm run typecheck && npm test
```

Changes to `main` go through pull requests. Release by tagging (`vX.Y.Z`) and adding a
[CHANGELOG.md](CHANGELOG.md) entry.
