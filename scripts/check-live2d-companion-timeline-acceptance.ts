import assert from 'node:assert/strict';
import {
  projectNimiRuntimeAgentAppMessageEvent,
  summarizeNimiRuntimeAgentTimeline,
  toNimiRuntimeProtoStruct,
  type NimiRuntimeAgentConsumeClient,
} from '../sdks/typescript/runtime/index.ts';
import { SdkDriver } from '../apps/avatar/src/shell/renderer/sdk/SdkDriver.ts';
import type { AgentDataBundle, AgentDataDriver, AppOriginEvent, DriverStatus } from '../apps/avatar/src/shell/renderer/driver/types.ts';
import { wireAvatarVoiceLipsync } from '../apps/avatar/src/shell/renderer/voice-lipsync/avatar-voice-lipsync.ts';
import type { AudioPlaybackState } from '@nimiplatform/kit/features/avatar/headless';

const turnId = 'acceptance-turn-1';
const streamId = 'acceptance-stream-1';
const ownerUserId = 'user-acceptance';
const realmAgentId = 'agent-acceptance';
const localAgentRef = `local-agent:${ownerUserId}:${realmAgentId}`;

const runtimePayload = {
  agent_id: localAgentRef,
  conversation_anchor_id: 'anchor-acceptance',
  turn_id: turnId,
  stream_id: streamId,
  runtime_timeline: {
    turn_id: turnId,
    stream_id: streamId,
    channel: 'text',
    offset_ms: 120,
    sequence: 7,
    started_at_wall: '2026-04-25T00:00:00.000Z',
    observed_at_wall: '2026-04-25T00:00:00.120Z',
    timebase_owner: 'runtime',
    projection_rule_id: 'K-AGCORE-051',
    clock_basis: 'monotonic_with_wall_anchor',
    provider_neutral: true,
    app_local_authority: false,
  },
  structured: {
    acceptance_marker: 'avatar-runtime-timeline',
  },
};

const sdkEvent = projectNimiRuntimeAgentAppMessageEvent({
  messageType: 'runtime.agent.turn.structured',
  payload: toNimiRuntimeProtoStruct(runtimePayload),
});
assert.ok(sdkEvent, 'Runtime Agent app message must project into an SDK consume event');
assert.equal(sdkEvent.turnId, turnId);
assert.equal(sdkEvent.streamId, streamId);
assert.equal(sdkEvent.timeline?.timebaseOwner, 'runtime');
assert.equal(sdkEvent.timeline?.appLocalAuthority, false);
assert.deepEqual(summarizeNimiRuntimeAgentTimeline(sdkEvent), {
  turnId,
  streamId,
  channel: 'text',
  offsetMs: 120,
  sequence: 7,
  startedAtWall: '2026-04-25T00:00:00.000Z',
  observedAtWall: '2026-04-25T00:00:00.120Z',
  timebaseOwner: 'runtime',
  projectionRuleId: 'K-AGCORE-051',
  clockBasis: 'monotonic_with_wall_anchor',
  providerNeutral: true,
  appLocalAuthority: false,
});

async function* streamRuntimeEvents() {
  yield sdkEvent;
  await new Promise(() => {});
}

const runtimeAgent = {
  turns: {
    getSessionSnapshot: async () => ({
      sessionStatus: 'active',
      transcriptMessageCount: 0,
    }),
    subscribe: async () => streamRuntimeEvents(),
  },
} satisfies NimiRuntimeAgentConsumeClient;

async function main(): Promise<void> {
  const driver = new SdkDriver({
    runtimeAgent,
    ownerUserId,
    realmAgentId,
    localAgentRef,
    conversationAnchorId: 'anchor-acceptance',
    activeWorldId: 'world-acceptance',
    activeUserId: ownerUserId,
    locale: 'en-US',
    now: () => 1_714_000_000_000,
  });

  const observedEvents: AppOriginEvent[] = [];
  const playbackStates: AudioPlaybackState[] = [];
  let stopReason: string | null = null;
  driver.onEvent((event) => {
    observedEvents.push({ name: event.name, detail: event.detail });
  });

  const unwire = wireAvatarVoiceLipsync({
    driver: driver as AgentDataDriver,
    stateBus: {
      publish(event) {
        if (event.kind === 'audio_playback_state') {
          playbackStates.push(event.state);
        }
      },
      subscribe() {
        return () => {};
      },
    },
    audioPipeline: {
      play: async () => {},
      stop(reason) {
        stopReason = reason;
      },
      registerLipsyncSink() {
        return () => {};
      },
    },
  });

  await driver.start();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const avatarPassthrough = observedEvents.find((event) => event.name === 'runtime.agent.turn.structured');
  assert.equal(avatarPassthrough?.detail.turn_id, turnId);
  assert.equal(avatarPassthrough?.detail.stream_id, streamId);
  assert.equal((avatarPassthrough?.detail.runtime_timeline as Record<string, unknown> | undefined)?.timebase_owner, 'runtime');

  assert.equal(
    observedEvents.some((event) => event.name === 'avatar.speak.start'),
    false,
  );

  driver.emit({
    name: 'runtime.agent.turn.interrupted',
    detail: {
      turn_id: turnId,
      stream_id: streamId,
      runtime_timeline: {
        ...(avatarPassthrough?.detail.runtime_timeline as Record<string, unknown>),
        sequence: 8,
      },
    },
  });
  driver.emit({
    name: 'runtime.agent.turn.structured',
    detail: avatarPassthrough?.detail ?? {},
  });

  assert.equal(stopReason, 'interrupted');
  assert.ok(playbackStates.includes('interrupted'));

  unwire();
  await driver.stop();

  const _bundle: AgentDataBundle = driver.getBundle();
  const _status: DriverStatus = driver.status;

  console.log('Live2D companion timeline acceptance passed.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
