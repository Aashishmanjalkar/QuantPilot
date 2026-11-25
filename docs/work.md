# Work and collaboration

Accepted at setup (2026-11-23).

## Requirements owner

- **GitHub Issues** own requirements, acceptance criteria, and the approved plan for
  each feature. Other records link to the issue instead of copying it.
- Acceptance criteria are numbered `AC-<issue>-<n>` (for example `AC-12-3`).
- Pending: the GitHub remote repository does not exist yet. Until it does, draft
  issue text locally in the task response; do not create tracker infrastructure.

## Branches

- `main` is always releasable.
- Work happens on short-lived branches: `feat/<issue>-<slug>`, `fix/<issue>-<slug>`,
  `docs/<slug>`, `chore/<slug>`.

## Commits

- [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`,
  `docs:`, `test:`, `refactor:`, `chore:`, `ci:`; optional scope such as
  `feat(quant): add RSI indicator`.
- Each commit is coherent with its tests and docs.

## Pull requests

- New PRs are drafts; mark ready after CI and review pass on the current head.
- PR description links the issue (`Closes #<n>`) and lists acceptance criteria covered
  and checks run.
- Squash-merge into `main`. Merge and deployment need explicit authorization.
