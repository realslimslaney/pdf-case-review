---
name: pr-manager
description: Open or repair a fully tagged draft pull request for a feature branch that is already committed and pushed, applying assignee, area label, milestone, and a linked issue. Not for committing, pushing, merging, closing, or marking a PR ready for review.
---

# PR Manager

## Workflow

Open a draft pull request against `main` for an already-pushed feature branch, or repair the
existing PR for that branch in place. This workflow never merges and never marks a PR ready.

Hard rules:

- Never commit, push, merge, close a PR, mark a PR ready for review, or touch `main`.
- Check preconditions first: the current branch is not `main`, `git status --short` shows no
  modified tracked files (untracked files are fine), and `git log origin/<branch>..<branch>` is
  empty. If tracked changes or unpushed commits exist, stop and report them; committing belongs
  to the `committer` workflow.
- Never create labels or milestones.
- Write any `--body-file` temporary file outside the repository and never commit it.

Required metadata (each item lands on the PR, or the final report says why it does not apply):

- Draft (`--draft`).
- Assignee: `realslimslaney`.
- Exactly one existing area label, confirmed with `gh label list`: `area:viewer`, `area:notes`,
  `area:report`, `area:ai`, `area:release`, or `area:docs`. Add an existing type label (`bug`,
  `enhancement`, `documentation`) when it applies. If the area labels do not exist yet on a fresh
  repository, report that instead of inventing them.
- Milestone: the fitting open milestone from
  `gh api 'repos/realslimslaney/pdf-case-review/milestones?state=open' --jq '.[] | {number, title}'`;
  if none fits, say so.
- Linked issue: the body contains `Closes #N`. If no issue exists, create one first with
  `gh issue create` (same label and milestone) using Summary / Context / Acceptance Criteria.
- Body: follows `.github/pull_request_template.md`; check only the checklist items you verified.
  End the body with:
  🤖 Generated with [Codex](https://openai.com/codex/)

Steps:

1. Verify preconditions.
2. Gather metadata: `gh label list`, open milestones, related issues (`gh issue list --search`).
3. Check for an existing PR: `gh pr list --head <branch> --state all --json number,url,isDraft`.
   If one exists, go to the repair step.
4. Open the PR:

   ```
   gh pr create --draft --base main --head <branch> --title "<type(scope): subject>" \
     --body-file <tmpfile> --assignee realslimslaney --label <area:label> \
     [--milestone "<milestone title>"]
   ```

5. Repair path: `gh pr edit <num> --add-assignee realslimslaney --add-label <area:label>
   [--milestone "<title>"]` and edit the body to add `Closes #N` or the footer.
6. Verify, then report: `gh pr view <num> --json url,isDraft,assignees,labels,milestone,body`.
   Report the PR URL, draft state, assignee, labels, milestone, and linked issue; say explicitly
   if anything could not be applied.

## Operational notes

- Prefer `gh`; it uses the user's local GitHub authentication.
- Request command escalation when network access is sandboxed.
- Delete the temporary body file afterwards.
