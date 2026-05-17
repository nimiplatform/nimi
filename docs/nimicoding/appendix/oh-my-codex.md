# Appendix: oh-my-codex Adapter

`oh-my-codex` is one admitted external execution host adapter
overlay shipped with the package. It illustrates how a specific
host can be admitted as a constrained bridge without becoming a
semantic owner.

This page is an **appendix**, not a first-class concept. The
methodology is host-agnostic; oh-my-codex is one example of an
admitted overlay. Other host overlays can follow the same
pattern.

## What The Overlay Provides

| File | Purpose |
| --- | --- |
| `adapters/oh-my-codex/profile.yaml` | The admitted overlay profile for `oh-my-codex` as host |

The overlay declares:

- That `oh-my-codex` is admitted as a constrained bridge.
- Which host-class capabilities it satisfies.
- Any host-specific routing detail that the package admits.

Critically, it does **not** declare semantic ownership; the
methodology core stays vendor-neutral.

## When To Use

Use the `oh-my-codex` overlay when:

- Your project uses `oh-my-codex` as the AI host for skill
  dispatch.
- You want named overlay metadata in `nimicoding doctor` output
  (vs. generic external host profile).

## When Not To Use

Use the generic external host profile (no overlay) when:

- Your project uses an admitted host (Claude / Codex / Gemini /
  etc.) directly.
- You don't need host-specific routing detail beyond the
  vendor-neutral profile.

The package's design promise: any contract-observing host can be
used; named overlays are convenience, not requirement.

## Reader Scenario: Switching From oh-my-codex To Another Host

Your project has been using `oh-my-codex`. You want to switch to
a different admitted host.

| Step | Action |
| --- | --- |
| Methodology change | None — package source unchanged |
| Adapter change | Optionally remove the `oh-my-codex` overlay if you no longer use it; otherwise, leave for documentation |
| New host | Use the generic external host profile or write a new adapter overlay if needed |
| Existing artifacts | Topic / wave / packet / closeout records from `oh-my-codex` runs stay valid |

The methodology's portability is exactly the value. Switching
hosts does not invalidate past work.

## Reader Scenario: Adding A New Host Adapter

Suppose you want to add an overlay for a host called "host-x".

| Step | Action |
| --- | --- |
| Create `adapters/host-x/profile.yaml` | Following the `oh-my-codex` overlay shape |
| Declare host-class capabilities | Which required ones the host satisfies |
| Declare hard constraints satisfied | Vendor-neutral, no local-runtime, no orchestration ownership |
| Document host-specific routing detail | Only what is admissible without leaking into methodology core |
| Test with `nimicoding doctor` | Validates compatibility |

Once admitted, your new adapter becomes available alongside
`oh-my-codex`. The package supports multiple admitted overlays;
you choose which to use per project context.

## What This Appendix Does Not Claim

This page doesn't claim `oh-my-codex` is the only admitted
external execution host, the preferred host, or required for
adoption. It is one example of an overlay shape that other
admitted hosts can follow.

This page also does not document `oh-my-codex` itself — that is
the upstream tool's documentation, not this package's
documentation.

## Source Basis

- [`nimi-coding/adapters/oh-my-codex/profile.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/adapters/oh-my-codex/profile.yaml)
- [`nimi-coding/config/host-adapter.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/config/host-adapter.yaml)
- [`nimi-coding/contracts/external-host-compatibility.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/external-host-compatibility.yaml)
- [`nimi-coding/methodology/skill-runtime.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/skill-runtime.yaml)
- [`nimi-coding/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/skill-handoff.yaml)
