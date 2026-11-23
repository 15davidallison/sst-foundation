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
grant `permissions: { contents: read, id-token: write, pull-requests: write, deployments: write }`: `id-token` for the OIDC deploy,
`pull-requests` for the preview comment (v0.4.0), `deployments` for deployment records (v0.5.0). A missing one stops the run
before it starts (`startup_failure`).

Every deploy (staging, production, previews) records a **GitHub deployment** for its stage: the commit, `environment_url`
(the output named by `site-url-output`, default `url`), and `payload: { sstFoundation: 1, app, stage, account, region }`
(`app-name` input, default the repository name). Status `success` or `failure`; recording never fails the release.
Removed previews are marked `inactive`. Deployment consoles read these records for "what is deployed where".

Jobs, on push to `main` (pull requests run `checks` only):

```
checks -> deploy (deploy-stage) -> smoke -> deploy-production (production-stage) -> smoke-production
```

- `deploy` runs only if `role-arn` is set. `smoke` has no AWS credentials. If `smoke` fails, `deploy-production` never runs.
- `deploy-production` runs only if `production-stage` is set. It declares `environment: production`, so its OIDC
  subject is `repo:<owner>/<repo>:environment:production` (immutable-prefix form on newer repos). The production role must
  trust exactly that, and the `production` GitHub environment should restrict deployment branches to `main`.
- The production role ARN is read from the **environment variable** `AWS_DEPLOY_ROLE_ARN_PRODUCTION` on the `production`
  environment. It is not an input, because environment variables are visible only to a job that names the environment.
- The first-stage job declares **no** environment, on purpose: adding one would change its OIDC subject and break a non-prod role
  that trusts `main` and `pull_request`.
- A failed `smoke-production` leaves production changed and the run red; there is no automatic rollback.

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
| `smoke-command` | `""` | Optional extra smoke test, run after the URL check with `SMOKE_URL` and `SMOKE_STAGE` set (e.g. `npm run smoke`) |
| `production-stage` | `""` | Stage deployed after staging smoke passes (normally `production`). Empty = no production jobs |

Customizing:
- **Inputs** cover commands, stage, region and smoke check.
- **Extra jobs:** add jobs to the caller workflow with `needs: ci`.
- **Your own pipeline:** write your own jobs from the building blocks below (same steps the reusable workflows use).
- **Opt out:** write your own workflow and don't call this one.

The deploy jobs serialize per stage (`concurrency: deploy-<stage>`, never cancelled mid-deploy). GitHub keeps at most one waiting run per group, so two quick merges can skip the older one's pipeline; the newer run deploys the newer commit.

## Building blocks (composite actions)

`app-ci.yml`, `app-ops.yml` and `preview-cleanup.yml` are built from composite actions in `.github/actions/`. An app
that needs a different pipeline uses the same blocks in its own jobs, pinned to the same tag:
`uses: 15davidallison/sst-foundation/.github/actions/<block>@<tag>`. The job keeps what only a job can set: `permissions`
(`id-token: write` to assume a role, `deployments: write` for records), `environment:` (which decides the OIDC subject),
and `concurrency`.

| Block | Does | Inputs (required in bold) | Outputs |
|---|---|---|---|
| `setup` | checkout (no persisted credentials), Node with the npm cache, `npm ci`, optional `sst install` | `node-version`, `ref`, `sst-install`, `stage` | |
| `aws-login` | assume a role with GitHub OIDC | **`role-arn`**, **`session-name`**, `region` | |
| `record-start` | create the stage's GitHub deployment record, `in_progress` | **`app-name`**, **`stage`**, **`region`**, **`sha`**, `action` | `id` |
| `sst-deploy` | `sst deploy`, then read URLs from `.sst/outputs.json`; names missing secrets when `secrets-from` is set | **`stage`**, `url-output`, `site-url-output`, `secrets-from` | `url`, `site` |
| `record-outcome` | post the outcome to the record (or create one) | **`outcome`**, **`app-name`**, **`stage`**, **`region`**, **`sha`**, `deployment-id`, `action`, `site-url-output`, `account`, `site` | |
| `smoke` | GET the URL (200, optional `jq`), then an optional command; no AWS credentials needed | `url`, `stage`, `expect-jq`, `command`, `nonprod-token` | |
| `sst-diff` | `sst diff --json` to a file, unmodified, and its SHA-256 (bind an approval to the exact diff: re-run before applying and compare) | **`stage`**, `path` | `path`, `sha256` |

