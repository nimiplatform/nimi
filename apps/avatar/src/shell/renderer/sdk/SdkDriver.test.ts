import { describe, expect, it, vi } from 'vitest';
import { SdkDriver } from './SdkDriver.js';
import type { AgentEvent } from '../driver/types.js';

function waitForTasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const LOCAL_IDENTITY = {
  ownerUserId: 'owner-1',
  runtimeSourceRef: 'agent-1',
  localAgentRef: 'local-agent:owner-1:agent-1',
};

function admissionDetail() {
  return {
    runtimeAdmissionRef: 'runtime.admission/avatar-presentation-1',
    gatewayVerdictRef: 'runtime.gateway/avatar-presentation-1',
    firewallVerdictRef: 'runtime.firewall/avatar-presentation-1',
    auditRef: 'runtime.audit/avatar-presentation-1',
    credentialVerdictRef: 'runtime.credential/avatar-presentation-1',
  };
}

describe('SdkDriver', () => {
  it('consumes runtime snapshot and presentation/state events into bundle and agent events', async () => {
    async function* stream() {
      yield {
        eventName: 'runtime.agent.presentation.activity_requested',
        localAgentRef: LOCAL_IDENTITY.localAgentRef,
        conversationAnchorId: 'anchor-1',
        turnId: 'turn-1',
        streamId: 'stream-1',
        detail: {
          activityName: 'happy',
          category: 'emotion',
          intensity: 'moderate',
          source: 'apml_output',
          ...admissionDetail(),
        },
      };
      yield {
        eventName: 'runtime.agent.state.status_text_changed',
        localAgentRef: LOCAL_IDENTITY.localAgentRef,
        conversationAnchorId: 'anchor-1',
        originatingTurnId: 'turn-1',
        originatingStreamId: 'stream-1',
        detail: {
          currentStatusText: 'working',
        },
      };
      await new Promise(() => {});
    }

    const runtimeAgent = {
      turns: {
        getSessionSnapshot: async () => ({
          sessionStatus: 'active',
          transcriptMessageCount: 3,
        }),
        subscribe: async () => stream(),
      },
    } as const;

    const driver = new SdkDriver({
      runtimeAgent: runtimeAgent as never,
      ...LOCAL_IDENTITY,
      conversationAnchorId: 'anchor-1',
      activeWorldId: 'world-1',
      activeUserId: 'user-1',
      locale: 'en-US',
      now: () => 1_710_000_000_000,
    });

    const eventNames: string[] = [];
    driver.onEvent((event) => {
      eventNames.push(event.name);
    });

    await driver.start();
    await waitForTasks();

    expect(driver.status).toBe('running');
    expect(driver.getBundle().activity?.name).toBe('happy');
    expect(driver.getBundle().activity?.source).toBe('apml_output');
    expect(driver.getBundle().custom).toEqual(expect.objectContaining({
      last_runtime_activity_source: 'apml_output',
    }));
    expect(driver.getBundle().status_text).toBe('working');
    expect(eventNames).toContain('runtime.agent.presentation.activity_requested');
    expect(eventNames).not.toContain('apml.state.activity');

    await driver.stop();
  });

  it('rejects unknown runtime activity ids before updating the Avatar bundle', async () => {
    async function* stream() {
      yield {
        eventName: 'runtime.agent.presentation.activity_requested',
        localAgentRef: LOCAL_IDENTITY.localAgentRef,
        conversationAnchorId: 'anchor-1',
        turnId: 'turn-1',
        streamId: 'stream-1',
        detail: {
          activityName: 'mystery_activity',
          category: 'emotion',
          intensity: 'strong',
          source: 'apml_output',
          ...admissionDetail(),
        },
      };
      await new Promise(() => {});
    }

    const runtimeAgent = {
      turns: {
        getSessionSnapshot: async () => ({
          sessionStatus: 'active',
          transcriptMessageCount: 0,
        }),
        subscribe: async () => stream(),
      },
    } as const;

    const driver = new SdkDriver({
      runtimeAgent: runtimeAgent as never,
      ...LOCAL_IDENTITY,
      conversationAnchorId: 'anchor-1',
      activeWorldId: 'world-1',
      activeUserId: 'user-1',
      locale: 'en-US',
      now: () => 1_710_000_010_000,
    });

    const events: AgentEvent[] = [];
    driver.onEvent((event) => {
      events.push(event);
    });

    await driver.start();
    await waitForTasks();

    expect(driver.getBundle().activity).toBeUndefined();
    expect(driver.getBundle().history?.last_activity).toBeUndefined();
    expect(events.find((event) => event.name === 'runtime.agent.presentation.activity_requested')).toBeUndefined();

    await driver.stop();
  });

  it('accepts runtime presentation events that carry envelope evidence without admission refs', async () => {
    async function* stream() {
      yield {
        eventName: 'runtime.agent.presentation.activity_requested',
        localAgentRef: LOCAL_IDENTITY.localAgentRef,
        conversationAnchorId: 'anchor-1',
        turnId: 'turn-1',
        streamId: 'stream-1',
        detail: {
          activityName: 'happy',
          category: 'emotion',
          intensity: 'moderate',
          source: 'apml_output',
        },
      };
      await new Promise(() => {});
    }
    const runtimeAgent = {
      turns: {
        getSessionSnapshot: async () => ({
          sessionStatus: 'active',
          transcriptMessageCount: 0,
        }),
        subscribe: async () => stream(),
      },
    } as const;

    const driver = new SdkDriver({
      runtimeAgent: runtimeAgent as never,
      ...LOCAL_IDENTITY,
      conversationAnchorId: 'anchor-1',
      activeWorldId: 'world-1',
      activeUserId: 'user-1',
      locale: 'en-US',
      now: () => 1_710_000_000_000,
    });
    const events: AgentEvent[] = [];
    driver.onEvent((event) => events.push(event));

    await driver.start();
    await waitForTasks();

    expect(driver.status).toBe('running');
    expect(driver.getBundle().activity).toEqual(expect.objectContaining({
      name: 'happy',
      category: 'emotion',
      source: 'apml_output',
    }));
    expect(driver.getBundle().activity).not.toHaveProperty('admission');
    expect(events.find((event) => event.name === 'runtime.agent.presentation.activity_requested')?.detail).toEqual(expect.objectContaining({
      agent_id: LOCAL_IDENTITY.localAgentRef,
      conversation_anchor_id: 'anchor-1',
      turn_id: 'turn-1',
      stream_id: 'stream-1',
      presentation_evidence_source: 'runtime_event_envelope',
    }));

    await driver.stop();
  });

  it('starts runtime consumption through protected read and turn stream scopes while preserving abort signal', async () => {
    async function* stream() {
      await new Promise(() => {});
    }
    const getSessionSnapshot = vi.fn(async (_input, _options) => ({
      sessionStatus: 'active',
      transcriptMessageCount: 0,
    }));
    const subscribe = vi.fn(async () => stream());
    const runtimeAgent = {
      turns: {
        getSessionSnapshot,
        subscribe,
      },
    } as const;
    const withScopes = vi.fn(async (_scopes, operation) => operation({
      metadata: {
        'x-nimi-access-token-id': 'protected-token-id',
        'x-nimi-access-token-secret': 'protected-token-secret',
      },
    }));

    const driver = new SdkDriver({
      runtimeAgent: runtimeAgent as never,
      withScopes,
      ...LOCAL_IDENTITY,
      conversationAnchorId: 'anchor-1',
      activeWorldId: 'world-1',
      activeUserId: 'user-1',
      locale: 'en-US',
    });

    await driver.start();

    expect(withScopes).toHaveBeenCalledTimes(2);
    expect(withScopes.mock.calls.map(([scopes]) => scopes)).toEqual([
      ['runtime.agent.read'],
      ['runtime.agent.read', 'runtime.agent.turn.read'],
    ]);
    for (const call of [getSessionSnapshot.mock.calls[0], subscribe.mock.calls[0]]) {
      expect(call?.[1]).toEqual(expect.objectContaining({
        metadata: {
          'x-nimi-access-token-id': 'protected-token-id',
          'x-nimi-access-token-secret': 'protected-token-secret',
        },
        signal: expect.any(AbortSignal),
      }));
    }
  });

  it('fails closed when the runtime event stream ends unexpectedly', async () => {
    async function* closedStream() {
      return;
    }

    const runtimeAgent = {
      turns: {
        getSessionSnapshot: async () => ({
          sessionStatus: 'active',
          transcriptMessageCount: 0,
        }),
        subscribe: async () => closedStream(),
      },
    } as const;

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const driver = new SdkDriver({
      runtimeAgent: runtimeAgent as never,
      ...LOCAL_IDENTITY,
      conversationAnchorId: 'anchor-1',
      activeWorldId: 'world-1',
      activeUserId: 'user-1',
      locale: 'en-US',
    });

    await driver.start();
    await waitForTasks();

    expect(driver.status).toBe('error');
    expect(driver.getLastError()).toBe('avatar runtime event stream closed unexpectedly');
    errorSpy.mockRestore();
  });

  it('fails closed when runtime activity projection shape is malformed', async () => {
    async function* stream() {
      yield {
        eventName: 'runtime.agent.presentation.activity_requested',
        localAgentRef: LOCAL_IDENTITY.localAgentRef,
        conversationAnchorId: 'anchor-1',
        turnId: 'turn-1',
        streamId: 'stream-1',
        detail: {
          activityName: 'happy',
          category: 'renderer-local',
          intensity: 'moderate',
          source: 'apml_output',
          ...admissionDetail(),
        },
      } as never;
      await new Promise(() => {});
    }

    const runtimeAgent = {
      turns: {
        getSessionSnapshot: async () => ({
          sessionStatus: 'active',
          transcriptMessageCount: 0,
        }),
        subscribe: async () => stream(),
      },
    } as const;

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const driver = new SdkDriver({
      runtimeAgent: runtimeAgent as never,
      ...LOCAL_IDENTITY,
      conversationAnchorId: 'anchor-1',
      activeWorldId: 'world-1',
      activeUserId: 'user-1',
      locale: 'en-US',
    });

    await driver.start();
    await waitForTasks();

    expect(driver.status).toBe('error');
    expect(driver.getBundle().activity).toBeUndefined();
    errorSpy.mockRestore();
  });

  it('stores runtime emotion projection separately from AgentActivity truth', async () => {
    async function* stream() {
      yield {
        eventName: 'runtime.agent.state.emotion_changed',
        localAgentRef: LOCAL_IDENTITY.localAgentRef,
        conversationAnchorId: 'anchor-1',
        originatingTurnId: 'turn-1',
        originatingStreamId: 'stream-1',
        detail: {
          currentEmotion: 'joy',
          previousEmotion: 'neutral',
          source: 'chat_status_cue',
        },
      };
      await new Promise(() => {});
    }

    const runtimeAgent = {
      turns: {
        getSessionSnapshot: async () => ({
          sessionStatus: 'active',
          transcriptMessageCount: 0,
        }),
        subscribe: async () => stream(),
      },
    } as const;

    const driver = new SdkDriver({
      runtimeAgent: runtimeAgent as never,
      ...LOCAL_IDENTITY,
      conversationAnchorId: 'anchor-1',
      activeWorldId: 'world-1',
      activeUserId: 'user-1',
      locale: 'en-US',
    });

    await driver.start();
    await waitForTasks();

    expect(driver.getBundle().activity).toBeUndefined();
    expect(driver.getBundle().emotion).toEqual({
      current: 'joy',
      previous: 'neutral',
      source: 'chat_status_cue',
    });
    expect(driver.getBundle().custom).toEqual(expect.objectContaining({
      runtime_current_emotion: 'joy',
      runtime_previous_emotion: 'neutral',
      runtime_emotion_source: 'chat_status_cue',
    }));

    await driver.stop();
  });

  it('stores only the latest committed assistant message as presentation cache metadata', async () => {
    async function* stream() {
      yield {
        eventName: 'runtime.agent.turn.message_committed',
        localAgentRef: LOCAL_IDENTITY.localAgentRef,
        conversationAnchorId: 'anchor-1',
        turnId: 'turn-2',
        streamId: 'stream-2',
        detail: {
          messageId: 'msg-2',
          text: 'latest assistant reply',
        },
      };
      await new Promise(() => {});
    }

    const runtimeAgent = {
      turns: {
        getSessionSnapshot: async () => ({
          sessionStatus: 'active',
          transcriptMessageCount: 4,
          lastTurn: {
            turnId: 'turn-1',
            messageId: 'msg-1',
            text: 'older reply',
            updatedAt: '2026-04-22T00:00:00.000Z',
          },
        }),
        subscribe: async () => stream(),
      },
    } as const;

    const driver = new SdkDriver({
      runtimeAgent: runtimeAgent as never,
      ...LOCAL_IDENTITY,
      conversationAnchorId: 'anchor-1',
      activeWorldId: 'world-1',
      activeUserId: 'user-1',
      locale: 'en-US',
      now: () => 1_710_000_010_000,
    });

    await driver.start();
    await waitForTasks();

    expect(driver.getBundle().custom).toEqual(expect.objectContaining({
      latest_committed_message_id: 'msg-2',
      latest_committed_turn_id: 'turn-2',
      latest_committed_message_text: 'latest assistant reply',
    }));

    await driver.stop();
  });

  it('replays committed snapshot status cue into presentation events for late avatar consumers', async () => {
    async function* stream() {
      await new Promise(() => {});
    }

    const runtimeAgent = {
      turns: {
        getSessionSnapshot: async () => ({
          sessionStatus: 'active',
          transcriptMessageCount: 1,
          lastTurn: {
            turnId: 'turn-1',
            streamId: 'stream-1',
            messageId: 'msg-1',
            text: 'reply',
            structured: {
              status_cue: {
                mood: 'joy',
                action_cue: 'greet',
                activity_category: 'interaction',
                ...admissionDetail(),
              },
            },
          },
        }),
        subscribe: async () => stream(),
      },
    } as const;

    const driver = new SdkDriver({
      runtimeAgent: runtimeAgent as never,
      ...LOCAL_IDENTITY,
      conversationAnchorId: 'anchor-1',
      activeWorldId: 'world-1',
      activeUserId: 'user-1',
      locale: 'en-US',
      now: () => 1_710_000_020_000,
    });

    const events: AgentEvent[] = [];
    driver.onEvent((event) => {
      events.push(event);
    });

    await driver.start();
    await waitForTasks();

    expect(events.map((event) => event.name)).toEqual([
      'runtime.agent.presentation.expression_requested',
      'runtime.agent.presentation.activity_requested',
    ]);
    expect(events[0]?.detail).toEqual(expect.objectContaining({
      expression_id: 'joy',
      turn_id: 'turn-1',
      stream_id: 'stream-1',
      catchup_source: 'session_snapshot',
    }));
    expect(events[1]?.detail).toEqual(expect.objectContaining({
      activity_name: 'greet',
      category: 'interaction',
      source: 'apml_output',
      turn_id: 'turn-1',
      stream_id: 'stream-1',
      catchup_source: 'session_snapshot',
    }));

    await driver.stop();
  });

  it('stores bounded active-turn caption and interrupted metadata without expanding transcript history', async () => {
    async function* stream() {
      yield {
        eventName: 'runtime.agent.turn.accepted',
        localAgentRef: LOCAL_IDENTITY.localAgentRef,
        conversationAnchorId: 'anchor-1',
        turnId: 'turn-voice-1',
        streamId: 'stream-voice-1',
        detail: {
          requestId: 'req-1',
        },
      };
      yield {
        eventName: 'runtime.agent.turn.text_delta',
        localAgentRef: LOCAL_IDENTITY.localAgentRef,
        conversationAnchorId: 'anchor-1',
        turnId: 'turn-voice-1',
        streamId: 'stream-voice-1',
        detail: {
          text: 'bounded reply',
        },
      };
      yield {
        eventName: 'runtime.agent.turn.interrupted',
        localAgentRef: LOCAL_IDENTITY.localAgentRef,
        conversationAnchorId: 'anchor-1',
        turnId: 'turn-voice-1',
        streamId: 'stream-voice-1',
        detail: {
          reason: 'interrupt_requested',
        },
      };
      await new Promise(() => {});
    }

    const runtimeAgent = {
      turns: {
        getSessionSnapshot: async () => ({
          sessionStatus: 'active',
          transcriptMessageCount: 2,
        }),
        subscribe: async () => stream(),
      },
    } as const;

    const driver = new SdkDriver({
      runtimeAgent: runtimeAgent as never,
      ...LOCAL_IDENTITY,
      conversationAnchorId: 'anchor-1',
      activeWorldId: 'world-1',
      activeUserId: 'user-1',
      locale: 'en-US',
      now: () => 1_710_000_020_000,
    });

    await driver.start();
    await waitForTasks();

    expect(driver.getBundle().custom).toEqual(expect.objectContaining({
      active_turn_id: null,
      active_turn_text: null,
      last_turn_terminal_phase: 'interrupted',
      last_turn_terminal_id: 'turn-voice-1',
      last_turn_terminal_reason: 'interrupt_requested',
      last_interrupted_turn_id: 'turn-voice-1',
      transcript_message_count: 2,
    }));

    await driver.stop();
  });

  it('preserves SDK runtime timeline metadata on Avatar passthrough events without synthesizing it', async () => {
    async function* stream() {
      yield {
        eventName: 'runtime.agent.turn.text_delta',
        localAgentRef: LOCAL_IDENTITY.localAgentRef,
        conversationAnchorId: 'anchor-1',
        turnId: 'turn-voice-1',
        streamId: 'stream-voice-1',
        timeline: {
          turnId: 'turn-voice-1',
          streamId: 'stream-voice-1',
          channel: 'text',
          offsetMs: 0,
          sequence: 1,
          startedAtWall: '2026-04-25T00:00:00.000Z',
          observedAtWall: '2026-04-25T00:00:00.020Z',
          timebaseOwner: 'runtime',
          projectionRuleId: 'K-AGCORE-051',
          clockBasis: 'monotonic_with_wall_anchor',
          providerNeutral: true,
          appLocalAuthority: false,
        },
        detail: {
          text: 'voice line',
        },
      };
      yield {
        eventName: 'runtime.agent.turn.completed',
        localAgentRef: LOCAL_IDENTITY.localAgentRef,
        conversationAnchorId: 'anchor-1',
        turnId: 'turn-no-timeline',
        streamId: 'stream-no-timeline',
        detail: {
          terminalReason: 'completed',
        },
      };
      await new Promise(() => {});
    }

    const runtimeAgent = {
      turns: {
        getSessionSnapshot: async () => ({
          sessionStatus: 'active',
          transcriptMessageCount: 0,
        }),
        subscribe: async () => stream(),
      },
    } as const;

    const driver = new SdkDriver({
      runtimeAgent: runtimeAgent as never,
      ...LOCAL_IDENTITY,
      conversationAnchorId: 'anchor-1',
      activeWorldId: 'world-1',
      activeUserId: 'user-1',
      locale: 'en-US',
      now: () => 1_710_000_030_000,
    });
    const events: Array<{ name: string; detail: Record<string, unknown> }> = [];
    driver.onEvent((event) => events.push(event));

    await driver.start();
    await waitForTasks();

    expect(events.find((event) => event.name === 'runtime.agent.turn.text_delta')?.detail).toEqual(expect.objectContaining({
      runtime_timeline: expect.objectContaining({
        turn_id: 'turn-voice-1',
        stream_id: 'stream-voice-1',
        timebase_owner: 'runtime',
        projection_rule_id: 'K-AGCORE-051',
        provider_neutral: true,
        app_local_authority: false,
      }),
    }));
    expect(events.find((event) => event.name === 'runtime.agent.turn.completed')?.detail).not.toHaveProperty('runtime_timeline');
    expect(driver.getBundle().custom).toEqual(expect.objectContaining({
      last_runtime_timeline: expect.objectContaining({
        turn_id: 'turn-voice-1',
        stream_id: 'stream-voice-1',
      }),
    }));

    await driver.stop();
  });

  it('passes runtime-owned voice stream and playback presentation events through to Avatar consumers', async () => {
    async function* stream() {
      yield {
        eventName: 'runtime.agent.presentation.voice_stream_chunk_available',
        localAgentRef: LOCAL_IDENTITY.localAgentRef,
        conversationAnchorId: 'anchor-1',
        turnId: 'turn-voice-1',
        streamId: 'stream-voice-1',
        timeline: {
          turnId: 'turn-voice-1',
          streamId: 'stream-voice-1',
          channel: 'voice',
          offsetMs: 0,
          sequence: 1,
          startedAtWall: '2026-04-25T00:00:00.000Z',
          observedAtWall: '2026-04-25T00:00:00.015Z',
          timebaseOwner: 'runtime',
          projectionRuleId: 'K-AGCORE-133',
          clockBasis: 'monotonic_with_wall_anchor',
          providerNeutral: true,
          appLocalAuthority: false,
        },
        detail: {
          audioArtifactId: 'artifact-chunk-1',
          audioMimeType: 'audio/wav',
          chunkSequence: 1,
          finalChunk: true,
          playbackTarget: 'avatar_autoplay',
        },
      };
      yield {
        eventName: 'runtime.agent.presentation.voice_playback_requested',
        localAgentRef: LOCAL_IDENTITY.localAgentRef,
        conversationAnchorId: 'anchor-1',
        turnId: 'turn-voice-1',
        streamId: 'stream-voice-1',
        timeline: {
          turnId: 'turn-voice-1',
          streamId: 'stream-voice-1',
          channel: 'voice',
          offsetMs: 0,
          sequence: 1,
          startedAtWall: '2026-04-25T00:00:00.000Z',
          observedAtWall: '2026-04-25T00:00:00.020Z',
          timebaseOwner: 'runtime',
          projectionRuleId: 'K-AGCORE-051',
          clockBasis: 'monotonic_with_wall_anchor',
          providerNeutral: true,
          appLocalAuthority: false,
        },
        detail: {
          audioArtifactId: 'artifact-1',
          audioMimeType: 'audio/wav',
          playbackState: 'requested',
          playbackTarget: 'avatar_autoplay',
          finalArtifact: true,
        },
      };
      // Wave 0 of topic 2026-04-30-avatar-vrm-backend-branch hard-cut:
      // the deprecated runtime presentation per-frame mouth-batch consume
      // path was deleted; the frame batch fixture is no longer emitted
      // into the SdkDriver stream.
      await new Promise(() => {});
    }

    const runtimeAgent = {
      turns: {
        getSessionSnapshot: async () => ({
          sessionStatus: 'active',
          transcriptMessageCount: 0,
        }),
        subscribe: async () => stream(),
      },
    } as const;

    const driver = new SdkDriver({
      runtimeAgent: runtimeAgent as never,
      ...LOCAL_IDENTITY,
      conversationAnchorId: 'anchor-1',
      activeWorldId: 'world-1',
      activeUserId: 'user-1',
      locale: 'en-US',
      now: () => 1_710_000_040_000,
    });
    const events: Array<{ name: string; detail: Record<string, unknown> }> = [];
    driver.onEvent((event) => events.push(event));

    await driver.start();
    await waitForTasks();

    expect(events.map((event) => event.name)).toEqual(expect.arrayContaining([
      'runtime.agent.presentation.voice_stream_chunk_available',
      'runtime.agent.presentation.voice_playback_requested',
    ]));
    expect(events.find((event) => event.name === 'runtime.agent.presentation.voice_stream_chunk_available')?.detail)
      .toEqual(expect.objectContaining({
        runtime_timeline: expect.objectContaining({
          projection_rule_id: 'K-AGCORE-133',
        }),
        playbackTarget: 'avatar_autoplay',
      }));
    // Wave 0 hard-cut: the deprecated per-frame mouth-batch presentation
    // event is no longer in the SdkDriver event type union nor in the
    // dispatch case set. Typecheck enforces absence; we additionally assert
    // no presentation event outside the runtime-owned voice surfaces is
    // emitted by this fixture.
    const presentationEvents = events.filter((event) =>
      event.name.startsWith('runtime.agent.presentation.'),
    );
    expect(presentationEvents.every((event) =>
      event.name === 'runtime.agent.presentation.voice_playback_requested'
      || event.name === 'runtime.agent.presentation.voice_stream_chunk_available',
    ))
      .toBe(true);

    await driver.stop();
  });
});
