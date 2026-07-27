# Cross-Surface Continuity

Continuity comes from shared owner truth, not from synchronizing UI state.

Realm supplies the Character and Character Source. Runtime materializes the
LocalAgent and owns its Conversation, operational Memory and Knowledge, state,
and presentation projections. Each surface receives a bounded view through the
standard SDK according to the current session and authorization.

## What may move between surfaces

- stable Character and LocalAgent references;
- an explicit Runtime Conversation anchor;
- committed Conversation projections and typed status;
- authorized presentation and voice artifacts.

These values remain references or projections. A receiving surface does not
become their owner.

## What stays local

Window layout, renderer state, playback controls, route state, draft input, and
other ephemeral UI details stay with the consumer. A local cache may improve
rendering but cannot become recovery, Conversation, Memory, Knowledge, or
authorization truth.

When authorization changes or an anchor is stale, the consumer must use the
typed Runtime result. Copying another surface's cached state is not a fallback.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
