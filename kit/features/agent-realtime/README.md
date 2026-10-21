# Agent Realtime

Canonical Kit entry and headless session behavior for the formal App client's typed `agentRealtime` namespace.

## Public Surfaces

- `@nimiplatform/kit/features/agent-realtime`
- `@nimiplatform/kit/features/agent-realtime/headless`
- `@nimiplatform/kit/features/agent-realtime/ui`
- `@nimiplatform/kit/features/agent-realtime/types`

## Entry and Session Behavior

`AgentRealtimeEntry` receives:

- One formal App client narrowed to `agents` and `agentRealtime`
- An optional Host-supplied current `initialAgentHandle`
- An optional Runtime-issued conversation anchor
- A proposed input format; capture uses the Runtime-returned negotiated tuple
- One Host media-mechanics port

Kit lists only the canonical minimal Agent references, requires an explicit choice when no current handle is supplied, and binds the selected handle to the same headless session. Apps do not copy reference state, selector copy, or session helpers. The shared session owns lifecycle, pressure, error, output-track, and local session-epoch reduction without opening a second SDK client or Runtime session family.

## Browser and Electron Media Port

`createBrowserAgentRealtimeHostMediaPort()` is the shared browser/Electron renderer mechanics factory:

- `getUserMedia` runs only after the explicit `requestCapture` action.
- The factory owns OS microphone posture, PCM framing, device-loss cleanup, Web Audio scheduling, and physical playback.
- It never creates declaration, coverage, App availability, product result, or Runtime error truth.

## Output Playback and Interruption

Runtime output completion can precede physical playback. A Host media adapter's `finishOutputTrack` promise settles after the queued audio drains (or when interruption or close releases it). Kit keeps the output interruptible until then without blocking Runtime event consumption.

The shared entry displays the latest Runtime-projected reply text as it streams, including when audio is unavailable or suppressed by the Runtime presentation owner. Final text replaces that track's deltas; a result continuation remains beside the earlier reply. Kit does not parse private tool syntax or infer that an intention was accepted.

- `interruptOutput` returns `null` when only this remaining local playback is stopped; otherwise, it returns the actual Runtime operation result.
- Explicit Agent-turn interruption still goes to Runtime and is bound to the original output request. A completed native response may be only the private intention response; the original user turn remains active through its result continuation.
- Closing explicitly interrupts an unfinished owned turn, including before an output track exists, and retains committed intentions. Capture stopped solely for close is discarded, not submitted.

## Ownership Boundary

The Runtime client remains the sole owner of negotiated media, transient pressure, speech, transcript, output-track, lifecycle, and terminal facts. Kit forwards bounded PCM output to the Host and never exposes a provider, model, route, decoder clock, viseme, mouth parameter, raw identity, or private Runtime ingress. Output interruption mutates the Agent turn only when the caller explicitly passes that existing SDK intent.
