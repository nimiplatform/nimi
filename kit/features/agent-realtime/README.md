# Agent Realtime

Canonical Kit entry and headless session management for the formal App client's typed `agentRealtime` namespace.

## Public Surfaces

- `@nimiplatform/kit/features/agent-realtime`
- `@nimiplatform/kit/features/agent-realtime/headless`
- `@nimiplatform/kit/features/agent-realtime/ui`
- `@nimiplatform/kit/features/agent-realtime/types`

## Entry and Session Behavior

`AgentRealtimeEntry` accepts:

- A formal App client narrowed to `agents` and `agentRealtime`
- An optional Host-supplied `initialAgentHandle`
- An optional Runtime-issued conversation anchor
- A proposed input format (actual capture uses the negotiated tuple returned by Runtime)
- A Host media-mechanics port

Kit lists only the canonical minimal Agent references, requires an explicit selection when `initialAgentHandle` is omitted, and binds the chosen handle to the shared headless session. Apps do not need to duplicate reference state, selector copy, or session helpers. The shared session manages lifecycle, pressure, error, output-track, and local session-epoch state without opening a second SDK client or Runtime session family.

## Browser and Electron Media Port

`createBrowserAgentRealtimeHostMediaPort()` provides the shared browser and Electron renderer media mechanics:

- Calls `getUserMedia` only after an explicit `requestCapture` action.
- Owns OS microphone state, PCM framing, device-loss cleanup, Web Audio scheduling, and physical playback.
- Remains strictly a media adapter—it never synthesizes capability declarations, coverage, App availability, product results, or Runtime error state.

## Output Playback and Interruption

The updated LocalAgent life and close behavior requires matching Runtime, SDK, and Kit/native source builds for the next 0.x minor release.

Runtime can finish generating an output track before local audio finishes playing. The Host media adapter's `finishOutputTrack` promise settles only after queued audio drains (or when interruption or session close releases it). Until then, Kit keeps the output track interruptible without blocking incoming Runtime events.

The shared entry streams the latest Runtime-projected reply text as it arrives, including when audio is unavailable or suppressed by the Runtime presentation owner. Final text replaces streaming deltas for that track, while any result continuation stays beside the earlier reply. Kit never parses private tool syntax or infers whether an intention was accepted.

- **`interruptOutput`**: Returns `null` when it only stops remaining local playback; otherwise, it returns the Runtime operation result.
- **Agent-turn interruption**: Explicit turn interruption always dispatches to Runtime against the original output request. Because a completed native response may only represent a private intention step, the user turn remains active through its result continuation.
- **Session close**: Closing explicitly interrupts any unfinished owned turn (even before an output track exists) while preserving committed intentions. Capture stopped solely due to closing is discarded rather than submitted.

## Ownership Boundary

The Runtime client remains the sole owner of negotiated media, transient pressure, speech, transcript, output-track, lifecycle, and terminal state. Kit forwards bounded PCM output to the Host and never exposes provider/model/route metadata, decoder clocks, visemes, mouth parameters, raw identities, or private Runtime ingress. Output interruption mutates the Agent turn only when the caller explicitly passes that SDK intent.
