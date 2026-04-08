# Sample Phase Prompt

## Task Goal

Represent the minimum self-hosting nimi-coding topic with full artifact coverage.

## Authority Reads

- `nimi-coding/contracts/artifact-model.contract.md`
- `nimi-coding/contracts/staged-delivery.contract.md`

## Confirmed State

- The minimum topic already has topic-index, explore, baseline, evidence, and finding-ledger artifacts.
- Prompt, worker-output, and acceptance artifacts are missing from the sample.

## Hard Constraints

- Do not introduce artifacts beyond the promoted artifact family.
- Sample must remain validator-friendly.

## Must Complete

1. Add prompt sample to minimum-topic.
2. Add worker-output sample to minimum-topic.
3. Add acceptance sample to minimum-topic.
4. Ensure all samples pass module validation.

## Explicit Non-Goals

- No product-specific authority changes.
- No new CLI commands.
- No gate expansion beyond artifact completion.

## Required Checks

- `pnpm nimi-coding:validate-module`

## Required Final Output Format

1. Findings
2. Implementation summary
3. Files changed
4. Checks run
5. Remaining gaps / risks

## Blocker Escalation Rule

If any promoted artifact type cannot be represented as a valid sample, escalate to manager before proceeding.
