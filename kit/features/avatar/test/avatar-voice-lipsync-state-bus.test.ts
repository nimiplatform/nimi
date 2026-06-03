import { describe, expect, it } from 'vitest';

import { VoiceLipsyncStateBus } from '../src/headless.js';
import type { VoiceLipsyncStateBusEvent } from '../src/headless.js';

describe('VoiceLipsyncStateBus', () => {
  it('publishes events to subscribed listeners and stops after unsubscribe', () => {
    const bus = new VoiceLipsyncStateBus();
    const events: VoiceLipsyncStateBusEvent[] = [];
    const unsubscribe = bus.subscribe((event) => events.push(event));

    bus.publish({ kind: 'activate', audioArtifactId: 'artifact-1' });
    bus.publish({ kind: 'audio_playback_state', state: 'started' });
    unsubscribe();
    bus.publish({ kind: 'deactivate' });

    expect(events).toEqual([
      { kind: 'activate', audioArtifactId: 'artifact-1' },
      { kind: 'audio_playback_state', state: 'started' },
    ]);
  });
});
