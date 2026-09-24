import { AudioWaveform, Braces, Clapperboard, ListChecks, ScanFace, Wrench } from 'lucide-react';
import type { StudioCapabilityRegistration } from '../../ai-studio-core/module-registration.js';
import { EMPTY_STUDIO_PARAMETERS } from '../../ai-studio-core/parameters.js';
import {
  LabImageFaceSwapParameterPanel,
  LabTextAnnotateParameterPanel,
  LabTextExchangeParameterPanel,
  LabVideoFaceSwapParameterPanel,
} from './capability-test-panels.js';
import {
  labAiRealtimeDescriptor,
  labImageFaceSwapDescriptor,
  labTextAnnotateDescriptor,
  labTextDecideDescriptor,
  labTextToolsDescriptor,
  labVideoFaceSwapDescriptor,
  type LabCapabilityTestId,
} from './capability-test-descriptors.js';
import { labImageFaceSwapParameters, labVideoFaceSwapParameters } from './face-swap.js';
import { labTextAnnotateParameters } from './text-annotate.js';
import { labTextDecideParameters } from './text-decide.js';
import { LabTextDecideParameterPanel } from './text-decide-panel.js';
import { LAB_TEST_TOOL_NAME, labTextExchangeParameters } from './text-exchange.js';

const k = (entry: string, field: string) => `CapabilityTests.${entry}.${field}`;

export const labTextAnnotateCapability = Object.freeze({
  descriptor: labTextAnnotateDescriptor,
  icon: Braces,
  profile: {
    studioTag: 'Annotation', inputTitleKey: k('textAnnotate', 'inputTitle'), inputPlaceholderKey: k('textAnnotate', 'inputPlaceholder'), inputKind: 'prompt', supportsAttachments: false, controls: [], primaryLabelKey: k('textAnnotate', 'primaryLabel'), primaryRunningLabelKey: k('textAnnotate', 'primaryRunningLabel'), resultTitle: 'Annotation', emptyTitleKey: k('textAnnotate', 'emptyTitle'), emptyHintKey: k('textAnnotate', 'emptyHint'), resultKind: 'text-annotation', footnoteKey: k('textAnnotate', 'footnote'), pendingLabelKey: k('textAnnotate', 'pending'), rawPrompt: true,
  },
  // The sample includes a character outside the Basic Multilingual Plane so
  // Unicode scalar offsets differ from UTF-16 indexes.
  preset: { id: 'unicode-sample', label: 'Unicode sample', prompt: 'The café sells 🍰 cake. It opens at 9.' },
  runtimeMethod: 'sdk.localApp.ai.scenarioJobs.submit:text-annotate',
  parameters: labTextAnnotateParameters,
  parameterPanel: LabTextAnnotateParameterPanel,
} as const satisfies StudioCapabilityRegistration<LabCapabilityTestId>);

export const labTextToolsCapability = Object.freeze({
  descriptor: labTextToolsDescriptor,
  icon: Wrench,
  profile: {
    studioTag: 'Tools', inputTitleKey: k('textTools', 'inputTitle'), inputPlaceholderKey: k('textTools', 'inputPlaceholder'), inputKind: 'prompt', supportsAttachments: false, controls: [], primaryLabelKey: k('textTools', 'primaryLabel'), primaryRunningLabelKey: k('textTools', 'primaryRunningLabel'), resultTitle: 'Exchange', emptyTitleKey: k('textTools', 'emptyTitle'), emptyHintKey: k('textTools', 'emptyHint'), resultKind: 'text-exchange', footnoteKey: k('textTools', 'footnote'), rawPrompt: true,
  },
  preset: { id: 'fixed-tool', label: 'Fixed tool', prompt: `Use the ${LAB_TEST_TOOL_NAME} tool to convert 30 centimeters to inches, then write a one-line release note about the result.` },
  runtimeMethod: 'sdk.localApp.ai.scenario.execute:text-generate',
  parameters: labTextExchangeParameters,
  parameterPanel: LabTextExchangeParameterPanel,
} as const satisfies StudioCapabilityRegistration<LabCapabilityTestId>);

// The whole request lives in Parameters; history records the exact spec sent.
export const labTextDecideCapability = Object.freeze({
  descriptor: labTextDecideDescriptor,
  icon: ListChecks,
  profile: {
    studioTag: 'Decisions', inputTitleKey: k('textDecide', 'inputTitle'), inputPlaceholderKey: k('textDecide', 'inputTitle'), inputKind: 'none', inputNoteKey: k('textDecide', 'inputNote'), supportsAttachments: false, controls: [], primaryLabelKey: k('textDecide', 'primaryLabel'), primaryRunningLabelKey: k('textDecide', 'primaryRunningLabel'), resultTitle: 'Decisions', emptyTitleKey: k('textDecide', 'emptyTitle'), emptyHintKey: k('textDecide', 'emptyHint'), resultKind: 'text-decision', footnoteKey: k('textDecide', 'footnote'), pendingLabelKey: k('textDecide', 'pending'), requiresParameterInput: true,
  },
  preset: { id: 'decision-request', label: 'Decision request', prompt: '' },
  runtimeMethod: 'sdk.localApp.ai.scenario.execute:text-decide',
  parameters: labTextDecideParameters,
  parameterPanel: LabTextDecideParameterPanel,
} as const satisfies StudioCapabilityRegistration<LabCapabilityTestId>);

