# Changelog

Release notes per released version (not per commit). Apps pin a tag; read the entry before upgrading.
Each entry summarizes what changed for consumers; breaking changes are marked **BREAKING** with
upgrade steps.

## v0.9.0

Released 2026-11-27. Preview TTL is now 24 hours. No breaking changes.

Upgrade: bump `uses:` (and the npm dependency) to `v0.9.0`. Apps that pass their own `ttl-minutes` keep it.

- `preview-cleanup.yml`'s `ttl-minutes` defaults to 1440 (24 h), up from 15, so a preview can be reviewed across a day. `PREVIEW_TTL_MINUTES` / `classifyStage("pr-<n>").ttlMinutes` match.
- The preview PR comment now says "about 24 hours after the last push, or when the PR closes".
- The preview PR comment links the site (`site-url-output`), not the smoke check's URL. Before, apps whose smoke check hits a health endpoint (e.g. `/api`) got that endpoint as the preview link.
- The example sweep schedule is hourly (`0 * * * *`); a 15-minute sweep is wasted work with a 24 h TTL. Existing `*/15` schedules still work.

## v0.8.0

Released 2026-11-24. **Security fix** for previews. No input changes.

Upgrade: bump `uses:` (and the npm dependency) to `v0.8.0`. **Before** your next preview deploy, check that no secret
on the preview base stage (normally `staging`) spans several lines; store any that do on one line (e.g. base64) and
decode in your app.

- The preview's copy of base-stage secrets no longer leaks values. Before, a value spanning several lines (a PEM
  private key) was misread by `sst secret load`, which printed part of it in the job log as a "secret name". The copy
  now refuses any multi-line value and copies nothing. It logs only counts, never names or values; `sst secret load`'s
  output is hidden except its error lines. If you ran a preview with a multi-line secret on an earlier version, delete
  that run's logs and rotate the secret.
- A preview whose job fails before the deploy (e.g. the secret copy) now marks its deployment record `failure`. Before, the record stayed `in_progress` forever and consoles showed it as coming online. Old stuck records aren't touched; mark them by hand if they bother you.
- New block `copy-secrets` (`from`, `to`, `production-stage`): the same copy, usable in your own jobs. Refuses a
  production stage as `from`.

## v0.7.0

Released 2026-11-23. Account stages. No breaking changes for existing apps.

Upgrade: bump `uses:` (and the npm dependency) to `v0.7.0`.

- New stage kind `acct-<alias>` (`kind: "account"`): one stage per AWS account, for apps that manage account-level resources. Retained, protected, tagged `env=production`; the teardown override never applies.
- New `AccountStageMap` (`{ accounts: { <alias>: target } }`), accepted by `foundationApp` instead of the usual map. An app with it deploys only `acct-<alias>` stages for listed aliases; an app with the usual map rejects `acct-*` stages.
- Exported `ACCOUNT_STAGE` (the stage pattern) and the `AccountStageMap` type.
- `app-ops.yml` still accepts only `production`, `staging`, `dev-<name>` and `pr-<n>`.

## v0.6.0

Released 2026-11-23 (tested as v0.6.0-rc.1). CI building blocks. No breaking changes: same inputs, jobs, check names, permissions, OIDC subjects, concurrency groups and deployment records as v0.5.0.

Upgrade: bump `uses:` (and the npm dependency) to `v0.6.0`.

- The steps shared by `app-ci.yml`, `app-ops.yml` and `preview-cleanup.yml` are now composite actions in `.github/actions/`: `setup`, `aws-login`, `record-start`, `sst-deploy`, `record-outcome`, `smoke`. Apps that need a different pipeline can build their own jobs from them (docs/usage.md, "Building blocks"). Each third-party action is pinned in one place.
- New block `sst-diff`: `sst diff --json` to a file, unmodified, plus its SHA-256, to bind an approval to an exact diff.
- The missing-secret error (previews) now names the stage generically ("pr-12 needs secret value(s) that are not set on staging: ...").
- The smoke check writes the response body to `$RUNNER_TEMP/smoke-body.json` instead of `body.json` in the workspace. Only matters if your `smoke-command` read that file.

