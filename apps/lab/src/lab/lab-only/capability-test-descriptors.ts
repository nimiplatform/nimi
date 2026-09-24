// Lab-only development entries for canonical capabilities and contract
// behaviors that the public App scaffold slices do not expose. They consume
// the formal Local App client; public scaffold admission stays a separate
// decision in App Tools.
export type LabCapabilityTestId =
  | 'text.annotate'
  | 'text.tools'
  | 'text.decide'
  | 'image.face_swap'
  | 'video.face_swap'
  | 'realtime.interact';

export const labTextAnnotateDescriptor = Object.freeze({
  id: 'text.annotate', label: 'Text annotation', labelKey: 'CapabilityTests.textAnnotate.label', group: 'text',
  section: 'embed',
  summary: 'Language + documents → text.annotate Scenario Job → tokens, sentences and a saved annotation document.',
  summaryKey: 'CapabilityTests.textAnnotate.summary',
  surface: 'sdk.localApp.ai.scenarioJobs:text-annotate + storage.assets.write',
  execution: 'runtime-sdk', capabilityContract: 'text.annotate',
} as const);

export const labTextToolsDescriptor = Object.freeze({
  id: 'text.tools', label: 'Tools & structured output', labelKey: 'CapabilityTests.textTools.label', group: 'text',
  section: 'chat',
  summary: 'Fixed test tool or fixed JSON Schema → ordered text.generate items → App-side checks.',
  summaryKey: 'CapabilityTests.textTools.summary',
  surface: 'sdk.localApp.ai.scenario.execute:text-generate (tools, responseFormat, ordered turn items)',
  execution: 'runtime-sdk', capabilityContract: 'text.generate',
} as const);

export const labTextDecideDescriptor = Object.freeze({
  id: 'text.decide', label: 'Decisions', labelKey: 'CapabilityTests.textDecide.label', group: 'text',
  section: 'chat',
  summary: 'One text or JSON state + choice and yes/no questions → one synchronous text.decide Scenario → per-question probabilities.',
  summaryKey: 'CapabilityTests.textDecide.summary',
  surface: 'sdk.localApp.ai.scenario.execute:text-decide (AbortSignal, timeoutMs)',
  execution: 'runtime-sdk', capabilityContract: 'text.decide',
} as const);

export const labImageFaceSwapDescriptor = Object.freeze({
  id: 'image.face_swap', label: 'Image face swap', labelKey: 'CapabilityTests.imageFaceSwap.label', group: 'media',
  section: 'image',
  summary: 'Reference + target image → image.face_swap Scenario Job → adopted PNG.',
  summaryKey: 'CapabilityTests.imageFaceSwap.summary',
  surface: 'sdk.localApp.ai.artifacts.upload → scenarioJobs:image-face-swap → storage.assets.adoptArtifact',
  execution: 'runtime-sdk', capabilityContract: 'image.face_swap',
} as const);

export const labVideoFaceSwapDescriptor = Object.freeze({
  id: 'video.face_swap', label: 'Video face swap', labelKey: 'CapabilityTests.videoFaceSwap.label', group: 'media',
  section: 'video',
  summary: 'Reference image + finite MP4 → video.face_swap Scenario Job, or a separate frame Session test.',
  summaryKey: 'CapabilityTests.videoFaceSwap.summary',
  surface: 'sdk.localApp.ai.scenarioJobs:video-face-swap + ai.videoSessions',
  execution: 'runtime-sdk', capabilityContract: 'video.face_swap',
} as const);

export const labAiRealtimeDescriptor = Object.freeze({
  id: 'realtime.interact', label: 'AI Realtime', labelKey: 'CapabilityTests.aiRealtime.label', group: 'audio',
  section: 'voice',
  summary: 'Direct App AI Realtime Session without an Agent: text and audio input, events, controls and Close.',
  summaryKey: 'CapabilityTests.aiRealtime.summary',
  surface: 'sdk.localApp.ai.realtime (open, appendInput, submitOwnerControl, subscribe, interruptOutput, close)',
  execution: 'runtime-sdk', capabilityContract: 'realtime.interact',
} as const);

export const labCapabilityTestDescriptors = Object.freeze([
  labTextAnnotateDescriptor,
  labTextToolsDescriptor,
  labTextDecideDescriptor,
  labImageFaceSwapDescriptor,
  labVideoFaceSwapDescriptor,
  labAiRealtimeDescriptor,
] as const);

// The current Runtime runs these entries only on a Local route: text
// annotation, both face swap Jobs and the video Session refuse a Cloud intent
// with AI_ROUTE_UNSUPPORTED. AI Realtime is not listed; its Local refusal is a
// missing driver that Runtime reports when a Session opens.
const labLocalRouteOnlyTestIds: ReadonlySet<string> = new Set<LabCapabilityTestId>(['text.annotate', 'image.face_swap', 'video.face_swap']);

export function isLabLocalRouteOnlyCapability(capabilityId: string): boolean {
  return labLocalRouteOnlyTestIds.has(capabilityId);
}
