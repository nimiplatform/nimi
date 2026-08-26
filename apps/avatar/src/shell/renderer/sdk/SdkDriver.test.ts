import { describe, expect, it, vi } from 'vitest';
import { SdkDriver } from './SdkDriver.js';
import type { AgentEvent } from '../driver/types.js';
import type { NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';

function waitForTasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const LOCAL_IDENTITY = {
  ownerUserId: 'owner-1',
  runtimeSourceRef: 'agent-1',
  localAgentRef: 'local-agent:owner-1:agent-1',
};

const CANONICAL_CONVERSATION = {
  agentHandle: `agent_ref_${'a'.repeat(43)}` as NimiLocalAppAgentHandle,
  conversation: {
    async subscribe() {
      return {
        async *[Symbol.asyncIterator]() {
          await new Promise(() => {});
        },
        async cancel() {},
      };
    },
    async snapshot() {
      return {
        conversationAnchorId: 'anchor-1',
        throughSequence: '0',
        turns: [], messages: [], actions: [], voices: [], truncatedBefore: false,
      };
    },
  } as never,
};

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
      ...CANONICAL_CONVERSATION,
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
      ...CANONICAL_CONVERSATION,
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

  it('accepts runtime presentation events that carry their typed envelope', async () => {
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
      ...CANONICAL_CONVERSATION,
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
    const subscribe = vi.fn(async (_input?: unknown, _options?: unknown) => stream());
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
      ...CANONICAL_CONVERSATION,
      withScopes,
      ...LOCAL_IDENTITY,
      conversationAnchorId: 'anchor-1',
      activeWorldId: 'world-1',
      activeUserId: 'user-1',
      locale: 'en-US',
    });

    await driver.start();

    expect(withScopes).toHaveBeenCalledTimes(1);
    expect(withScopes.mock.calls.map(([scopes]) => scopes)).toEqual([
      ['runtime.agent.read', 'runtime.agent.turn.read'],
    ]);
    expect(getSessionSnapshot).not.toHaveBeenCalled();
    for (const call of [subscribe.mock.calls[0]]) {
      expect(call?.[1]).toEqual(expect.objectContaining({
        metadata: {
          'x-nimi-access-token-id': 'protected-token-id',
          'x-nimi-access-token-secret': 'protected-token-secret',
        },
        signal: expect.any(AbortSignal),
      }));
    }
  });

  it('resyncs from a fresh Runtime snapshot when the event stream ends unexpectedly', async () => {
    async function* closedStream() {
      return;
    }
    async function* recoveredStream() {
      await new Promise(() => {});
    }

    let snapshotCall = 0;
    let subscribeCall = 0;
    let conversationSubscribeCall = 0;
    const runtimeAgent = {
      turns: {
        getSessionSnapshot: async () => ({
          sessionStatus: 'active',
          transcriptMessageCount: snapshotCall++ === 0 ? 0 : 7,
        }),
        subscribe: async () => subscribeCall++ === 0 ? closedStream() : recoveredStream(),
      },
    } as const;
    const conversation = {
      async subscribe() {
        const events = conversationSubscribeCall++ === 0 ? closedStream() : recoveredStream();
        return Object.assign(events, { cancel: async () => {} });
      },
      async snapshot() {
        const messageCount = snapshotCall++ === 0 ? 0 : 7;
        return {
          conversationAnchorId: 'anchor-1', throughSequence: String(messageCount),
          turns: [],
          messages: Array.from({ length: messageCount }, (_, index) => ({
            messageId: `message-${index}`, turnId: `turn-${index}`, role: 'user', parts: [],
          })),
          actions: [], voices: [], truncatedBefore: false,
        };
      },
    };

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();
    const driver = new SdkDriver({
      runtimeAgent: runtimeAgent as never,
      ...CANONICAL_CONVERSATION,
      conversation: conversation as never,
      ...LOCAL_IDENTITY,
      conversationAnchorId: 'anchor-1',
      activeWorldId: 'world-1',
      activeUserId: 'user-1',
      locale: 'en-US',
    });

    await driver.start();
    await vi.advanceTimersByTimeAsync(250);

    expect(driver.status).toBe('running');
    expect(driver.getLastError()).toBeNull();
    expect(driver.getBundle().custom).toEqual(expect.objectContaining({
      transcript_message_count: 7,
    }));
    expect(snapshotCall).toBe(2);
    expect(subscribeCall).toBe(2);
    expect(conversationSubscribeCall).toBe(2);
    await driver.stop();
    vi.useRealTimers();
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
      ...CANONICAL_CONVERSATION,
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
          currentEmotion: 'happy',
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
      ...CANONICAL_CONVERSATION,
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
      current: 'happy',
      previous: 'neutral',
      source: 'chat_status_cue',
    });
    expect(driver.getBundle().custom).toEqual(expect.objectContaining({
      runtime_current_emotion: 'happy',
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
    const conversation = {
      async subscribe() {
        async function* events() {
          yield {
            type: 'message-committed', conversationAnchorId: 'anchor-1', sequence: '2',
            turnId: 'turn-2',
            message: {
              messageId: 'msg-2', turnId: 'turn-2', role: 'assistant',
              parts: [{ kind: 'text', text: 'latest assistant reply' }],
            },
          };
          await new Promise(() => {});
        }
        return Object.assign(events(), { cancel: async () => {} });
      },
      async snapshot() {
        return {
          conversationAnchorId: 'anchor-1', throughSequence: '1', turns: [],
          messages: [{
            messageId: 'msg-1', turnId: 'turn-1', role: 'assistant',
            parts: [{ kind: 'text', text: 'older reply' }],
          }],
          actions: [], voices: [], truncatedBefore: false,
        };
      },
    };

    const driver = new SdkDriver({
      runtimeAgent: runtimeAgent as never,
      ...CANONICAL_CONVERSATION,
      conversation: conversation as never,
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

  it('does not infer presentation cues from the retired turn snapshot carrier', async () => {
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
                mood: 'happy',
                action_cue: 'greet',
                activity_category: 'interaction',
              },
            },
          },
        }),
        subscribe: async () => stream(),
      },
    } as const;

    const driver = new SdkDriver({
      runtimeAgent: runtimeAgent as never,
      ...CANONICAL_CONVERSATION,
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

    expect(events).toEqual([]);

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
    const conversation = {
      async subscribe() {
        async function* events() {
          yield { type: 'turn-accepted', conversationAnchorId: 'anchor-1', sequence: '3', turnId: 'turn-voice-1' };
          yield { type: 'text-delta', conversationAnchorId: 'anchor-1', sequence: '4', turnId: 'turn-voice-1', delta: 'bounded reply' };
          yield { type: 'turn-interrupted', conversationAnchorId: 'anchor-1', sequence: '5', turnId: 'turn-voice-1', reason: 'interrupt_requested' };
          await new Promise(() => {});
        }
        return Object.assign(events(), { cancel: async () => {} });
      },
      async snapshot() {
        return {
          conversationAnchorId: 'anchor-1', throughSequence: '2', turns: [],
          messages: [
            { messageId: 'message-1', turnId: 'turn-1', role: 'user', parts: [] },
            { messageId: 'message-2', turnId: 'turn-1', role: 'assistant', parts: [] },
          ],
          actions: [], voices: [], truncatedBefore: false,
        };
      },
    };

    const driver = new SdkDriver({
      runtimeAgent: runtimeAgent as never,
      ...CANONICAL_CONVERSATION,
      conversation: conversation as never,
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

  it('does not consume timeline metadata from the retired raw turn carrier', async () => {
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
      ...CANONICAL_CONVERSATION,
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

    expect(events).toEqual([]);
    expect(driver.getBundle().custom).not.toHaveProperty('last_runtime_timeline');

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
      yield {
        eventName: 'runtime.agent.presentation.voice_playback_terminal',
        localAgentRef: LOCAL_IDENTITY.localAgentRef,
        conversationAnchorId: 'anchor-1',
        turnId: 'turn-voice-1',
        streamId: 'stream-voice-1',
        timeline: {
          turnId: 'turn-voice-1',
          streamId: 'stream-voice-1',
          channel: 'voice',
          offsetMs: 480,
          sequence: 2,
          startedAtWall: '2026-04-25T00:00:00.000Z',
          observedAtWall: '2026-04-25T00:00:00.500Z',
          timebaseOwner: 'runtime',
          projectionRuleId: 'K-AGCORE-133',
          clockBasis: 'monotonic_with_wall_anchor',
          providerNeutral: true,
          appLocalAuthority: false,
        },
        detail: {
          voiceStreamId: 'voice-stream-1',
          finalArtifactId: 'artifact-1',
          audioMimeType: 'audio/wav',
          voiceOutputMode: 'artifact',
          voicePlaybackState: 'completed',
          terminalReason: 'artifact_playback_completed',
          playbackTarget: 'avatar_autoplay',
        },
      };
      // The backend-branch hard cut removes the deprecated Runtime
      // presentation per-frame mouth-batch consume
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
      ...CANONICAL_CONVERSATION,
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
      'runtime.agent.presentation.voice_playback_terminal',
    ]));
    expect(events.find((event) => event.name === 'runtime.agent.presentation.voice_stream_chunk_available')?.detail)
      .toEqual(expect.objectContaining({
        runtime_timeline: expect.objectContaining({
          projection_rule_id: 'K-AGCORE-133',
        }),
        playbackTarget: 'avatar_autoplay',
      }));
    expect(events.find((event) => event.name === 'runtime.agent.presentation.voice_playback_terminal')?.detail)
      .toEqual(expect.objectContaining({
        runtime_timeline: expect.objectContaining({
          projection_rule_id: 'K-AGCORE-133',
          offset_ms: 480,
          sequence: 2,
        }),
        voiceStreamId: 'voice-stream-1',
        voicePlaybackState: 'completed',
        terminalReason: 'artifact_playback_completed',
        playbackTarget: 'avatar_autoplay',
      }));
    // Hard cut: the deprecated per-frame mouth-batch presentation
    // event is no longer in the SdkDriver event type union nor in the
    // dispatch case set. Typecheck enforces absence; we additionally assert
    // no presentation event outside the runtime-owned voice surfaces is
    // emitted by this fixture.
    const presentationEvents = events.filter((event) =>
      event.name.startsWith('runtime.agent.presentation.'),
    );
    expect(presentationEvents.every((event) =>
      event.name === 'runtime.agent.presentation.voice_playback_requested'
      || event.name === 'runtime.agent.presentation.voice_stream_chunk_available'
      || event.name === 'runtime.agent.presentation.voice_playback_terminal',
    ))
      .toBe(true);

    await driver.stop();
  });

  it('subscribes to typed Runtime voice stream for native transient chunk playback', async () => {
    async function* stream() {
      yield {
        eventName: 'runtime.agent.presentation.voice_stream_chunk_available',
        localAgentRef: LOCAL_IDENTITY.localAgentRef,
        conversationAnchorId: 'anchor-1',
        turnId: 'turn-voice-raw-1',
        streamId: 'stream-voice-raw-1',
        timeline: {
          turnId: 'turn-voice-raw-1',
          streamId: 'stream-voice-raw-1',
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
          audioMimeType: 'audio/wav',
          chunkSequence: 1,
          finalChunk: false,
          playbackTarget: 'avatar_autoplay',
          voiceStreamId: 'voice-stream-raw-1',
          chunkTransportRef: 'runtime-agent-voice-stream://voice-stream-raw-1/chunks/000001',
          voiceOutputMode: 'native_stream',
        },
      };
      await new Promise(() => {});
    }
    async function* voiceStream() {
      yield {
        voiceStreamId: 'voice-stream-raw-1',
        conversationAnchorId: 'anchor-1',
        turnId: 'turn-voice-raw-1',
        streamId: 'stream-voice-raw-1',
        chunkSequence: 1,
        chunk: new Uint8Array([1, 2, 3]),
        mimeType: 'audio/wav',
        voiceOutputMode: 1,
        playbackTarget: 'avatar_autoplay',
        terminal: false,
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
    const runtimeVoice = {
      subscribeStream: vi.fn(async () => voiceStream()),
    };
    const driver = new SdkDriver({
      runtimeAgent: runtimeAgent as never,
      ...CANONICAL_CONVERSATION,
      runtimeVoice: runtimeVoice as never,
      ...LOCAL_IDENTITY,
      conversationAnchorId: 'anchor-1',
      activeWorldId: 'world-1',
      activeUserId: 'user-1',
      locale: 'en-US',
      now: () => 1_710_000_050_000,
    });
    const events: AgentEvent[] = [];
    driver.onEvent((event) => events.push(event));

    await driver.start();
    await waitForTasks();
    await waitForTasks();

    expect(runtimeVoice.subscribeStream).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: LOCAL_IDENTITY.ownerUserId,
        runtimeSourceRef: LOCAL_IDENTITY.runtimeSourceRef,
        localAgentRef: LOCAL_IDENTITY.localAgentRef,
        conversationAnchorId: 'anchor-1',
        turnId: 'turn-voice-raw-1',
        voiceStreamId: 'voice-stream-raw-1',
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    const rawChunk = events.find((event) => event.name === 'avatar.speak.native_audio_chunk');
    expect(rawChunk?.detail).toEqual(expect.objectContaining({
      voice_stream_id: 'voice-stream-raw-1',
      chunk_sequence: 1,
      audio_mime_type: 'audio/wav',
      playback_target: 'avatar_autoplay',
      turn_id: 'turn-voice-raw-1',
      stream_id: 'stream-voice-raw-1',
      chunk_bytes: new Uint8Array([1, 2, 3]),
    }));

    await driver.stop();
  });
});
