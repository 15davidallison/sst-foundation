# Usage reference

Everything below is exported from `sst-foundation` (source: `src/index.ts`). There is no build step: the package
ships TypeScript source and SST bundles it together with `sst.config.ts`.

## Setup requirements

- **Dynamic imports in `sst.config.ts`.** SST rejects top-level imports there ("top level imports - this
  is not allowed"). Import inside `app()`, which may be `async`:
  `const { foundationApp } = await import("sst-foundation");`
- **`"allowImportingTsExtensions": true`** in the app's `tsconfig.json`, because the package ships `.ts`
  source and your typecheck reads it.
- **An explicit, valid stage on every SST command.** SST's default stage is your username, which
  `foundationApp` rejects. Use `--stage production|staging|dev-<name>|pr-<n>`. This includes
  `sst install`, which `app-ci.yml` handles for you.
- **Running locally with `AWS_PROFILE` exported:** use `env -u AWS_PROFILE npx sst ...`, or the profile
  guard will refuse to run.
- **Private repo access:** if you keep sst-foundation private, `npm ci` in CI cannot clone it with the
  workflow's default token. Public visibility avoids this.

## Eject (hand an app off without the library)

1. Copy `node_modules/sst-foundation/src` into the app (for example `infra/foundation/`).
2. Point the dynamic import in `sst.config.ts` at the local copy and remove the dependency.
3. Copy `.github/workflows/app-ci.yml` into the app's workflows and call it as a local workflow.

The library has no runtime dependencies and no network calls, so nothing else changes.

## Stages

`classifyStage(stage)` returns a `StagePolicy` or throws for unknown names.

| Stage | `kind` | `env` | `removal` | `protect` | Notes |
|---|---|---|---|---|---|
| `production` | `production` | `production` | `retain` | `true` | Live |
| `staging` | `staging` | `nonprod` | `remove` | `false` | Long-lived non-prod |
| `dev-<name>` | `dev` | `nonprod` | `remove` | `false` | `<name>`: lowercase letters, digits, `-`, max 21 chars |
| `pr-<number>` | `preview` | `nonprod` | `remove` | `false` | `ttlMinutes: 15` |

`ttlMinutes` is advice for a cleanup job; sst-foundation does not delete stages itself.

## Tags

`defaultTags({ client, app, policy })` returns:

| Tag | Value |
|---|---|
| `client` | client slug, e.g. `acme` |
| `app` | app name, e.g. `acme-site` |
| `env` | `production` or `nonprod` |
| `stage` | full stage name |
| `managed-by` | `sst` |

`foundationApp` applies these through the AWS provider's `defaultTags`. To split prod and non-prod cost
inside one account, activate `client`, `app` and `env` as cost-allocation tags in the AWS management
account (a manual, one-time step).

## Accounts

```ts
interface Target { account: string; profile: string; region: string }
interface AccountMap {
  production: Target;
  nonprod: Target;
  overrides?: Record<string, Target>; // exact stage name → target
}
```

- `resolveTarget(map, stage, env)`: an `overrides` entry for the exact stage wins, otherwise `map[env]`.
- A shared account for prod and non-prod is the default: give both entries the same target. A separate
  production account is the same map with a different `production` entry.
- `assertProfile(target, environ?)`: throws if `AWS_PROFILE` is set and differs from `target.profile`.
  Skipped in GitHub Actions (`GITHUB_ACTIONS=true`), where credentials come from the OIDC role.
- `foundationApp` also sets `allowedAccountIds: [target.account]`, so a deploy to the wrong account fails.

## `foundationApp(opts, input, environ?)`

Returns the object SST expects from `app()`:

| Field | Value |
|---|---|
| `name` | `opts.name` |
| `home` | `"aws"` |
| `removal`, `protect` | from the stage policy |
| `providers.aws` | `region`, `allowedAccountIds`, `defaultTags`, and `profile` (omitted in CI) |

`environ` defaults to `process.env`; pass an object in tests.

## Reusable workflow: `app-ci.yml`

Call it with `uses: 15davidallison/sst-foundation/.github/workflows/app-ci.yml@<tag>`. The calling job must
grant `permissions: { contents: read, id-token: write }`, or the OIDC deploy cannot request a token.

Jobs: `checks` (always) then `deploy` (push to `main`, and only if `role-arn` is set).

| Input | Default | Meaning |
|---|---|---|
| `deploy-stage` | required | Stage deployed on push to `main` |
| `role-arn` | `""` | OIDC deploy role. Empty = checks only |
| `aws-region` | `us-west-2` | Region for the credentials step |
| `node-version` | `24` | |
| `lint-command` | `npm run lint` | |
| `typecheck-command` | `npm run typecheck` | |
| `test-command` | `""` | Empty = skip |
| `smoke-url-output` | `url` | Key in `.sst/outputs.json` to GET after deploy; empty = skip |
| `smoke-expect-jq` | `""` | Optional `jq -e` expression the JSON body must satisfy |

Customizing:
- **Inputs** cover commands, stage, region and smoke check.
- **Extra jobs:** add jobs to the caller workflow with `needs: ci`.
- **Opt out:** write your own workflow and don't call this one.

The deploy job serializes per stage (`concurrency: deploy-<stage>`, never cancelled mid-deploy).

## Secrets and config

- Secrets: declare `new sst.Secret("Name")`; set values with `sst secret set Name --stage <stage>`.
  Values never appear in code, fixtures, logs or docs.
- Non-secret config: SSM parameters under `/<app>/<stage>/<key>`. SST already prefixes resource names
  with `<app>-<stage>`; don't add a second naming scheme.

## Troubleshooting

- **`✕ Unexpected error occurred` from SST, with no detail.** SST hides errors thrown while evaluating
  `sst.config.ts`. Re-run with `--print-logs` and look for the real message. The usual one is
  `Unknown stage "<name>"`: you ran SST without `--stage`, so it used your username. Pass
  `--stage production|staging|dev-<name>|pr-<n>`.
- **`AWS_PROFILE=... does not match pinned profile ...`.** Your shell exports `AWS_PROFILE`. Run
  `env -u AWS_PROFILE npx sst ...`.
- **AccessDenied in CI right after renaming a stage.** The deploy role's policy is usually scoped by
  resource name to the stage (for example `my-app-staging-*`). Renaming a stage means updating that
  policy; OIDC itself is fine if the role was assumed.
- **Removing a stage that is no longer a valid name** (for example an old `sandbox`): current config
  rejects it. Check out the commit that predates the rename in a scratch directory and run
  `sst remove --stage <old>` there.

## Verification status

- **Verified (v0.2.0 on a real deploy):** `defaultTags` reach AWS. A Lambda function and its log group
  carried `client`, `app`, `env`, `stage` and `managed-by`. The IAM role was not checked, because the
  tagging API does not list IAM roles.
- **Not verified:** that `allowedAccountIds` makes a wrong-account deploy fail. A deploy to the right
  account succeeds, which does not prove the refusal. Test it with a deliberately wrong profile
  before relying on it.

## Known limitations

- No component wrappers (Lambda, ECS) and no preview-stage deploy or TTL cleanup workflow. Define
  resources directly with SST components, and clean up `pr-<n>` stages yourself.
