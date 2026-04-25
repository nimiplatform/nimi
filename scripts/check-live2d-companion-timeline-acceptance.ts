import assert from 'node:assert/strict';
import { parseAppConsumeEvent } from '../sdk/src/runtime/runtime-agent-surface-parsers.ts';
import { summarizeRuntimeAgentTimeline } from '../apps/desktop/src/shell/renderer/features/chat/chat-agent-runtime-agent-timeline.ts';
import { SdkDriver } from '../apps/avatar/src/shell/renderer/sdk/SdkDriver.ts';
import type { AgentDataBundle, AgentDataDriver, AppOriginEvent, DriverStatus } from '../apps/avatar/src/shell/renderer/driver/types.ts';
import {
  AVATAR_MOUTH_OPEN_SIGNAL,
  wireAvatarVoiceLipsync,
} from '../apps/avatar/src/shell/renderer/voice-lipsync/avatar-voice-lipsync.ts';

const turnId = 'acceptance-turn-1';
const streamId = 'acceptance-stream-1';

const runtimePayload = {
  agent_id: 'agent-acceptance',
  conversation_anchor_id: 'anchor-acceptance',
  turn_id: turnId,
  stream_id: streamId,
  timeline: {
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
  detail: {
    kind: 'avatar.voice_timing',
    payload: {
      voice_timing: {
        adapter_id: 'runtime.voice.timeline-levels',
        frames: [
          { offset_ms: 0, mouth_open_y: 0.14 },
          { offset_ms: 80, mouth_open_y: 0.82 },
          { offset_ms: 160, mouth_open_y: 0.28 },
        ],
      },
    },
  },
};

const sdkEvent = parseAppConsumeEvent('runtime.agent.turn.structured', runtimePayload);
assert.equal(sdkEvent.turnId, turnId);
assert.equal(sdkEvent.streamId, streamId);
assert.equal(sdkEvent.timeline?.timebaseOwner, 'runtime');
assert.equal(sdkEvent.timeline?.appLocalAuthority, false);

const desktopTimeline = summarizeRuntimeAgentTimeline(sdkEvent);
assert.deepEqual(desktopTimeline, {
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

const runtime = {
  agent: {
    turns: {
      getSessionSnapshot: async () => ({
        sessionStatus: 'active',
        transcriptMessageCount: 0,
      }),
      subscribe: async () => streamRuntimeEvents(),
    },
  },
};

async function main(): Promise<void> {
  const driver = new SdkDriver({
    runtime: runtime as never,
    agentId: 'agent-acceptance',
    conversationAnchorId: 'anchor-acceptance',
    activeWorldId: 'world-acceptance',
    activeUserId: 'user-acceptance',
    locale: 'en-US',
    now: () => 1_714_000_000_000,
  });

  const observedEvents: AppOriginEvent[] = [];
  const parameterWrites: Array<{ signalId: string; value: number; weight?: number }> = [];
  driver.onEvent((event) => {
    observedEvents.push({ name: event.name, detail: event.detail });
  });

  const projection = {
    triggerMotion: async () => undefined,
    stopMotion: () => undefined,
    setSignal: (signalId: string, value: number, weight?: number) => {
      parameterWrites.push({ signalId, value, weight });
    },
    getSignal: () => 0,
    addSignal: () => undefined,
    setExpression: async () => undefined,
    clearExpression: () => undefined,
    setPose: () => undefined,
    clearPose: () => undefined,
    wait: async () => undefined,
    getSurfaceBounds: () => ({ x: 0, y: 0, width: 400, height: 600 }),
  };

  const unwire = wireAvatarVoiceLipsync({
    driver: driver as AgentDataDriver,
    projection,
  });

  await driver.start();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const avatarPassthrough = observedEvents.find((event) => event.name === 'runtime.agent.turn.structured');
  assert.equal(avatarPassthrough?.detail.turn_id, turnId);
  assert.equal(avatarPassthrough?.detail.stream_id, streamId);
  assert.equal((avatarPassthrough?.detail.runtime_timeline as Record<string, unknown> | undefined)?.timebase_owner, 'runtime');

  const speakStart = observedEvents.find((event) => event.name === 'avatar.speak.start');
  assert.equal(speakStart?.detail.turn_id, turnId);
  assert.equal(speakStart?.detail.stream_id, streamId);
  assert.equal((speakStart?.detail.runtime_timeline as Record<string, unknown> | undefined)?.projection_rule_id, 'K-AGCORE-051');

  const mouthWrites = parameterWrites.filter((write) => write.signalId === AVATAR_MOUTH_OPEN_SIGNAL);
  assert.deepEqual(mouthWrites.map((write) => write.value), [0.14, 0.82, 0.28, 0]);
  assert.equal(new Set(mouthWrites.map((write) => write.value)).size > 2, true);

  const canceledBefore = parameterWrites.length;
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

  const lateWrites = parameterWrites.slice(canceledBefore).filter((write) => write.value !== 0);
  assert.equal(lateWrites.length, 0);

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
