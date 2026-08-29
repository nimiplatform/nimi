# Agent Realtime

Canonical Kit entry and headless session behavior for the formal App client's
typed `agentRealtime` namespace.

## Public surfaces

- `@nimiplatform/kit/features/agent-realtime`
- `@nimiplatform/kit/features/agent-realtime/headless`
- `@nimiplatform/kit/features/agent-realtime/ui`
- `@nimiplatform/kit/features/agent-realtime/types`

`AgentRealtimeEntry` receives one formal App client narrowed to `agents` and
`agentRealtime`, an optional Host-supplied current `initialAgentHandle`, an
optional Runtime-issued conversation anchor, the requested input format, and
one Host media-mechanics port. Kit lists only the canonical minimal Agent
references, requires an explicit choice when no current handle was supplied,
and binds the selected handle to the same headless session. Apps do not copy
reference state, selector copy, or session helpers. The shared session owns
lifecycle, pressure, error, output-track, and local session-epoch reduction and
does not open a second SDK client or Runtime session family.

`createBrowserAgentRealtimeHostMediaPort()` is the shared browser/Electron
renderer mechanics factory. `getUserMedia` runs only after the explicit
`requestCapture` action. The factory owns OS microphone posture, PCM framing,
device-loss cleanup, Web Audio scheduling, and physical playback; it never
creates declaration, coverage, App availability, product result, or Runtime
error truth.

The Runtime client remains the sole owner of negotiated media, transient
pressure, speech, transcript, output-track, lifecycle, and terminal facts.
Kit forwards bounded PCM output to the Host and never exposes a provider,
model, route, decoder clock, viseme, mouth parameter, raw identity, or private
Runtime ingress. Output interruption mutates the Agent turn only when the
caller explicitly passes that existing SDK intent.
