---
spec_status: preflight-required
authority_owner: spec/**
work_type: redesign
parallel_truth: no
admission_status: modeled_not_admitted
current_authority_root: spec/**
future_candidate_authority_root: .nimi/spec/**
generated_canonical_root_today: .nimi/spec/**
benchmark_oracle_root_today: spec/**
long_lived_parallel_truth_allowed: false
---

# Canonical Authority Cutover Admission

This document models the redesign admission packet that would be required before
any future `spec/** -> .nimi/spec/**` authority cutover is executed.

Today:

- `spec/**` remains the repo-wide normative product authority.
- `/.nimi/spec/**` remains the generated canonical tree for AI-side methodology work.
- readiness evidence does not authorize an authority flip on its own.

Future cutover requirements:

- an explicit redesign admission must approve the authority owner change
- benchmark/oracle posture must remain explicit during any transition window
- long-lived parallel truth is not allowed
- migration execution requires a separate cutover plan after this admission is approved
