# Nimi Developer Portal

This `docs/` workspace is the public-facing developer portal for third-party builders.

## What belongs in docs/

- Onboarding and getting-started flows for external developers
- Role-based guides (`guides/*`)
- Cookbook recipes and links to runnable examples
- Reference pages for SDK, runtime, protocol, error codes, and compatibility
- Architecture overview and spec map pointers

## What does not belong in docs/

- Internal planning, research, and audit artifacts (`dev/*`)
- Agent-operation instructions (`AGENTS.md`, tool-specific internal rules)
- Internal release runbooks or contributor-only operational details

## Normative source of truth

- Normative contracts are defined in `spec/`
- Human-readable generated spec entry: `spec/generated/nimi-spec.md`
- This portal should explain usage and link to `spec/` instead of duplicating rule text
