# Publish a release

One-time setup, then every release is a merged release-please PR.

## One-time

1. **VS Marketplace**: sign in at <https://marketplace.visualstudio.com/manage>, create the publisher (`publisher` in `package.json`). In the publisher's settings add a *trusted publishing* policy for `realslimslaney/pdf-case-review` and the workflow `.github/workflows/release.yml`; the workflow then runs `vsce publish --oidc` with no stored secret.
2. **Open VSX**: create an Eclipse account with the same GitHub username, sign in to <https://open-vsx.org>, sign the publisher agreement, generate an access token → repository secret `OVSX_PAT`, then `npx ovsx create-namespace <publisher> -p $OVSX_PAT`.
3. **GitHub**: create an environment named `release` that requires your approval; protect `main`.

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

(`actor_id: 5` is the repository **Admin** role, so you can still merge your own work.)

## Every release

1. Merge Conventional-Commit PRs into `main`.
2. release-please keeps a "chore: release X.Y.Z" PR up to date; merge it to tag `vX.Y.Z` and create the GitHub release.
3. The `Release` workflow builds the VSIX, attaches it to the release, and, after your approval on the `release` environment, publishes to both marketplaces. Odd minor versions go to the pre-release channel automatically.

Local dry run: `pnpm package && pnpm exec vsce ls` and install the `.vsix` into a clean profile (`code --profile temp --install-extension pdf-case-review-*.vsix`).
