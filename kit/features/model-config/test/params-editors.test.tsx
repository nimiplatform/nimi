import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AudioSynthesizeParamsEditor,
  AudioTranscribeParamsEditor,
  TextGenerateParamsEditor,
  VoiceWorkflowParamsEditor,
} from '../src/ui.js';
import {
  DEFAULT_AUDIO_SYNTHESIZE_PARAMS,
  DEFAULT_AUDIO_TRANSCRIBE_PARAMS,
  DEFAULT_TEXT_GENERATE_PARAMS,
  DEFAULT_VOICE_WORKFLOW_PARAMS,
} from '../src/constants.js';
import type {
  AudioSynthesizeParamsState,
  AudioTranscribeParamsState,
  TextGenerateParamsState,
  VoiceWorkflowParamsState,
} from '../src/types.js';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

if (!window.HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => undefined,
  });
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
      await flush();
    });
  }
  container?.remove();
  root = null;
  container = null;
});

async function render(node: ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
    await flush();
    await flush();
  });
}

function setInputValue(input: HTMLInputElement, next: string) {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(input, next);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('TextGenerateParamsEditor', () => {
  it('propagates temperature updates and renders required field labels', async () => {
    let next: TextGenerateParamsState = { ...DEFAULT_TEXT_GENERATE_PARAMS };
    await render(
      <TextGenerateParamsEditor
        copy={{
          parametersLabel: 'Parameters',
          temperatureLabel: 'Temperature',
          topPLabel: 'Top P',
          topKLabel: 'Top K',
          maxTokensLabel: 'Max tokens',
          timeoutLabel: 'Timeout',
          stopSequencesLabel: 'Stop sequences',
          presencePenaltyLabel: 'Presence penalty',
          frequencyPenaltyLabel: 'Frequency penalty',
        }}
        params={next}
        onParamsChange={(value) => { next = value; }}
      />,
    );
    expect(container?.textContent).toContain('Temperature');
    expect(container?.textContent).toContain('Stop sequences');
    const inputs = Array.from(container?.querySelectorAll('input') || []) as HTMLInputElement[];
    const firstInput = inputs[0];
    expect(firstInput).toBeTruthy();
    await act(async () => {
      setInputValue(firstInput, '0.7');
      await flush();
    });
    expect(next.temperature).toBe('0.7');
  });
});

describe('AudioSynthesizeParamsEditor', () => {
  it('propagates voiceId updates', async () => {
    let next: AudioSynthesizeParamsState = { ...DEFAULT_AUDIO_SYNTHESIZE_PARAMS };
    await render(
      <AudioSynthesizeParamsEditor
        copy={{
          parametersLabel: 'Parameters',
          voiceIdLabel: 'Voice ID',
          speakingRateLabel: 'Speaking rate',
          volumeLabel: 'Volume',
          pitchSemitonesLabel: 'Pitch',
          languageHintLabel: 'Language',
          responseFormatLabel: 'Response format',
          timeoutLabel: 'Timeout',
        }}
        params={next}
        onParamsChange={(value) => { next = value; }}
      />,
    );
    expect(container?.textContent).toContain('Voice ID');
    const voiceInput = (Array.from(container?.querySelectorAll('input') || []) as HTMLInputElement[])[0];
    await act(async () => {
      setInputValue(voiceInput, 'alloy');
      await flush();
    });
    expect(next.voiceId).toBe('alloy');
  });
});

describe('AudioTranscribeParamsEditor', () => {
  it('propagates language updates and renders toggles', async () => {
    let next: AudioTranscribeParamsState = { ...DEFAULT_AUDIO_TRANSCRIBE_PARAMS };
    await render(
      <AudioTranscribeParamsEditor
        copy={{
          parametersLabel: 'Parameters',
          languageLabel: 'Language',
          responseFormatLabel: 'Response format',
          timeoutLabel: 'Timeout',
          speakerCountLabel: 'Speaker count',
          promptLabel: 'Prompt',
          timestampsLabel: 'Timestamps',
          diarizationLabel: 'Diarization',
        }}
        params={next}
        onParamsChange={(value) => { next = value; }}
      />,
    );
    expect(container?.textContent).toContain('Diarization');
    const langInput = (Array.from(container?.querySelectorAll('input') || []) as HTMLInputElement[])[0];
    await act(async () => {
      setInputValue(langInput, 'en-US');
      await flush();
    });
    expect(next.language).toBe('en-US');
  });
});

describe('VoiceWorkflowParamsEditor', () => {
  it('propagates referenceText updates', async () => {
    let next: VoiceWorkflowParamsState = { ...DEFAULT_VOICE_WORKFLOW_PARAMS };
    await render(
      <VoiceWorkflowParamsEditor
        copy={{
          parametersLabel: 'Parameters',
          referenceAssetLabel: 'Reference asset',
          referenceTextLabel: 'Reference text',
          voiceDesignPromptLabel: 'Voice design prompt',
          durationLabel: 'Duration',
          seedLabel: 'Seed',
          timeoutLabel: 'Timeout',
        }}
        params={next}
        onParamsChange={(value) => { next = value; }}
      />,
    );
    expect(container?.textContent).toContain('Voice design prompt');
    const textareas = Array.from(container?.querySelectorAll('textarea') || []) as HTMLTextAreaElement[];
    expect(textareas.length).toBeGreaterThan(0);
    const referenceTextarea = textareas[0];
    await act(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
      descriptor?.set?.call(referenceTextarea, 'Hello world');
      referenceTextarea.dispatchEvent(new Event('input', { bubbles: true }));
      await flush();
    });
    expect(next.referenceText).toBe('Hello world');
  });
});
