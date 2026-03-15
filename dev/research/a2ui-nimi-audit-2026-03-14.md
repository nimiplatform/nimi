# A2UI Versus Nimi Audit

- Source ID: `RESEARCH-AUI-001`
- Date: `2026-03-14`
- Scope: Google `A2UI` vendored source, protocol status, renderer implementation, security model, and comparison points against Nimi's mod, runtime, and UI boundaries.

## Summary

A2UI demonstrates a renderer-centric interaction model with strong protocol assumptions, but it relies on tighter coupling between UI orchestration and host capabilities than Nimi's current boundary rules allow.

## Key Findings

1. The renderer surface assumes privileged host cooperation and is not designed around shallow public contracts.
2. Protocol and transport expectations are more implicit than in Nimi's spec tables and generated contract flow.
3. The security model depends on trusted embedding and curated capabilities rather than mod-facing isolation.
4. The implementation reinforces the need for strict renderer/runtime/mod separation when borrowing interaction patterns into Nimi.

## Nimi Comparison Notes

1. Nimi should keep desktop and web adapters thin and avoid collapsing renderer concerns into runtime internals.
2. A2UI is a useful reference for interaction density and host-assisted UX flows, but not for boundary design.
3. Future backlog items around UI orchestration, mod safety, and renderer bridge hardening are supported by this audit.
