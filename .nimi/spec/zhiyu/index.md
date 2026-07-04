# Zhiyu Spec Guide

Zhiyu is a Nimi first-party bundled developer-only incubated app. This guide is
thin navigation only. Normative authority lives under `kernel/*.md` and
`kernel/tables/*.yaml`.

## Reading Order

1. `kernel/index.md`
2. `kernel/product-authority-contract.md`
3. `kernel/authority-boundary-contract.md`
4. `kernel/local-partner-center-state-contract.md`
5. `kernel/conversation-surface-contract.md`
6. `kernel/configuration-surface-contract.md`
7. `kernel/testing-and-quarantine-contract.md`

## Authority Boundary

Zhiyu is the local partner center. Its primary conversation product targets
Desktop Agent Chat parity for local partner interaction while remaining an
independent Zhiyu app surface. It does not create partners, own Runtime Agent
execution, own memory truth, own Runtime AI config, own Avatar resource truth,
or directly consume AI provider/model routes. Zhiyu presents and operates
admitted upstream surfaces.
