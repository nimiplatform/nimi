# How To Admit An External Host

You want to use a new AI host for your Nimi-Coding-adopting
project. The package is host-agnostic, but each host needs to
satisfy required capabilities.

## Recipe

1. **Verify host capability flags.**
   - `read_project_local_nimi_truth`
   - `route_declared_external_skills`
   - `fail_closed_on_missing_authority`
2. **Verify hard constraints.**
   - `vendor_neutral_profile_only`
   - `do_not_assume_local_runtime_install`
   - `do_not_claim_packet_orchestration_ownership`
3. **Use the generic external host profile** if no admitted
   adapter overlay exists for this host.
4. **Or write a host adapter overlay** under
   `adapters/<host-name>/profile.yaml` if host-specific routing
   is needed and the package admits it.
5. **Run `nimicoding doctor`** to validate the host posture.
   If the doctor reports the host as compatible, you can use
   it.
6. **Hand off via `nimicoding handoff --skill <skill> --json`**
   under the new host.
7. **Closeout** as usual.

## Required Capabilities — In Detail

### `read_project_local_nimi_truth`

The host must be able to read `.nimi/methodology/`,
`.nimi/spec/`, `.nimi/contracts/`, etc., as part of its context.
A host that ignores project-local truth and relies only on its
own training data fails this check.

### `route_declared_external_skills`

The host must accept the package's typed handoff payload and
route it to the appropriate skill. A host that re-interprets
payloads or substitutes its own skill set fails this check.

### `fail_closed_on_missing_authority`

The host must not synthesize output when required authority is
absent. A host that hallucinates plausible content when source
basis is missing fails this check.

This is the most distinctive requirement. Many AI hosts default
to "always produce something." Nimi Coding requires "produce
nothing if authority is missing."

## Hard Constraints — In Detail

### `vendor_neutral_profile_only`

The host adapter cannot smuggle vendor-specific contracts back
into the package. Vendor-specific behavior lives in the adapter
overlay, not in the methodology core.

### `do_not_assume_local_runtime_install`

The host cannot require the package to install a local runtime.
The package's posture is `runtime_installed: false`,
`installation_mode: deferred`.

### `do_not_claim_packet_orchestration_ownership`

The host cannot pretend to own packet lifecycle. The manager
admits packets; the host (worker / auditor) acts within them.

## Using The Generic Profile

The generic external host profile lives at
`config/host-profile.yaml`:

```yaml
host_profile:
  id: external_ai_host
  host_class: ai_native_coding_host
  ownership_mode: external
  execution_mode: delegated
  install_state: not_installed
  self_hosted: false
```

Any host satisfying the required capabilities can be admitted
under this generic profile. No adapter overlay required for
basic use.

## Writing An Adapter Overlay

If host-specific routing or named-overlay metadata is needed:

1. **Create `adapters/<host-name>/profile.yaml`.** Declare the
   host as a constrained bridge.
2. **Reference required capability flags.** State that the host
   satisfies the required set.
3. **Document any host-specific routing detail** that does not
   leak into methodology core.
4. **Test with `nimicoding doctor`.** The doctor validates
   admitted overlay compatibility.

The package ships an example overlay at
`adapters/oh-my-codex/profile.yaml`. See
[Appendix → oh-my-codex](/nimicoding/appendix/oh-my-codex) for
that specific example.

## Reader Scenario: Admitting A New Host

You want to use Host X for your project's
`high_risk_execution` runs.

| Step | Action |
| --- | --- |
| Verify capabilities | Host X reads project-local truth, routes typed skills, fails closed on missing authority |
| Verify constraints | Host X is vendor-neutral-compatible, does not require local runtime, does not claim packet orchestration |
| Use generic profile | Yes — no adapter overlay needed for first use |
| `nimicoding doctor` | Reports compatible |
| Hand off | `nimicoding handoff --skill high_risk_execution --json` |
| Result | Host X executes; package admits result |

If the host does not satisfy capability checks, do not use it.
The package does not silently degrade.

## Reader Scenario: Removing A Host

You want to stop using a host.

| Step | Action |
| --- | --- |
| Stop dispatching new work to it | Self-explanatory |
| Existing artifacts stay | Past work under the host is canonical |
| Remove adapter overlay if exists | Delete `adapters/<host-name>/profile.yaml` |
| Existing topic / wave artifacts unchanged | They are records of past work, not active configuration |

The methodology's portability means switching hosts is reversible
and does not require data migration.

## What To Watch For

| Symptom | Meaning |
| --- | --- |
| Host hallucinates content when authority absent | Capability `fail_closed_on_missing_authority` not satisfied; reject |
| Host wants to run packets autonomously | Constraint `do_not_claim_packet_orchestration_ownership` not satisfied; reject |
| Host needs local runtime install | Constraint `do_not_assume_local_runtime_install` not satisfied; reject |
| Adapter overlay smuggles vendor-specific contracts into methodology | Constraint `vendor_neutral_profile_only` not satisfied; reject |

## Source Basis

- [`nimi-coding/config/host-profile.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/config/host-profile.yaml)
- [`nimi-coding/config/host-adapter.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/config/host-adapter.yaml)
- [`nimi-coding/contracts/external-host-compatibility.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/external-host-compatibility.yaml)
- [`nimi-coding/methodology/skill-runtime.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/skill-runtime.yaml)
- [`nimi-coding/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/skill-handoff.yaml)
- [`nimi-coding/adapters/oh-my-codex/profile.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/adapters/oh-my-codex/profile.yaml) (example)
