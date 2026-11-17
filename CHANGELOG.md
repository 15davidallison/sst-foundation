# Changelog

Release notes per released version (not per commit). Apps pin a tag; read the entry before upgrading.
Each entry summarizes what changed for consumers; breaking changes are marked **BREAKING** with
upgrade steps.

## Unreleased (v0.3.0)

Release pipeline in `app-ci.yml`; backwards compatible (no `production-stage` = same behaviour as v0.2.x, except the smoke check now runs in its own job).
- On push to `main`: `deploy` (first stage) -> `smoke` -> `deploy-production` -> `smoke-production`. A failed smoke stops the run.
- New inputs: `production-stage`, `smoke-command`.
- Production job uses `environment: production` and the environment variable `AWS_DEPLOY_ROLE_ARN_PRODUCTION`; see `docs/usage.md`.
- The smoke check no longer runs inside the deploy job; it runs in a job with no AWS credentials.

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
