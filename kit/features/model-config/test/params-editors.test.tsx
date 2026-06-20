import { act, useState, type ReactNode } from 'react';
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

if (!window.HTMLElement.prototype.hasPointerCapture) {
  Object.defineProperty(window.HTMLElement.prototype, 'hasPointerCapture', {
    configurable: true,
    value: () => false,
  });
}

if (!window.HTMLElement.prototype.releasePointerCapture) {
  Object.defineProperty(window.HTMLElement.prototype, 'releasePointerCapture', {
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

async function chooseSelectOption(ariaLabel: string, optionText: string) {
  const trigger = Array.from(container?.querySelectorAll('button') || [])
    .find((button) => button.getAttribute('aria-label') === ariaLabel);
  expect(trigger).toBeTruthy();

  await act(async () => {
    trigger?.focus();
    trigger?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    trigger?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await flush();
    await flush();
  });

  const option = Array.from(document.querySelectorAll('[role="option"]'))
    .find((node) => node.textContent?.includes(optionText));
  expect(option).toBeTruthy();

  await act(async () => {
    option?.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    option?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    await flush();
  });
}

describe('TextGenerateParamsEditor', () => {
  it('propagates temperature updates and renders required field labels', async () => {
    let next: TextGenerateParamsState = { ...DEFAULT_TEXT_GENERATE_PARAMS };
    await render(
      <TextGenerateParamsEditor
        copy={{
          parametersLabel: 'Parameters',
          promptControlsLabel: 'Prompt controls',
          toneLabel: 'Tone',
          lengthLabel: 'Length',
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
    expect(container?.textContent).toContain('Tone');
    const toneTrigger = Array.from(container?.querySelectorAll('button') || [])
      .find((button) => button.getAttribute('aria-label') === 'Tone');
    expect(toneTrigger).toBeTruthy();
    expect(toneTrigger?.textContent).toContain('Clear');
    await chooseSelectOption('Tone', 'Warm');
    expect(next.tone).toBe('warm');
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
  it('renders voice reference as host-provided selection instead of manual text input', async () => {
    let next: AudioSynthesizeParamsState = { ...DEFAULT_AUDIO_SYNTHESIZE_PARAMS };
    await render(
      <AudioSynthesizeParamsEditor
        copy={{
          parametersLabel: 'Parameters',
          voiceRefLabel: 'Voice reference',
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
    expect(container?.textContent).toContain('Voice reference');
    const select = container?.querySelector('select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe('__default_voice__');
    const voiceInputs = Array.from(container?.querySelectorAll('input') || []) as HTMLInputElement[];
    expect(voiceInputs.some((input) => input.value === 'alloy')).toBe(false);
    await act(async () => {
      select.value = '__default_voice__';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();
    });
    expect(next.voiceRef).toEqual(null);
  });

  it('renders voice choices when provided by the host surface', async () => {
    let next: AudioSynthesizeParamsState = { ...DEFAULT_AUDIO_SYNTHESIZE_PARAMS, voiceRef: { kind: 'preset_voice_id', presetVoiceId: 'arthur' } };
    await render(
      <AudioSynthesizeParamsEditor
        copy={{
          parametersLabel: 'Parameters',
          voiceRefLabel: 'Voice reference',
          speakingRateLabel: 'Speaking rate',
          volumeLabel: 'Volume',
          pitchSemitonesLabel: 'Pitch',
          languageHintLabel: 'Language',
          responseFormatLabel: 'Response format',
          timeoutLabel: 'Timeout',
          defaultPlaceholder: 'Default',
        }}
        params={next}
        voiceOptions={[{ value: { kind: 'preset_voice_id', presetVoiceId: 'arthur' }, label: 'Arthur [zh-cn]' }]}
        onParamsChange={(value) => { next = value; }}
      />,
    );
    expect(container?.textContent).toContain('Arthur [zh-cn]');
  });

  it('selects custom voice assets from host-provided choices', async () => {
    let next: AudioSynthesizeParamsState = { ...DEFAULT_AUDIO_SYNTHESIZE_PARAMS };
    await render(
      <AudioSynthesizeParamsEditor
        copy={{
          parametersLabel: 'Parameters',
          voiceRefLabel: 'Voice reference',
          speakingRateLabel: 'Speaking rate',
          volumeLabel: 'Volume',
          pitchSemitonesLabel: 'Pitch',
          languageHintLabel: 'Language',
          responseFormatLabel: 'Response format',
          timeoutLabel: 'Timeout',
          defaultPlaceholder: 'Default',
        }}
        params={next}
        voiceOptions={[{
          value: { kind: 'voice_asset_id', voiceAssetId: '01KQCHXDMP0E65RZBV4X9XQ27Q' },
          label: 'design-sample · asset',
        }]}
        onParamsChange={(value) => { next = value; }}
      />,
    );
    expect(container?.textContent).toContain('design-sample · asset');
    const select = container?.querySelector('select') as HTMLSelectElement;
    await act(async () => {
      select.value = 'asset:01KQCHXDMP0E65RZBV4X9XQ27Q';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();
    });
    expect(next.voiceRef).toEqual({
      kind: 'voice_asset_id',
      voiceAssetId: '01KQCHXDMP0E65RZBV4X9XQ27Q',
    });
  });

  it('writes explicit provider voice refs into the Runtime voice reference contract', async () => {
    let next: AudioSynthesizeParamsState = { ...DEFAULT_AUDIO_SYNTHESIZE_PARAMS };
    function Harness() {
      const [params, setParams] = useState<AudioSynthesizeParamsState>(next);
      next = params;
      return (
        <AudioSynthesizeParamsEditor
          copy={{
            parametersLabel: 'Parameters',
            voiceRefLabel: 'Voice reference',
            providerVoiceRefLabel: 'Provider voice ref',
            speakingRateLabel: 'Speaking rate',
            volumeLabel: 'Volume',
            pitchSemitonesLabel: 'Pitch',
            languageHintLabel: 'Language',
            responseFormatLabel: 'Response format',
            timeoutLabel: 'Timeout',
            defaultPlaceholder: 'Default',
          }}
          params={params}
          onParamsChange={setParams}
        />
      );
    }
    await render(
      <Harness />,
    );
    expect(container?.textContent).toContain('Provider voice ref');
    const providerInput = Array.from(container?.querySelectorAll('input') || [])
      .find((input) => input.placeholder === 'provider_voice_ref') as HTMLInputElement;
    expect(providerInput).toBeTruthy();
    await act(async () => {
      setInputValue(providerInput, 'alice-local-voice');
      await flush();
    });
    expect(next.voiceRef).toEqual({
      kind: 'provider_voice_ref',
      providerVoiceRef: 'alice-local-voice',
    });
    await act(async () => {
      setInputValue(providerInput, '');
      await flush();
    });
    expect(next.voiceRef).toEqual(null);
  });

  it('renders TTS fields with shrink-safe controls for narrow capability drawers', async () => {
    let next: AudioSynthesizeParamsState = {
      ...DEFAULT_AUDIO_SYNTHESIZE_PARAMS,
      voiceRef: { kind: 'provider_voice_ref', providerVoiceRef: 'local.tts.qwen3-tts-customvoice-0.6b.safetensors' },
    };
    await render(
      <AudioSynthesizeParamsEditor
        copy={{
          parametersLabel: 'Parameters',
          voiceSectionLabel: 'Voice',
          audioTuningSectionLabel: 'Audio tuning',
          outputSectionLabel: 'Output',
          voiceRefLabel: 'Voice reference',
          voiceRefHint: 'Preset voice, custom voice asset, or provider voice reference.',
          providerVoiceRefLabel: 'Provider voice ref',
          providerVoiceRefHint: 'Explicit provider voice reference for local or remote TTS drivers.',
          providerVoiceRefPlaceholder: 'provider_voice_ref',
          speakingRateLabel: 'Speaking rate',
          volumeLabel: 'Volume',
          pitchSemitonesLabel: 'Pitch',
          languageHintLabel: 'Language',
          languageHintHint: 'BCP-47 tag, e.g. en-US.',
          responseFormatLabel: 'Response format',
          timeoutLabel: 'Timeout',
          defaultPlaceholder: 'Default',
        }}
        params={next}
        onParamsChange={(value) => { next = value; }}
      />,
    );

    expect(container?.firstElementChild?.className).toContain('min-w-0');
    for (const section of Array.from(container?.querySelectorAll('section') || [])) {
      expect(section.className).toContain('min-w-0');
    }
    for (const input of Array.from(container?.querySelectorAll('input') || [])) {
      expect(input.className).toContain('min-w-0');
      expect(input.className).toContain('max-w-full');
    }
    for (const select of Array.from(container?.querySelectorAll('select') || [])) {
      expect(select.className).toContain('min-w-0');
      expect(select.className).toContain('max-w-full');
    }

    const sliderInputs = Array.from(container?.querySelectorAll('input[type="range"]') || []);
    expect(sliderInputs.length).toBe(3);
    for (const slider of sliderInputs) {
      expect(slider.className).toContain('min-w-0');
      expect(slider.className).toContain('max-w-full');
    }
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
          cloneParametersLabel: 'Voice clone parameters',
          designParametersLabel: 'Voice design parameters',
          referenceAssetLabel: 'Reference asset',
          referenceTextLabel: 'Reference text',
          voiceDesignPromptLabel: 'Voice design prompt',
          previewTextLabel: 'Preview text',
          languageLabel: 'Language',
          preferredNameLabel: 'Preferred name',
          durationLabel: 'Duration',
          seedLabel: 'Seed',
          timeoutLabel: 'Timeout',
        }}
        mode="voice_clone"
        params={next}
        onParamsChange={(value) => { next = value; }}
      />,
    );
    expect(container?.textContent).toContain('Voice clone parameters');
    expect(container?.textContent).toContain('Reference text');
    expect(container?.textContent).not.toContain('Voice design prompt');
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
