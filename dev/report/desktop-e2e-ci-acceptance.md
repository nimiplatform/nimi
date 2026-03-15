# Desktop E2E CI Acceptance

Date: 2026-03-15
Scope: Linux and Windows blocking desktop E2E evidence

## purpose

Use this report to record the first successful blocking desktop E2E acceptance runs for Linux and Windows after the 0315 hard-cut. This report is evidence-oriented and should be updated from CI results, not from local macOS runs.

## required_fields

- workflow_name:
- workflow_run_id:
- workflow_run_url:
- date_utc:
- git_ref:
- git_sha:
- os:
- suites:
  - smoke:
    - command:
    - pass_fail:
    - evidence_json:
    - evidence_md:
    - artifact_root:
  - journeys:
    - command:
    - pass_fail:
    - evidence_json:
    - evidence_md:
    - artifact_root:
- prerequisites:
  - tauri_driver:
  - webdriver_runtime:
  - xvfb_or_windows_session:
- residual_risks:
- notes:

## acceptance_rules

- Linux must record one passing `smoke` run and one passing `journeys` run.
- Windows must record one passing `smoke` run and one passing `journeys` run.
- Each run must publish the generated desktop E2E evidence files and the raw artifact directory for troubleshooting.
- If any suite fails, capture the failure artifact path and keep the failed run in this report until the gate is green.
- macOS entries are optional and non-blocking. They do not satisfy `D-GATE-060` or `D-GATE-070`.

## artifact_expectations

- Scenario manifest
- Artifact manifest
- Screenshot set
- Renderer console or browser log
- Driver log
- Backend log

## current_status

- Linux: pending CI evidence
- Windows: pending CI evidence
- macOS: non-blocking manual smoke only
