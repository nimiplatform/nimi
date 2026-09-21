# Kit Core

## What It Is
Pure shared logic module for shell-mode detection, env helpers, OAuth utilities,
renderer-safe storage JSON helpers, and reusable headless notification
presentation helpers.

## Public Surfaces
- `@nimiplatform/kit/core/shell-mode`
- `@nimiplatform/kit/core/oauth`
- `@nimiplatform/kit/core/storage-json`
- `@nimiplatform/kit/core/offline-coordinator`
- `@nimiplatform/kit/core/notifications`
- `@nimiplatform/kit/core/audio`: bounded float32 WAV frames, min/max waveforms,
  same-rate/channel mixing and streaming WAV output, with an explicit Worker port.
- Current surfaces:
  - `headless`: active
  - `ui`: none
  - `runtime`: none
  - `realm`: none

## When To Use It
- Share logic that must stay UI-free and framework-light.
- Parameterize OAuth or capability logic without app bindings.
- Coordinate app-shell connectivity/reconnect state without owning Runtime or
  Realm reachability truth.
- Reuse notification filter, badge, and action-eligibility helpers without
  putting presentation vocabulary in SDK or app-local forks.

## What Stays Outside
- React hooks and CSS.
- App shell assumptions.
- Direct runtime or realm business-service integration.

## Current Consumers
- `desktop`
- `lab`
- `web`

## Canonical audio

`inspectCanonicalWav` checks RIFF chunks, float32 format, fact frames and complete
byte extent. It is a header inspection, not a full finite-sample scan or Runtime
artifact authorization. `readPcmFrames` verifies each requested window. Supply
`PcmByteSource.read` using protected asset ranges, comparing returned SHA, size
and MIME with the pinned asset on every call.

The WAV reader keeps one MiB of bounded read-ahead per source and permits one
in-flight source read. PCM processing still uses at most 16,384 frames. This
avoids repeating a protected asset's full integrity verification for each small
DSP block; no validation is removed and no full-song buffer is created.

`buildPcmWaveform` returns at most 65,536 min/max bins. `mixPcmBlock` takes up to
eight already aligned blocks in the same sample-rate/channel domain. The App
places tracks and asks Runtime for explicit resampled derivatives when needed.
Over-range peaks are reported, never silently clipped. Feed `encodePcmWav` to an
atomic streamed asset write; missing/extra frames or cancellation must never
become a saved version.

Bundle a dedicated Worker in the consuming App:

```ts
import { executePcmWorkerRequest, pcmWorkerReplyTransfers } from '@nimiplatform/kit/core/audio';
self.onmessage = event => {
  const reply = executePcmWorkerRequest(event.data);
  self.postMessage(reply, { transfer: pcmWorkerReplyTransfers(reply) });
};
```

Pass it to `createPcmWorkerClient`, await each block, and `close()` in `finally`.
Sample buffers transfer to the Worker and must not be reused. Each client allows
one request at a time and terminates on cancellation, failure or a 30-second
per-block deadline. It opens no files, selects no models and owns no project
state. PCM operations do not prove synthesis or listening quality.

## Verification
- `pnpm --filter @nimiplatform/kit build`
- `pnpm check:nimi-kit`
