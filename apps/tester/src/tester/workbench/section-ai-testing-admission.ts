import type { TesterCapability, TesterCapabilityId } from '../tester-capabilities.js';
import type {
  TesterCapabilityRunResult,
  TesterRuntimeInspection,
} from '../tester-runtime.js';

export type ScenarioPreset = {
  id: string;
  label: string;
  prompt: string;
};

export type CapabilityStatus = {
  label: 'ready' | 'simulated' | 'blocked' | 'not admitted' | 'SDK gap' | 'tauri-only' | 'checking';
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
      id: 'stream-probe',
      label: 'Stream probe',
      prompt: 'Continue this conversation as a Runtime app stream readiness check.',
    },
  ],
  'text.embed': [
    {
      id: 'embedding-sample',
      label: 'Embedding sample',
      prompt: 'Nimi App tester embedding readiness sample.',
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
      id: 'clip-probe',
      label: 'Clip probe',
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
  runtime: TesterRuntimeInspection | null,
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
  if (!runtime) {
    return {
      label: 'checking',
      tone: 'neutral',
      detail: 'Runtime inspection has not completed yet.',
    };
  }
  if (runtime.status === 'simulated') {
    return {
      label: 'simulated',
      tone: 'info',
      detail: runtime.detail,
    };
  }
  if (runtime.status === 'connected' && capability.id === 'text.generate') {
    return {
      label: 'ready',
      tone: 'success',
      detail: 'The protected ai.text.generate SDK operation is admitted. Runtime owns the managed local route and Desktop owns the permission decision.',
    };
  }
  if (runtime.status === 'connected') {
    return {
      label: 'not admitted',
      tone: 'info',
      detail: runtime.detail,
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
  if (runtime.status !== 'ready') {
    return {
      label: 'blocked',
      tone: 'warning',
      detail: runtime.detail,
    };
  }
  return {
    label: 'ready',
    tone: 'success',
    detail: 'Runtime session active and SDK admission surface is available.',
  };
}

export const STATUS_PILL_LABEL: Record<CapabilityStatus['label'], string> = {
  ready: 'Ready',
  simulated: 'Simulated',
  blocked: 'Blocked',
  'not admitted': 'Not admitted',
  'SDK gap': 'SDK gap',
  'tauri-only': 'Tauri only',
  checking: 'Checking',
};
