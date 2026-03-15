# OpenFang Competitive Audit

- Source ID: `RESEARCH-OFANG-001`
- Date: `2026-03-01`
- Scope: `OpenFang v0.2.3 (Rust Agent OS)` architecture, code quality, security posture, feature completeness, extensibility, and comparison points against Nimi.

## Summary

OpenFang presents a Rust-first local agent platform with strong emphasis on host control, packaged runtime surfaces, and a more vertically integrated execution story than Nimi's current split between runtime, SDK, and app shells.

## Key Findings

1. Runtime packaging is tightly coupled to the agent host, which reduces integration ambiguity but limits downstream composition flexibility.
2. Capability boundaries are clearer around local execution than around remote provider extension points.
3. The implementation favors operational control and local orchestration over shallow public contracts.
4. Security posture benefits from fewer cross-layer seams, but the resulting system is harder to extend safely without privileged host access.

## Nimi Comparison Notes

1. Nimi's spec-first contracts remain a differentiator for maintainability and cross-surface consistency.
2. OpenFang highlights the value of stronger runtime observability, packaged deployment flows, and explicit extension lifecycle control.
3. Future backlog items that strengthen runtime operations, host lifecycle management, and local execution guarantees are supported by this comparison.
