# Workflows And Multimodal Execution

This page has been split into three substantive pages so each topic
gets a dedicated reference. Pick the page that matches what you
need:

- [Workflows](/runtime/workflows) — the DAG model, the 15 typed
  node kinds, the workflow state machine, branch and merge
  strategies.
- [Streaming](/runtime/streaming) — the four streaming modes,
  terminal frames, backpressure, fail-closed semantics.
- [Multimodal](/runtime/multimodal) — image, video, audio, voice,
  and music capability contracts; provider async task lifecycle;
  artifact normalization.

This page is kept only as a redirect alias to avoid breaking
existing bookmarks. Future updates land in the three pages above.

## Source Basis

- [`.nimi/spec/runtime/kernel/workflow-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/workflow-contract.md)
- [`.nimi/spec/runtime/kernel/streaming-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/streaming-contract.md)
- [`.nimi/spec/runtime/kernel/multimodal-provider-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/multimodal-provider-contract.md)