Example, a plan job on pull requests:

```yaml
jobs:
  plan:
    runs-on: ubuntu-24.04
    permissions: { contents: read, id-token: write }
    steps:
      - uses: 15davidallison/sst-foundation/.github/actions/setup@<tag>
      - uses: 15davidallison/sst-foundation/.github/actions/aws-login@<tag>
        with: { role-arn: "${{ vars.PLAN_ROLE_ARN }}", session-name: plan }
      - id: diff
        uses: 15davidallison/sst-foundation/.github/actions/sst-diff@<tag>
        with: { stage: staging }
```

Inside this repo's reusable workflows the blocks are referenced as `$/.github/actions/<block>`, which GitHub resolves
against the workflow file's own repository at the running commit, so a caller pinned to a tag runs that tag's blocks.

## Operations: `app-ops.yml` (redeploy, rollback, teardown)

A reusable workflow for one-off operations on a deployed stage, run with `workflow_dispatch` from `main` (by hand, or by
a deployment console). Add to the app repo, e.g. `.github/workflows/ops.yml`:

```yaml
name: ops
on:
  workflow_dispatch:
    inputs:
      action: { description: "redeploy | rollback | teardown", required: true, type: choice, options: [redeploy, rollback, teardown] }
      stage: { description: "production, staging or pr-<n>", required: true, type: string }
      sha: { description: "rollback: full commit of an earlier successful deploy", required: false, type: string }
      requested-by: { description: "who asked", required: false, type: string }
permissions:
  contents: read
jobs:
  ops:
    uses: 15davidallison/sst-foundation/.github/workflows/app-ops.yml@v0.5.0
    permissions: { contents: read, id-token: write, deployments: write }
    with:
      action: ${{ inputs.action }}
      stage: ${{ inputs.stage }}
      sha: ${{ inputs.sha }}
      requested-by: ${{ inputs.requested-by }}
      role-arn: ${{ vars.AWS_DEPLOY_ROLE_ARN }}
      smoke-expect-jq: '.ok == true' # same as your app-ci call
    secrets:
      nonprod-token: ${{ secrets.NONPROD_GATE_TOKEN }}
```

- **redeploy**: deploys the newest commit with a successful deployment record on that stage, then smoke.
- **rollback**: deploys `sha`, which must have a successful deployment on that stage (otherwise refused), then smoke.
  Production rollback goes straight to production; it doesn't pass through staging.
- **teardown**: `sst remove`. Previews also lose their state object. Production is `protect: true`; this job alone sets
  `SST_FOUNDATION_TEARDOWN=<app>/production`, which makes `foundationApp` lift `protect` for that app's production only.
  `removal` stays `retain`, so stateful resources (buckets, tables) are **kept** and keep billing until removed by hand.
  All the stage's deployment records are marked `inactive`.
- Roles and trust are app-ci's: the non-prod job's OIDC subject is `...:ref:refs/heads/main`, the production job uses
  `environment: production`. No trust changes. Concurrency groups match app-ci's, so an operation never overlaps a deploy.
- The run summary shows the action, stage, commit and `requested-by`.

## Preview stages: `preview` and `preview-cleanup.yml`

Opt in with `preview: true` on the `app-ci.yml` call. A PR whose head branch starts with `preview/` (input `preview-branch-prefix`; empty = every PR) then deploys `pr-<n>` (non-prod role, OIDC subject `...:pull_request`), smoke-tests it, and comments the URL. The `ci` job's `permissions` must include `pull-requests: write`. Dependabot and fork PRs get `checks` only.

