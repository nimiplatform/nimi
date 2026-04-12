# oh-my-codex Adapter Sketch

This adapter sketch defines how to use `@nimiplatform/nimi-coding` with
`oh-my-codex` (OMX) without turning OMX into the semantic owner.

## Intent

Use OMX for:

- multi-agent or role-based execution
- external host routing
- long-running or autonomy-first execution behavior
- operational observability

Keep `nimicoding` responsible for:

- project-local `.nimi/**` truth
- authority boundaries
- handoff constraints
- packet, prompt, worker-output, and acceptance schema ownership
- fail-closed validation

## Boundary

Treat the systems as layered rather than merged:

- `@nimiplatform/nimi-coding` is the semantic kernel.
- `oh-my-codex` is a constrained external execution host.
- This adapter is only the bridge.

OMX may read `.nimi/**` and produce execution artifacts, but it must not:

- become the owner of `.nimi/spec/**`
- decide semantic acceptance or final disposition
- redefine methodology state from `.omx/**` runtime state
- bypass `nimicoding doctor`, `handoff`, or validator gates

## Current Audit Summary

The current package is already boundary-complete for standalone adapter use:

- bootstrap seeding includes `skill-manifest`, `host-profile`, delegated
  `skill-runtime`, and `skill-handoff`
- `doctor` fail-closes when delegated-runtime posture, host-adapter truth, or
  the package-owned OMX adapter overlay drifts
- the generic external-host compatibility contract remains the baseline, and
  OMX only adds an admitted overlay on top of it
- `nimicoding doctor` and `nimicoding handoff` now report the supported
  host posture directly from that packaged compatibility contract, alongside
  named overlay status and future-only host-specific surfaces
- `handoff --json` exports the authoritative machine contract, while
  `handoff --prompt` remains a human-readable projection, and both include
  selected OMX overlay metadata
- `closeout` safely projects external results into local-only artifacts
- execution artifact validators already exist for packet, orchestration-state,
  prompt, worker-output, and acceptance

The main remaining gap is not boundary definition. It is automation:

- `high_risk_execution` now has a packaged local-only result contract
- this package intentionally does not ship a packet-bound run kernel,
  provider execution, or automatic canonical semantic promotion loop
- the adapter profile marks `run-next-prompt` as a future-only, not-packaged
  surface rather than an available standalone command

That means OMX interop is already viable for prompt/output/evidence handoff,
named host-profile recognition, and explicit manager-owned admission, but
final high-risk completion should still stay bounded by `nimicoding`
validators, explicit local closeout/decision/ingest/review surfaces, and
manual manager-side admission rather than automatic semantic promotion. The
canonical admission target is now also shape-validated by a package-owned
admission schema contract before `nimicoding` accepts it as semantic truth.

## Recommended First-User Flow

### 1. Bootstrap project-local truth

Run inside the target project:

```sh
nimicoding start
nimicoding doctor
```

The result must keep delegated runtime ownership and non-self-hosted posture
clean before OMX is introduced.

### 2. Reconstruct `.nimi/spec/**` through explicit handoff

Export the authoritative bootstrap handoff contract:

```sh
nimicoding handoff --skill spec_reconstruction --json
```

Use the JSON payload as OMX's machine contract. `--prompt` may still be used
as a host briefing, but it is not the authoritative surface. OMX should
return only the declared canonical tree outputs and must not invent new semantic
owners.

Then project the closeout locally:

```sh
nimicoding closeout \
  --skill spec_reconstruction \
  --outcome completed \
  --verified-at 2026-04-11T00:00:00Z \
  --from <result.json> \
  --write-local
```

### 3. Audit drift before execution

If needed:

```sh
nimicoding handoff --skill doc_spec_audit --prompt
nimicoding closeout --skill doc_spec_audit --outcome completed --verified-at <utc> --from <result.json> --write-local
```

This stays local-only and must not replace semantic truth.

### 4. Dispatch high-risk execution through OMX

Export the high-risk handoff contract:

```sh
nimicoding handoff --skill high_risk_execution --json
```

OMX should consume the declared `.nimi/**` context and produce:

- packet/orchestration/prompt/worker-output/evidence refs under the declared
  local artifact roots in `.nimi/config/external-execution-artifacts.yaml`
- a local-only external execution summary that satisfies the packaged
  `high_risk_execution` result contract
- no claim of semantic completion, acceptance, or disposition

The worker output must satisfy the seeded schema and include the strict
`Runner Signal` block shape expected by the promoted internal methodology.

### 5. Keep semantic review in `nimicoding`

For now, treat OMX output as execution candidate material:

- validate packet, prompt, worker-output, and acceptance mechanically
- keep final acceptance/disposition under manager-owned `nimicoding` review
- keep `.omx/**` state operational only

In practice, this means the first real user can use OMX as the execution host
today, while standalone `nimicoding` remains the host-agnostic semantic and
interop boundary package. The promoted internal
[`nimi-coding`](/Users/snwozy/nimi-realm/nimi/nimi-coding) still owns
packet-bound runtime, provider-backed execution, scheduler, notification, and
automation surfaces, even though standalone
`nimicoding closeout` can now import a fail-closed local-only execution
summary and `nimicoding ingest-high-risk-execution` can mechanically validate
the referenced packet/prompt/output candidates while
`nimicoding review-high-risk-execution` can project a manager-ready local
attachment bundle, `nimicoding decide-high-risk-execution` can record a
manager-owned local disposition, and `nimicoding admit-high-risk-decision`
can explicitly write canonical summary admission into `.nimi/spec` without
promoting OMX runtime state.

## Mapping

| OMX concern | Adapter rule | `nimicoding` owner |
|---|---|---|
| planning/execution routing | operational only | none |
| prompt handoff | consume exported prompt/context | `.nimi/methodology/skill-handoff.yaml` |
| worker output | write candidate artifact only under declared local roots | `.nimi/contracts/worker-output.schema.yaml` |
| evidence | write candidate artifact only under declared local roots | packet/evidence contract family |
| final disposition | OMX must not decide | manager-reviewed `nimicoding` semantics |

## Next Product Steps

The minimum follow-up work from here is:

1. Add canonical semantic promotion automation around the explicit admission
   surface so manager-owned decisions no longer require manual admission steps.
2. Keep host-specific runtime execution support out of standalone unless a
   later admitted packet explicitly expands package ownership.
