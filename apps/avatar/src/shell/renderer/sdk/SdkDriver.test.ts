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
    expect(driver.getBundle().status_text).toBe('working');
    expect(eventNames).toContain('runtime.agent.presentation.activity_requested');
    expect(eventNames).toContain('apml.state.activity');

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
});