## v0.5.0

Released 2026-11-23 (tested as v0.5.0-rc.1 to rc.4). Deployment records and operations (redeploy, rollback, teardown).

**BREAKING:** the calling `ci` job must grant `deployments: write`, or GitHub refuses to start the run (`startup_failure`). Upgrade steps:
1. Bump `uses:` (and the npm dependency) to `v0.5.0`.
2. Add `deployments: write` to the `ci` job's `permissions` (and to the `cleanup` job's, if you call `preview-cleanup.yml`).
3. Optional: set `site-url-output` if your public URL isn't the `url` output; set `app-name` if it differs from the repository name.
4. Optional: add `ops.yml` (docs/usage.md, "Operations").

- Records are created when a deploy or operation **starts** (`in_progress`, so consoles show it while it runs) and get their outcome when it ends. `app-ci.yml`: every deploy (staging, production, preview) records a GitHub deployment (production's from a follow-up `record-production` job: GitHub's own deployment for the `environment: production` job would otherwise retire it) with the commit, the site URL and `payload: { sstFoundation: 1, app, stage, account, region }`. Recording failures warn but don't fail the release. New inputs `site-url-output` (default `url`) and `app-name` (default repository name).
- `preview-cleanup.yml`: removed previews' deployments are marked `inactive`, then an explicit teardown record (`payload.action: "teardown"`) is added. Needs `deployments: write`.
- New `app-ops.yml`: `redeploy`, `rollback` (only to a commit with a successful deployment on that stage), `teardown` (production keeps stateful resources; records an explicit `teardown` deployment, so consoles never infer "torn down" from an `inactive` status, which GitHub can also set by itself). Validates inputs before assuming any role; same roles, trust and concurrency groups as `app-ci.yml`.
- `foundationApp`: `SST_FOUNDATION_TEARDOWN=<app>/production` lifts `protect` for that app's production only (`removal` stays `retain`). Exported `TEARDOWN_OVERRIDE_VAR`, `teardownOverride(app, stage, environ)`.

## v0.4.0

Released 2026-11-17. Preview stages and the non-prod CloudFront gate.

**BREAKING:** the calling `ci` job must grant `pull-requests: write`, even if you never turn previews on. Without it GitHub refuses to start the run (`startup_failure`): a called job may not ask for more permissions than the caller grants, and the preview comment step asks for it. Upgrade steps:
1. Bump `uses:` (and the npm dependency) to `v0.4.0`.
2. Add `pull-requests: write` to the `ci` job's `permissions`.

Preview stages (opt-in, `preview: true`):
- On a pull request whose head branch starts with `preview-branch-prefix` (default `preview/`), deploys `pr-<n>` with the non-prod role, smoke-tests it, and posts one comment with the URL (updated on each push; `preview-comment`). Never for Dependabot PRs (by PR author) or fork PRs.
- Previews inherit secrets from `preview-base-stage` (default `staging`; production refused), copied on every deploy through a private temp file. A secret missing there fails the deploy with an error naming it and the `sst secret set <NAME> <value> --stage staging` command.
- New reusable `preview-cleanup.yml`: removes `pr-<n>` on PR close (no-op without a preview) and, on a schedule, any `pr-*` stage last deployed more than `ttl-minutes` (default 15) ago. Deletes the empty state object `sst remove` leaves behind.
- New optional secret `nonprod-token`: sent as `x-nonprod-token` by the staging and preview smoke checks, never production.

Non-prod edge (library):
- `nonprodGateInjection(tokenSha256Hex)`: CloudFront Function code for a Router's `edge.viewerRequest.injection` that requires a token (Basic auth password or `x-nonprod-token`). Only the token's SHA-256 is embedded.
- `applyEdgeNaming(...)`: names CloudFront Functions, KeyValueStores and cache policies `<app>-<stage>-...`; call first in `run()`.
- `edgeResourceName(app, stage, logical)`.

Verified and not verified: see `docs/usage.md`, Verification status.

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
