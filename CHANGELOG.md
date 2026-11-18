# Changelog

Release notes per released version (not per commit). Apps pin a tag; read the entry before upgrading.
Each entry summarizes what changed for consumers; breaking changes are marked **BREAKING** with
upgrade steps.

## Unreleased

Preview stages. Backwards compatible: nothing changes unless you set `preview: true`. Not yet proven on a real PR.
- `app-ci.yml`: new inputs `preview` (default `false`) and `preview-comment` (default `true`). On a pull request whose head branch starts with `preview-branch-prefix` (default `preview/`; ordinary PRs get no preview) it deploys `pr-<n>` with the non-prod role, smoke-tests it, and posts/updates one comment with the URL. Skipped for Dependabot PRs (by PR author) and fork PRs.
- Previews inherit secret values from a base stage (input `preview-base-stage`, default `staging`; refuses production): the preview job copies them with `sst secret list`/`load` through a private temp file on every deploy. A secret missing on the base stage fails the deploy with an error naming the secret and the `sst secret set <NAME> <value> --stage staging` command.
- New `preview-cleanup.yml`: removes `pr-<n>` on PR close (a no-op if the PR had no preview), deleting the stage's empty state object afterwards so the sweep does not repeat it, and on a schedule removes `pr-*` stages whose state was last written more than `ttl-minutes` (default 15) ago.
- Upgrade: **the caller's `ci` job must grant `pull-requests: write`** even with `preview: false`; GitHub refuses to start the run otherwise (`startup_failure`), because a called job may not ask for more than the caller grants. Also and adds a small workflow for cleanup (example at the top of `preview-cleanup.yml`).

Non-prod edge (unproven until run in sandbox; design: offering `docs/runbooks/06-nonprod-edge.md`):
- `applyEdgeNaming(...)`: names CloudFront Functions and KeyValueStores `<app>-<stage>-...` (the non-prod deploy role can only change edge resources with its own stage prefix). Call first in `run()`.
- `nonprodGateInjection(tokenSha256Hex)`: CloudFront Function code for a Router's `edge.viewerRequest.injection`. It requires the non-prod token (HTTP Basic password or `x-nonprod-token` header), and only the token's SHA-256 is embedded.
- `edgeResourceName(app, stage, logical)`.
- `app-ci.yml`: optional secret `nonprod-token`, sent as `x-nonprod-token` by the staging and preview smoke checks (never production).

## v0.3.0

Released 2026-11-17. Release pipeline in `app-ci.yml`; backwards compatible (no `production-stage` = same behaviour as v0.2.x, except the smoke check now runs in its own job).
- On push to `main`: `deploy` (first stage) -> `smoke` -> `deploy-production` -> `smoke-production`. A failed smoke stops the run.
- New inputs: `production-stage`, `smoke-command`.
- Production job uses `environment: production` and the environment variable `AWS_DEPLOY_ROLE_ARN_PRODUCTION`; see `docs/usage.md`.
- The smoke check no longer runs inside the deploy job; it runs in a job with no AWS credentials.
- Verified on a real run (staging -> smoke -> production -> smoke) and with negative tests; see `docs/usage.md`, Verification status.
- Upgrade: bump the `uses:` tag to `v0.3.0`. To add production, set `production-stage: production` and give your production role a trust on the `production` GitHub environment (see the offering runbook linked in usage.md).

## v0.2.1

Released 2026-11-16. Documentation only; no code or workflow changes, so upgrading is optional.
- New troubleshooting section: SST's "Unexpected error" on an unknown stage, the `AWS_PROFILE` guard,
  AccessDenied after a stage rename, and removing a stage whose name is no longer valid.
- New verification status: `defaultTags` confirmed on a real deploy; `allowedAccountIds` enforcement
  still unverified.

## v0.2.0

Released 2026-11-16.

**BREAKING: renamed from `tribute` to `sst-foundation`.** Upgrade steps:
1. Replace the dependency: `npm rm tribute && npm i --save-exact github:15davidallison/sst-foundation#v0.2.0`
2. Rename `tributeApp` to `foundationApp` (and `TributeAppOptions` to `FoundationAppOptions`).
3. Change workflow references from `15davidallison/tribute/...` to `15davidallison/sst-foundation/...@v0.2.0`.

Fixes and additions:
- `sst.config.ts` must import dynamically: SST rejects top-level imports. The docs show the pattern.
- Consumers need `"allowImportingTsExtensions": true` in `tsconfig.json`, because the package ships
  TypeScript source.
- `app-ci.yml` now passes `--stage` to `sst install`, so apps no longer fail on SST's default stage name.
- New `sst-install` input on `app-ci.yml` (default `true`) to skip `sst install` in non-SST repos.
- MIT license, and a documented eject procedure for handing an app off.

## v0.1.0

Released 2026-11-16. Initial release, published as `tribute`.
- Stage model: `production`, `staging`, `dev-<name>`, `pr-<n>` (15 min preview TTL); unknown names throw.
- Default tags: `client`, `app`, `env`, `stage`, `managed-by`.
- Account map with per-stage overrides, `AWS_PROFILE` mismatch guard and `allowedAccountIds` pinning.
- `tributeApp()` for `sst.config.ts`.
- Reusable workflow `app-ci.yml`: lint, typecheck, optional tests, OIDC deploy on `main`, smoke check.
