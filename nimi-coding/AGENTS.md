# AGENTS.md

- Think before acting. Read existing files before writing code. Prefer editing over rewriting.
- Be concise in output but thorough in reasoning. No sycophantic openers or closing fluff.
- Test changes before declaring done.

## Scope

Applies to the whole repository.

## Current Bootstrap Posture

- Package-owned methodology source lives directly under `config/**`, `contracts/**`, `methodology/**`, and `spec/**`.
- Generated or adopted host projects use `.nimi/**` as their project-local AI truth surface.
- This repository is not self-hosting its own execution methodology yet.
- Runtime ownership stays delegated to an external AI host or another tool boundary.

## Retrieval Defaults

- Start with `methodology/**`, `spec/**`, `contracts/**`, `config/**`, `README.md`, and `package.json`.
- Treat root `AGENTS.md` plus those package source directories as the current local authority for package-internal AI behavior.

## Hard Boundaries

- Do not treat this repository as methodology-complete yet.
- Do not add CLI runtime, skill runtime, or self-hosting workflow unless the active packet explicitly admits it.
- Keep package-owned source AI-native and low-redundancy; do not add human-friendly parallel truth by default.
- Do not change the external project bootstrap contract away from `.nimi/**` unless the package contract itself is explicitly redesigned.
