# Publish a release

For the repository maintainer. If you only want to use the extension, install it from the
Marketplace or the `.vsix` as described in [Set up your computer](../tutorials/setup.md).

One-time setup, then every release is a merged release-please PR.

Use the Node version in `.node-version` and pnpm version in `package.json`. Install the locked tools
with `pnpm install --frozen-lockfile --ignore-scripts` before running the setup commands below.

## One-time

1. **VS Marketplace**: sign in at <https://marketplace.visualstudio.com/manage>, create the publisher
   (`publisher` in `package.json`). Create an Azure DevOps personal access token at <https://dev.azure.com>
   (User settings → Personal access tokens → New Token; Organization "All accessible organizations",
   scope Marketplace → Manage) and store it as the `VSCE_PAT` secret in the `release` environment.
   The current workflow uses this token to authenticate.
2. **Open VSX**: create an Eclipse account with the same GitHub username, sign in to <https://open-vsx.org>,
   sign the publisher agreement, generate an access token → `OVSX_PAT` secret in the `release`
   environment, then `pnpm exec ovsx create-namespace <publisher> -p $OVSX_PAT`.
3. **GitHub**: create an environment named `release` that requires your approval; protect `main`.
4. **Project board and assignment**: on <https://github.com/users/realslimslaney/projects/4> open the ⋯ menu, Workflows, "Auto-add to project", Edit; pick `realslimslaney/pdf-case-review` with the filter `is:open`, then "Save and turn on workflow" (GitHub Free allows one auto-add workflow per project). It does not add existing items: use "+ Add item", "Add from repository" once. The `Auto-assign` workflow assigns every new issue and PR to `realslimslaney`; run it by hand once (Actions, Auto-assign, "Run workflow") to backfill the open ones.

### Branch protection

`.github/CODEOWNERS` assigns every path to `@realslimslaney`. It only bites once a ruleset requires code-owner review, and that ruleset also blocks a solo maintainer from merging their own PRs unless they are on the bypass list. Enable it when the first outside contributor shows up:

```sh
gh api -X POST repos/realslimslaney/pdf-case-review/rulesets --input - <<'JSON'
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/main"], "exclude": [] } },
  "bypass_actors": [{ "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 1,
        "require_code_owner_review": true,
        "dismiss_stale_reviews_on_push": true,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [{ "context": "check (ubuntu-latest)" }] } }
  ]
}
JSON
```

`actor_id: 5` is the repository **Admin** role. Without that entry a sole maintainer who is also the
only code owner could never merge, because the rule requires a code-owner review from someone else.
The ruleset itself can only be created or changed by an admin.

## Every release

1. Merge Conventional-Commit PRs into `main`.
2. release-please keeps a "chore: release X.Y.Z" PR up to date; merge it to tag `vX.Y.Z` and create the GitHub release.
3. Start the `Release` workflow by hand: Actions, Release, "Run workflow", and pick the tag `vX.Y.Z` as the ref (or `gh workflow run release.yml --ref vX.Y.Z`). The tag does not start it on its own, because release-please creates the tag with the workflow's own `GITHUB_TOKEN`, and GitHub never starts workflows from events made by that token.
4. The workflow checks the code and audits the full dependency tree at high severity, builds the VSIX,
   attaches it to the release, and then waits on the `release` environment. Approve the deployment
   under the run's "Review deployments" button; both marketplace publish jobs run after that.
   Odd minor versions go to the pre-release channel automatically.
5. If the Marketplace job fails after all five attempts with `Request timeout: /_apis/gallery`, follow [Upload a release by hand](manual-marketplace-upload.md). Open VSX will already have the version.

To make step 3 automatic, give release-please a token other than `GITHUB_TOKEN` (a fine-grained personal access token or a GitHub App installation token with contents and pull-requests write) and pass it as `token:` in `release-please.yml`; tags pushed with that token do trigger the `Release` workflow.

Keep publishing tools in `package.json` and `pnpm-lock.yaml`. Both publish jobs install with
`--frozen-lockfile --ignore-scripts` and invoke `pnpm exec vsce` or `pnpm exec ovsx`; only the publish
steps receive marketplace secrets. Use these locked tools for manual commands too, so publishing
does not download an unreviewed CLI version.

Local dry run: `pnpm package && pnpm exec vsce ls` and install the `.vsix` into a clean profile (`code --profile temp --install-extension pdf-case-review-*.vsix`).
