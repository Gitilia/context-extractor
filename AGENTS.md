# AGENTS.md — context-extractor

Short orientation for Cursor agents. Prefer this over rediscovering the repo.

## Defaults

- Read `README.md` for run/install; use `make help` when a Makefile exists.
- Lint and tests are **hard gates** in CI — never add `|| true` to them.
- **Do not** commit secrets; app creds live in Infisical (`secrets.levkin.ca`, `/apps/context-extractor`).
- Multi-step or ambiguous work → Plan mode first, then Agent mode.

## Docs voice

READMEs/guides: [writing-docs.md](https://github.com/Gitilia/project-template/blob/main/docs/writing-docs.md) (no emoji decoration).

## Close-out

1. Run the narrowest verify that fits (`make test`, `npm test`, `pytest`, CI workflow locally).
2. Public GitHub mirror (`Gitilia/*`): after README/docs release merges, sync mirrors — see `ansible/docs/guides/github-mirrors.md`.
3. Non-trivial PR: offer review; merge only when the user asks.
