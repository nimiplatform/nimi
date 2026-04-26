import { describe, expect, it, vi } from 'vitest';
import { SdkDriver } from './SdkDriver.js';

function waitForTasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('SdkDriver', () => {
  it('consumes runtime snapshot and presentation/state events into bundle and agent events', async () => {
    async function* stream() {
      yield {
        eventName: 'runtime.agent.presentation.activity_requested',
        agentId: 'agent-1',
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
        agentId: 'agent-1',
        conversationAnchorId: 'anchor-1',
        originatingTurnId: 'turn-1',
        originatingStreamId: 'stream-1',
        detail: {
          currentStatusText: 'working',
        },
      };
      await new Promise(() => {});
    }

    const runtime = {
      agent: {
        turns: {
          getSessionSnapshot: async () => ({
            sessionStatus: 'active',
            transcriptMessageCount: 3,
          }),
          subscribe: async () => stream(),
        },
      },
    } as const;

    const driver = new SdkDriver({
      runtime: runtime as never,
      agentId: 'agent-1',
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
    expect(driver.getBundle().activity?.source).toBe('runtime_projection');
    expect(driver.getBundle().custom).toEqual(expect.objectContaining({
      last_runtime_activity_source: 'apml_output',
    }));
    expect(driver.getBundle().status_text).toBe('working');
    expect(eventNames).toContain('runtime.agent.presentation.activity_requested');
    expect(eventNames).not.toContain('apml.state.activity');

    await driver.stop();
  });

  it('fails closed when the runtime event stream ends unexpectedly', async () => {
    async function* closedStream() {
      return;
    }

    const runtime = {
      agent: {
        turns: {
          getSessionSnapshot: async () => ({
            sessionStatus: 'active',
            transcriptMessageCount: 0,
          }),
          subscribe: async () => closedStream(),
        },
      },
    } as const;

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const driver = new SdkDriver({
      runtime: runtime as never,
      agentId: 'agent-1',
      conversationAnchorId: 'anchor-1',
      activeWorldId: 'world-1',
      activeUserId: 'user-1',
      locale: 'en-US',
    });

    await driver.start();
    await waitForTasks();

    expect(driver.status).toBe('error');
    errorSpy.mockRestore();
  });

  it('fails closed when runtime activity projection shape is malformed', async () => {
    async function* stream() {
      yield {
        eventName: 'runtime.agent.presentation.activity_requested',
        agentId: 'agent-1',
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

    const runtime = {
      agent: {
        turns: {
          getSessionSnapshot: async () => ({
            sessionStatus: 'active',
            transcriptMessageCount: 0,
          }),
          subscribe: async () => stream(),
        },
      },
    } as const;

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const driver = new SdkDriver({
      runtime: runtime as never,
      agentId: 'agent-1',
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
        agentId: 'agent-1',
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

    const runtime = {
      agent: {
        turns: {
          getSessionSnapshot: async () => ({
            sessionStatus: 'active',
            transcriptMessageCount: 0,
          }),
          subscribe: async () => stream(),
        },
      },
    } as const;

    const driver = new SdkDriver({
      runtime: runtime as never,
      agentId: 'agent-1',
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
        agentId: 'agent-1',
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

    const runtime = {
      agent: {
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
      },
    } as const;

    const driver = new SdkDriver({
      runtime: runtime as never,
      agentId: 'agent-1',
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

  it('stores bounded active-turn caption and interrupted metadata without expanding transcript history', async () => {
    async function* stream() {
      yield {
        eventName: 'runtime.agent.turn.accepted',
        agentId: 'agent-1',
        conversationAnchorId: 'anchor-1',
        turnId: 'turn-voice-1',
        streamId: 'stream-voice-1',
        detail: {
          requestId: 'req-1',
        },
      };
      yield {
        eventName: 'runtime.agent.turn.text_delta',
        agentId: 'agent-1',
        conversationAnchorId: 'anchor-1',
        turnId: 'turn-voice-1',
        streamId: 'stream-voice-1',
        detail: {
          text: 'bounded reply',
        },
      };
      yield {
        eventName: 'runtime.agent.turn.interrupted',
        agentId: 'agent-1',
        conversationAnchorId: 'anchor-1',
        turnId: 'turn-voice-1',
        streamId: 'stream-voice-1',
        detail: {
          reason: 'interrupt_requested',
        },
      };
      await new Promise(() => {});
    }

    const runtime = {
      agent: {
        turns: {
          getSessionSnapshot: async () => ({
            sessionStatus: 'active',
            transcriptMessageCount: 2,
          }),
          subscribe: async () => stream(),
        },
      },
    } as const;

    const driver = new SdkDriver({
      runtime: runtime as never,
      agentId: 'agent-1',
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
        agentId: 'agent-1',
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
        agentId: 'agent-1',
        conversationAnchorId: 'anchor-1',
        turnId: 'turn-no-timeline',
        streamId: 'stream-no-timeline',
        detail: {
          terminalReason: 'completed',
        },
      };
      await new Promise(() => {});
    }

    const runtime = {
      agent: {
        turns: {
          getSessionSnapshot: async () => ({
            sessionStatus: 'active',
            transcriptMessageCount: 0,
          }),
          subscribe: async () => stream(),
        },
      },
    } as const;

    const driver = new SdkDriver({
      runtime: runtime as never,
      agentId: 'agent-1',
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
});
