# Cross-Surface Continuity

Switch screens and the conversation is still there. That continuity comes from
a single shared source kept by Realm and Runtime — not from surfaces syncing
UI state with each other.

Realm supplies the Character and the Character Source. Runtime runs the
LocalAgent and keeps its Conversation, operational Memory and Knowledge,
state, and presentation output. Each surface gets a bounded view through the
standard SDK, according to the current session and what it is authorized to
see.

## What may move between surfaces

- stable Character and LocalAgent references;
- an explicit Runtime Conversation anchor;
- committed Conversation views and typed status;
- authorized presentation and voice artifacts.

A receiving surface holds references and views, not ownership of what they
point to.

## What stays local

Window layout, renderer state, playback controls, route state, draft input,
and other short-lived UI details stay with the consumer. A local cache can
make rendering faster, but it can never stand in for recovery, Conversation,
Memory, Knowledge, or authorization data.

When authorization changes or an anchor goes stale, the consumer must use the
typed result Runtime returns. Copying another surface's cached state is not a
fallback.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
