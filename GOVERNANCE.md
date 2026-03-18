# Governance

This document defines how `@nimiplatform/nimi` is maintained as an open-source project.

## Roles

1. Maintainers: approve architecture changes, releases, and spec contract updates.
2. Reviewers: review code, contracts, tests, and docs for correctness and policy compliance.
3. Contributors: propose and implement changes through issues and pull requests.

## Decision Rules

1. Contract-first: changes touching boundaries (`runtime/sdk/apps/desktop/nimi-mods/proto/spec`) must update spec first.
2. No-legacy by default: pre-launch changes should hard-cut to final contract unless blocked by external dependency.
3. Fail-fast over fallback: hidden path guessing and compatibility aliases are rejected.
4. Security-sensitive domains require stricter review and explicit verification notes.

## Pull Request Requirements

1. Include scope, risk, validation commands, and rollback notes.
2. Pass required CI gates before merge.
3. Include spec updates when behavior or contract changes.
4. Breaking changes must state migration path clearly.

## Release Governance

1. Release pipelines must be reproducible in CI.
2. Supply-chain artifacts (SBOM/signature/provenance) must be generated and verifiable.
3. Tag-based releases are source of truth; local manual release steps are not accepted.

## Security Process

1. Do not disclose vulnerabilities publicly before maintainer triage.
2. Use GitHub Security Advisories for private disclosure and coordinated fixes.
3. Security fixes should include regression tests and reason-code level auditability when applicable.

## Community Conduct

Project conduct and contribution process are governed by:

1. `CODE_OF_CONDUCT.md`
2. `CONTRIBUTING.md`
3. `SECURITY.md`
4. `DCO`
