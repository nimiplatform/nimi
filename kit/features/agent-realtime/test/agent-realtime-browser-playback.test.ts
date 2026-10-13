import { expect, it } from 'vitest';
import { playbackFixture } from './playback-fixture';

it('retains a completed track until actual playback drains and disconnects ended nodes', async () => {
  const fixture = playbackFixture();
  await fixture.write();
  await fixture.write();
  let drained = false;
  const pending = fixture.host.playback.finishOutputTrack({ outputTrackId: 'track', lifecycle: 'completed' })
    .then(() => { drained = true; });
  await Promise.resolve();
  expect(drained).toBe(false);
  fixture.sources[0]!.onended?.();
  await Promise.resolve();
  expect(drained).toBe(false);
  fixture.sources[1]!.onended?.();
  await pending;
  expect(drained).toBe(true);
  expect(fixture.sources.every((source) => source.disconnect.mock.calls.length === 1)).toBe(true);
  await fixture.host.playback.close();
});

it('settles completion when all audio ended before the completed event arrived', async () => {
  const fixture = playbackFixture();
  await fixture.write();
  fixture.sources[0]!.onended?.();
  await fixture.host.playback.finishOutputTrack({ outputTrackId: 'track', lifecycle: 'completed' });
  await fixture.host.playback.close();
});

it.each(['interrupt', 'close'] as const)('%s stops the queued tail and releases its completed wait', async (action) => {
  const fixture = playbackFixture();
  for (let index = 0; index < 5; index++) await fixture.write();
  const pending = fixture.host.playback.finishOutputTrack({ outputTrackId: 'track', lifecycle: 'completed' });
  if (action === 'interrupt') await fixture.host.playback.interruptOutputTrack({ outputTrackId: 'track' });
  else await fixture.host.playback.close();
  await pending;
  expect(fixture.sources.every((source) => source.stop.mock.calls.length === 1)).toBe(true);
  await fixture.host.playback.close();
});

it.each(['interrupt', 'close', 'owner-interrupted', 'owner-failed'] as const)('%s prevents a frame waiting for AudioContext resume from starting later', async (action) => {
  const fixture = playbackFixture();
  let resumed!: () => void;
  fixture.context.state = 'suspended';
  fixture.context.resume.mockImplementation(() => new Promise<void>((resolve) => { resumed = resolve; }));
  const writing = fixture.write();
  const draining = fixture.host.playback.finishOutputTrack({ outputTrackId: 'track', lifecycle: 'completed' });
  if (action === 'interrupt') await fixture.host.playback.interruptOutputTrack({ outputTrackId: 'track' });
  else if (action === 'close') await fixture.host.playback.close();
  else await fixture.host.playback.finishOutputTrack({ outputTrackId: 'track', lifecycle: action === 'owner-interrupted' ? 'interrupted' : 'failed' });
  await draining;
  resumed();
  await writing;
  expect(fixture.sources).toHaveLength(0);
  await fixture.host.playback.close();
});

it('completed waits for a previously accepted frame still resuming the audio context', async () => {
  const fixture = playbackFixture();
  let resumed!: () => void;
  fixture.context.state = 'suspended';
  fixture.context.resume.mockImplementation(() => new Promise<void>((resolve) => { resumed = resolve; }));
  const writing = fixture.write();
  let drained = false;
  const pending = fixture.host.playback.finishOutputTrack({ outputTrackId: 'track', lifecycle: 'completed' })
    .then(() => { drained = true; });
  resumed();
  await writing;
  expect(drained).toBe(false);
  fixture.sources[0]!.onended?.();
  await pending;
  await fixture.host.playback.close();
});