export const labImageFaceSwapCapability = Object.freeze({
  descriptor: labImageFaceSwapDescriptor,
  icon: ScanFace,
  profile: {
    studioTag: 'Face swap', inputTitleKey: k('imageFaceSwap', 'inputTitle'), inputPlaceholderKey: k('imageFaceSwap', 'inputTitle'), inputKind: 'none', inputNoteKey: k('imageFaceSwap', 'inputNote'), supportsAttachments: false, controls: [], primaryLabelKey: k('imageFaceSwap', 'primaryLabel'), primaryRunningLabelKey: k('imageFaceSwap', 'primaryRunningLabel'), resultTitle: 'Face swap', emptyTitleKey: k('imageFaceSwap', 'emptyTitle'), emptyHintKey: k('imageFaceSwap', 'emptyHint'), resultKind: 'artifacts', footnoteKey: k('imageFaceSwap', 'footnote'), pendingLabelKey: k('imageFaceSwap', 'pending'), requiresParameterInput: true,
  },
  preset: { id: 'selected-images', label: 'Selected images', prompt: '' },
  runtimeMethod: 'sdk.localApp.ai.scenarioJobs.submit:image-face-swap',
  parameters: labImageFaceSwapParameters,
  parameterPanel: LabImageFaceSwapParameterPanel,
} as const satisfies StudioCapabilityRegistration<LabCapabilityTestId>);

export const labVideoFaceSwapCapability = Object.freeze({
  descriptor: labVideoFaceSwapDescriptor,
  icon: Clapperboard,
  profile: {
    studioTag: 'Face swap', inputTitleKey: k('videoFaceSwap', 'inputTitle'), inputPlaceholderKey: k('videoFaceSwap', 'inputTitle'), inputKind: 'none', inputNoteKey: k('videoFaceSwap', 'inputNote'), supportsAttachments: false, controls: [], primaryLabelKey: k('videoFaceSwap', 'primaryLabel'), primaryRunningLabelKey: k('videoFaceSwap', 'primaryRunningLabel'), resultTitle: 'Face swap', emptyTitleKey: k('videoFaceSwap', 'emptyTitle'), emptyHintKey: k('videoFaceSwap', 'emptyHint'), resultKind: 'artifacts', footnoteKey: k('videoFaceSwap', 'footnote'), pendingLabelKey: k('videoFaceSwap', 'pending'), requiresParameterInput: true,
  },
  preset: { id: 'selected-video', label: 'Selected video', prompt: '' },
  runtimeMethod: 'sdk.localApp.ai.scenarioJobs.submit:video-face-swap',
  parameters: labVideoFaceSwapParameters,
  parameterPanel: LabVideoFaceSwapParameterPanel,
} as const satisfies StudioCapabilityRegistration<LabCapabilityTestId>);

// Direct AI Realtime has its own Lab page; the registration supplies its
// navigation, AIConfig inventory and history identity.
export const labAiRealtimeCapability = Object.freeze({
  descriptor: labAiRealtimeDescriptor,
  icon: AudioWaveform,
  profile: {
    studioTag: 'Realtime', inputTitleKey: k('aiRealtime', 'title'), inputPlaceholderKey: k('aiRealtime', 'title'), inputKind: 'none', supportsAttachments: false, controls: [], primaryLabelKey: k('aiRealtime', 'open'), primaryRunningLabelKey: k('aiRealtime', 'opening'), resultTitle: 'Session', emptyTitleKey: k('aiRealtime', 'title'), emptyHintKey: k('aiRealtime', 'intro'), resultKind: 'session', footnoteKey: k('aiRealtime', 'intro'),
  },
  preset: { id: 'direct-session', label: 'Direct session', prompt: '' },
  runtimeMethod: 'sdk.localApp.ai.realtime',
  parameters: EMPTY_STUDIO_PARAMETERS,
} as const satisfies StudioCapabilityRegistration<LabCapabilityTestId>);

export const labCapabilityTestRegistrations = Object.freeze([
  labTextAnnotateCapability,
  labTextToolsCapability,
  labTextDecideCapability,
  labImageFaceSwapCapability,
  labVideoFaceSwapCapability,
  labAiRealtimeCapability,
]);
