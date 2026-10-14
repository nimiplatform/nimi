# Kit Core

## What It Is
Pure shared logic module providing shell-mode detection, environment helpers, OAuth utilities, renderer-safe JSON storage helpers, bounded navigation and command registries, canonical PCM audio utilities, and headless notification presentation helpers.

## Public Surfaces
- `@nimiplatform/kit/core/shell-mode`
- `@nimiplatform/kit/core/oauth`
- `@nimiplatform/kit/core/storage-json`
- `@nimiplatform/kit/core/offline-coordinator`
- `@nimiplatform/kit/core/notifications`
- `@nimiplatform/kit/core/navigation`: Typed window-local destinations and immutable snapshots via `createNimiNavigation`, supporting `push`, `replace`, `back`, `forward`, a single pending App-leave policy, forced reset/dispose, and a fixed 100-entry history bound.
- `@nimiplatform/kit/core/app-commands`: Standard command IDs, App declaration types, and `createNimiAppCommandSet`. App-defined command IDs cannot use the reserved `nimi.` prefix; duplicate IDs, unknown references, and conflicting shortcuts are rejected.
- `@nimiplatform/kit/core/audio`: Bounded `float32` WAV frames, min/max waveforms, same-rate/channel mixing, and streaming WAV output over an explicit Worker port.
- Current surfaces:
  - `headless`: active
  - `ui`: none
  - `runtime`: none
  - `realm`: none

## When To Use It
- Share pure logic that must remain UI-free and framework-light.
- Parameterize OAuth or capability logic without coupling to app bindings.
- Coordinate app-shell connectivity and reconnect state without owning Runtime or Realm reachability truth.
- Reuse notification filter, badge, and action-eligibility helpers without duplicating presentation vocabulary in the SDK or app-local forks.

## What Stays Outside
- React hooks and CSS.
- App shell assumptions.
- Direct Runtime or Realm business-service integration.

## Current Consumers
- `desktop`
- `lab`
- `web`

## Canonical Audio

- **Header inspection (`inspectCanonicalWav`)**: Validates RIFF chunks, `float32` format, `fact` frames, and complete byte extent. Note that this is a header check only—it does not perform a full finite-sample scan or grant Runtime artifact authorization.
- **Windowed frame reading (`readPcmFrames`)**: Verifies each requested window. Implement `PcmByteSource.read` using protected asset byte ranges, and verify the returned SHA, byte size, and MIME type against the pinned asset on every call. The WAV reader maintains a bounded 1 MiB read-ahead per source with at most one in-flight source read, while PCM processing operates on blocks of at most 16,384 frames. This avoids repeating full-asset integrity checks on every small DSP block without dropping validation or allocating a full-song buffer.
- **Waveforms & mixing (`buildPcmWaveform`, `mixPcmBlock`)**: `buildPcmWaveform` outputs at most 65,536 min/max bins. `mixPcmBlock` combines up to 8 pre-aligned blocks within the same sample-rate and channel domain (the consuming App positions tracks and requests explicit resampled derivatives from Runtime when needed). Over-range peaks are reported rather than silently clipped.
- **Streaming encode (`encodePcmWav`)**: Pipe `encodePcmWav` into an atomic streamed asset write; missing frames, extra frames, or cancellation must never produce a saved version.

### Worker Integration

Bundle a dedicated Worker in the consuming App:

```ts
import { executePcmWorkerRequest, pcmWorkerReplyTransfers } from '@nimiplatform/kit/core/audio';
self.onmessage = event => {
  const reply = executePcmWorkerRequest(event.data);
  self.postMessage(reply, { transfer: pcmWorkerReplyTransfers(reply) });
};
```

Pass the Worker to `createPcmWorkerClient`, `await` each block, and call `close()` in a `finally` block:

- Sample buffers are transferred to the Worker and must not be reused by the caller.
- Each client processes one request at a time and terminates upon cancellation, failure, or a 30-second per-block deadline.
- The audio module opens no files, selects no models, and owns no project state. Successful PCM operations do not certify synthesis or listening quality.

## Verification
- `pnpm --filter @nimiplatform/kit build`
- `pnpm check:nimi-kit`
