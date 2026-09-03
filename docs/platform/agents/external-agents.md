# External Participation

External agents and external action integrations are not part of today's
LocalAgent core. Their absence holds nothing back: local AI, LocalAgent
conversations, Memory, Knowledge, voice, SDK use, Nimi Home, Avatar, and
ordinary App capability execution all work without them.

If an external integration joins in the future, it joins on Nimi's terms: as
an outside security principal with explicit limits, or as a bounded
participant view. It would not become a Character, a LocalAgent, the owner of
either, or a Conversation owner, and it would not create a new platform-wide
Agent concept.

External input must come in through the explicit, typed Runtime and SDK
boundary. Provider-native payloads, tool schemas, transport credentials, and
external execution state do not become public product facts just because some
screen can display them.

No current App should need an external action plane for basic LocalAgent
operation.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
