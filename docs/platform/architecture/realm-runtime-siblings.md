# Realm And Runtime As Siblings

Realm and Runtime are the two halves that make Nimi work, and they are
deliberately built as siblings — neither one depends on the other for
its existence. The SDK is the only thing that bridges them.

## Why Two Halves Instead Of One

Most AI products fuse "the cloud" and "the local AI engine" into one
system: the cloud is the source of truth, and a thin client talks to
it. Nimi splits them on purpose.

- **Realm** is the cloud truth. It owns world truth, world state,
  world history, identity, the social graph, the canonical economy,
  the asset registry, chat threads, and the cloud-side audit ledger.
  Realm is what makes "the same friend, the same wallet, the same
  agent, in any world, on any device" work.
- **Runtime** is the personal PC AI engine. It owns AI inference
  (text, image, video, audio, embeddings, STT, TTS), GPU arbitration,
  local model lifecycle, workflows, agent execution (Chat Track and
  Life Track), runtime-local memory, knowledge banks, app-to-app
  messaging, the delegated capability gateway, and a local audit
  ledger.

Each half has its own state machine, its own contracts, its own
storage, its own audit. Crucially, neither half assumes the other is
running.

## What "Sibling" Means In Practice

| Property | What it means |
| --- | --- |
| No dependency edge | Runtime does not need Realm to start; Realm does not need Runtime to start. |
| Independent failure modes | Realm offline does not block local AI work. Runtime offline does not block reading world truth from Realm. |
| Independent ownership | Runtime cannot mutate Realm truth. Realm cannot run AI on your hardware. |
| Bridged through SDK | Apps reach both through the same `@nimiplatform/sdk`; the SDK is the seam, not a back-channel between Realm and Runtime. |

There is one specific bridge that is not a sibling edge:
`Runtime ↔ Cognition`. Runtime can consume Cognition's standalone
memory and knowledge surfaces through a defined bridge contract.
That is consumption, not absorption — Cognition's authority remains
its own.

## Reader Scenario: Runtime Working While Realm Is Offline

You are running Nimi on a laptop and your network drops out.

- The Runtime daemon stays up. You can still call your local model,
  generate images on your local stable-diffusion, talk to a local
  agent, run a workflow.
- Realm reads fail. Cross-world identity, the canonical social graph,
  and economic settlement are unavailable until you reconnect.
- Local audit keeps recording. When Realm comes back, the runtime
  can optionally aggregate the local audit upward; it does not
  retroactively rewrite local audit truth.
- Apps that read both Runtime and Realm degrade gracefully — they
  show "Realm offline" rather than pretending the cloud is live.

This is what the sibling design buys: you do not lose AI capability
just because the cloud is unreachable.

## Reader Scenario: Realm Working While Runtime Is Offline

You are reading Nimi worlds on a phone or a low-power device that
does not run a local AI engine.

- Realm reads work normally. You can browse worlds, check messages,
  see your social graph, view assets.
- Local AI inference is not available — the local Runtime daemon is
  not present on this device.
- Apps that need generation either route through a Runtime on your
  primary machine (federation, future) or surface a "no runtime
  available" path. They don't silently fall back to a hosted route
  that the user did not consent to.

A device without Runtime is still a Nimi device — it is a thin
client to the truth half.

## Why The SDK Bridges Both

The SDK is what makes "two siblings" usable as one platform from an app
developer's view. A single `createNimiClient()` root client exposes Realm reads
and Runtime calls through one typed surface. The app does not need to know that
Realm is REST + WebSockets and Runtime is gRPC; it only chooses an admitted
transport profile such as `node-grpc` or `tauri-ipc`.

What the SDK does not do: it does not invent shortcuts that violate
the sibling boundary. There is no SDK call that mutates Realm truth
through a runtime path. There is no SDK call that reads runtime
local state through a realm path. The boundary that matters at the
authority level is preserved at the developer surface.

## Source Basis

- [`.nimi/spec/platform/architecture.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/architecture.md)
- [`.nimi/spec/platform/kernel/architecture-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/architecture-contract.md)
- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/sdks/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/index.md)
- [`.nimi/spec/sdks/kernel/transport-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/transport-contract.md)
- [`.nimi/spec/cognition/kernel/runtime-bridge-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/runtime-bridge-contract.md)