Removal is a separate small workflow in the app, calling `preview-cleanup.yml` on `pull_request: closed` (removes that PR's stage) and on `schedule` every 15 minutes (removes `pr-*` stages whose state object in the SST state bucket was last written over `ttl-minutes` ago). The header of `preview-cleanup.yml` has a copy-paste example. Scheduled runs can be late, so expect 15 to 30 minutes. Design and risks: offering `docs/runbooks/05-preview-stages.md`. Previews inherit secrets from a base stage (`preview-base-stage`, default `staging`, never production): each preview deploy copies its values to `pr-<n>`. Treat staging as the base environment and use non-production values there. A secret not set on staging fails the preview with the secret's name and the `sst secret set ... --stage staging` command. Note that PR workflow code can read what the non-prod role can read, including staging secrets, so only preview branches you trust.

Status: proven except the scheduled sweep (see Verification status).

## Non-prod edge: CloudFront gate

Put non-production stages behind a CloudFront Router whose function rejects requests without a token; the function URLs become `AWS_IAM` (origin access control), so the gate can't be bypassed. Status: proven on a preview stage (see Verification status); design and IAM in offering `docs/runbooks/06-nonprod-edge.md`.

```ts title="sst.config.ts"
async run() {
  const { applyEdgeNaming, nonprodGateInjection } = await import("sst-foundation");
  applyEdgeNaming({ transform: $transform, cloudfront: aws.cloudfront, app: $app.name, stage: $app.stage });
  const gated = $app.stage === "staging"; // previews: IAM-only function URLs for now (runbook 06)
  const router = gated
    ? new sst.aws.Router("Edge", {
        protection: "oac",
        edge: { viewerRequest: { injection: new sst.Secret("NonprodGateTokenSha256").value.apply(nonprodGateInjection) } },
      })
    : undefined;
  const api = new sst.aws.Function("Api", { handler: "src/api.handler", url: router ? { router: { instance: router } } : true });
  return { url: api.url };
}
```

- Token: `openssl rand -hex 32`, never a human-chosen password. Store its SHA-256 (hex) as the SST secret `NonprodGateTokenSha256` on `staging` (previews inherit it), the token itself in your password manager and as the repo secret passed to `app-ci.yml` as `nonprod-token`.
- Browser: the Basic auth prompt; any username, the token as password. Agents/CI: header `x-nonprod-token`.
- `protection: "oac"` needs `x-amz-content-sha256` on POST/PUT from clients; use `"oac-with-edge-signing"` when an app needs browser POSTs.

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
- **Verified (2026-11-17):** `allowedAccountIds` is enforced. With the allow-list set to a different account
  than the credentials resolve to, `sst diff` failed with `AWS account ID not allowed: <account>` on the first
  provider call, before any plan.
- **Verified (2026-11-17, v0.3.0 pipeline on a real app):** staging deploy, smoke, production deploy under
  `environment: production`, production smoke all ran in order, and each deploy job assumed its own role.
  A `needs:`-gated job can use a different environment than its predecessor. Denied as expected: a PR job
  or a non-`main` branch job using the production role, and a non-`main` branch job using the non-prod
  role. Jobs that declare `environment: production` from a non-`main` ref are refused by GitHub's deployment
  branch rule, not by AWS (AWS would accept that subject), so the environment must keep that rule.
- **Verified (2026-11-17, v0.4.0 previews on donut-nook):** a `preview/` PR deploys `pr-<n>`, smoke passes and one
  comment is posted; a push redeploys the same stage and updates the comment; closing the PR removes the stage
  and its state object; a non-`preview/` branch gets no preview. A linked secret with no value fails the deploy
  (`SecretMissingError`) after partially creating the stage; with inheritance from `staging` the preview passed.
- **Verified (2026-11-17, non-prod gate on a donut-nook preview):** no or wrong token 401 with a Basic challenge,
  token 200 (CI smoke), direct function URL `AWS_IAM` and unsigned 403; removal deleted every CloudFront resource.
  A distribution takes about 3 minutes to create and about 25 to delete.
- **Verified (2026-11-23, v0.6.0-rc.1 on donut-nook):** blocks referenced with `$/` from a private caller pinned to a tag or branch resolve to sst-foundation at that ref. Preview PR (checks, deploy, smoke, comment, record; cleanup on close with a teardown record), push to `main` (staging, smoke, production, `record-production`, production smoke) and an `ops.yml` staging redeploy all ran with the same records as v0.5.0.
- **Not verified:** `sst-diff`'s output (that `sst diff --json` prints only JSON on stdout; the block fails if not); the scheduled TTL sweep (schedules run only on `main`; first app adoption will prove it); the
  gate on `staging` of a real app (proven on a preview stage only); whether Dependabot-triggered runs can request
  an OIDC token (previews skip Dependabot regardless).

## Known limitations

- No component wrappers (Lambda, ECS). Define resources directly with SST components.
- `protection: "oac"` rejects browser POST/PUT bodies (clients must send `x-amz-content-sha256`); use
  `"oac-with-edge-signing"` when an app needs them.
- Previews behind CloudFront are possible but slow to remove (~25 min); the default keeps previews off CloudFront.
- No automatic rollback: a failed production smoke check leaves production changed and the run red.
