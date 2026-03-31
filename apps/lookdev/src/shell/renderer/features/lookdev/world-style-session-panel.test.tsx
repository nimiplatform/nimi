import { render, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLocale, i18n, initI18n } from '@renderer/i18n/index.js';
import type { LookdevWorldStylePack, LookdevWorldStyleSession } from './types.js';
import { WorldStyleSessionPanel } from './world-style-session-panel.js';

function makeSession(messageCount: number): LookdevWorldStyleSession {
  return {
    sessionId: 'session-1',
    worldId: 'world-1',
    worldName: '凡人修仙界',
    language: 'zh',
    status: 'collecting',
    messages: Array.from({ length: messageCount }, (_, index) => ({
      messageId: `msg-${index}`,
      role: index % 2 === 0 ? 'assistant' : 'operator',
      text: `message ${index}`,
      createdAt: new Date().toISOString(),
    })),
    understanding: {
      tone: '克制写实',
      differentiation: '服装层级',
      palette: '低饱和',
      forbidden: '不要夸张特效',
    },
    openQuestions: [],
    readinessReason: null,
    summary: null,
    operatorTurnCount: Math.max(0, messageCount - 1),
    lastTextTraceId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    synthesizedAt: null,
  };
}

const noopPack: LookdevWorldStylePack | null = null;

describe('WorldStyleSessionPanel', () => {
  beforeEach(async () => {
    await initI18n();
    await changeLocale('zh');
  });

  it('auto-scrolls the conversation container to the latest message', async () => {
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      value: scrollTo,
      configurable: true,
      writable: true,
    });

    const { rerender } = render(
      <I18nextProvider i18n={i18n}>
        <WorldStyleSessionPanel
          worldName="凡人修仙界"
          worldSelected
          styleSession={makeSession(1)}
          styleSessionInput=""
          worldStylePack={noopPack}
          stylePackConfirmed={false}
          styleSessionCanSynthesize={false}
          styleSessionBusy={false}
          styleSessionError={null}
          styleSessionTargetKey="text.generate::cloud::api-connector::gemini-2.5-flash::"
          styleSessionTargetLabel="API Connector / gemini-2.5-flash"
          styleSessionTargetReady
          styleSessionTargetOptions={[
            { key: 'text.generate::cloud::api-connector::gemini-2.5-flash::', label: 'API Connector / gemini-2.5-flash' },
          ]}
          showAdvancedStyleEditor={false}
          onStyleSessionInputChange={() => {}}
          onStyleSessionTargetChange={() => {}}
          onStyleSessionReply={() => {}}
          onRestartStyleSession={() => {}}
          onSynthesizeStylePack={() => {}}
          onConfirmWorldStylePack={() => {}}
          onToggleAdvancedStyleEditor={() => {}}
          onUpdateWorldStylePack={() => {}}
        />
      </I18nextProvider>,
    );

    rerender(
      <I18nextProvider i18n={i18n}>
        <WorldStyleSessionPanel
          worldName="凡人修仙界"
          worldSelected
          styleSession={makeSession(3)}
          styleSessionInput=""
          worldStylePack={noopPack}
          stylePackConfirmed={false}
          styleSessionCanSynthesize={false}
          styleSessionBusy={false}
          styleSessionError={null}
          styleSessionTargetKey="text.generate::cloud::api-connector::gemini-2.5-flash::"
          styleSessionTargetLabel="API Connector / gemini-2.5-flash"
          styleSessionTargetReady
          styleSessionTargetOptions={[
            { key: 'text.generate::cloud::api-connector::gemini-2.5-flash::', label: 'API Connector / gemini-2.5-flash' },
          ]}
          showAdvancedStyleEditor={false}
          onStyleSessionInputChange={() => {}}
          onStyleSessionTargetChange={() => {}}
          onStyleSessionReply={() => {}}
          onRestartStyleSession={() => {}}
          onSynthesizeStylePack={() => {}}
          onConfirmWorldStylePack={() => {}}
          onToggleAdvancedStyleEditor={() => {}}
          onUpdateWorldStylePack={() => {}}
        />
      </I18nextProvider>,
    );

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalled();
    });
  });
});
