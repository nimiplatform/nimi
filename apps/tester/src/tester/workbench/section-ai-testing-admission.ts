import type { TesterCapability, TesterCapabilityId } from '../tester-capabilities.js';
import type {
  TesterCapabilityRunResult,
} from '../tester-runtime.js';
import type { TesterRunTargetSummary } from '../tester-run-target.js';

export type ScenarioPreset = {
  id: string;
  label: string;
  prompt: string;
};

export type CapabilityStatus = {
  label: 'configured' | 'blocked' | 'not admitted' | 'SDK gap' | 'tauri-only' | 'checking';
  tone: 'success' | 'warning' | 'info' | 'neutral';
  detail: string;
};

// Scenario presets stay app-local; runtime/model selection remains owned by the
// shared AI model config surface and the runtime trace.
const scenarioPresets: Partial<Record<TesterCapabilityId, ScenarioPreset[]>> = {
  'text.generate': [
    {
      id: 'acceptance-note',
      label: 'Acceptance note',
      prompt: 'Write a concise acceptance note for a Runtime-backed Nimi App that can generate helpful content.',
    },
  ],
  'chat.stream': [
    {
      id: 'stream-sample',
      label: 'Stream sample',
      prompt: 'Continue this conversation through the text.generate stream contract.',
    },
  ],
  'text.embed': [
    {
      id: 'embedding-sample',
      label: 'Embedding sample',
      prompt: 'Nimi App tester embedding sample.',
    },
  ],
  'image.generate': [
    {
      id: 'ui-preview',
      label: 'UI preview',
      prompt: 'Generate a product-grade UI inspection image for a Nimi App workbench.',
    },
  ],
  'video.generate': [
    {
      id: 'clip-sample',
      label: 'Clip sample',
      prompt: 'Create a short inspection clip for a Nimi App glass UI workflow.',
    },
  ],
  'audio.synthesize': [
    {
      id: 'speech-line',
      label: 'Speech line',
      prompt: 'Synthesize a short Runtime acceptance sentence.',
    },
  ],
  'audio.transcribe': [
    {
      id: 'audio-url',
      label: 'Audio URL',
      prompt: 'https://example.test/sample.wav',
    },
  ],
  'speech.bundle': [
    {
      id: 'voice-catalog',
      label: 'Voice catalog',
      prompt: 'List voices through Kit Runtime voice catalog.',
    },
  ],
  'world.generate': [
    {
      id: 'fixture-viewer',
      label: 'Viewer fixture',
      prompt: 'Resolve the world-tour fixture and open the standalone viewer.',
    },
  ],
};

export function presetFor(capability: TesterCapability): ScenarioPreset {
  const presets = scenarioPresets[capability.id];
  return presets?.[0] ?? { id: 'default', label: 'Default', prompt: capability.summary };
}

export function statusForCapability(
  capability: TesterCapability,
  target: TesterRunTargetSummary,
  lastResult: TesterCapabilityRunResult | null,
): CapabilityStatus {
  if (capability.execution === 'standalone-tauri') {
    return {
      label: 'tauri-only',
      tone: 'info',
      detail: 'Standalone viewer fixture. It can write a local run record, but it is not a runtime artifact.',
    };
  }
  if (capability.execution === 'typed-unavailable') {
    return {
      label: 'SDK gap',
      tone: 'warning',
      detail: capability.missingSurface || 'No admitted typed SDK method is available for this capability.',
    };
  }
  if (
    lastResult?.capabilityId === capability.id
    && !lastResult.ok
    && 'reason' in lastResult
    && lastResult.reason === 'sdk-method-unavailable'
  ) {
    return {
      label: 'SDK gap',
      tone: 'warning',
      detail: lastResult.message,
    };
  }
  if (target.status === 'configured') {
    return {
      label: 'configured',
      tone: 'info',
      detail: target.detail,
    };
  }
  if (target.status === 'checking') {
    return {
      label: 'checking',
      tone: 'neutral',
      detail: target.detail,
    };
  }
  if (target.status === 'not-admitted') {
    return {
      label: 'not admitted',
      tone: 'info',
      detail: target.detail,
    };
  }
  if (target.status === 'sdk-gap') {
    return {
      label: 'SDK gap',
      tone: 'warning',
      detail: target.detail,
    };
  }
  if (target.status === 'blocked') {
    return {
      label: 'blocked',
      tone: 'warning',
      detail: target.detail,
    };
  }
  return {
    label: 'blocked',
    tone: 'warning',
    detail: target.detail,
  };
}

export const STATUS_PILL_LABEL: Record<CapabilityStatus['label'], string> = {
  configured: 'Configured',
  blocked: 'Blocked',
  'not admitted': 'Not admitted',
  'SDK gap': 'SDK gap',
  'tauri-only': 'Tauri only',
  checking: 'Checking',
};
