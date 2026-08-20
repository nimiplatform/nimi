import type { ReactNode } from 'react';

import type { StudioCapabilityRegistration } from './module-registration.js';
import type { StudioCapabilityRunResult, StudioRuntimeInspection } from './runtime-types.js';
import type { StudioRunConfigSnapshot, StudioRunHistory, StudioRunHistoryRecord } from './history.js';

export { statusForCapability } from './section-ai-testing-admission.js';
export type { CapabilityStatus } from './section-ai-testing-admission.js';
export { CapabilityRunHistory } from './section-ai-testing-history.js';
export { DrawerErrorBoundary } from './section-ai-testing-ai-config.js';
export {
  ArtifactMediaPreview,
  ArtifactMediaResult,
  RuntimeDiagnosticsActions,
  TextStudioOutputBody,
  artifactExtension,
  downloadArtifactUrl,
  downloadTextFile,
  hasPreviewableArtifact,
  resultPlainText,
} from './section-ai-testing-output.js';
export { StudioResult } from './section-ai-testing-studio-result.js';

export type StudioAIConfigPanelRenderInput = {
  readonly runtime: StudioRuntimeInspection | null;
  readonly capabilityId: string;
};

export type SectionAITestingProps = {
  readonly registration: StudioCapabilityRegistration;
  readonly registrations: readonly StudioCapabilityRegistration[];
  readonly runtime: StudioRuntimeInspection | null;
  readonly onResult: (
    result: StudioCapabilityRunResult,
    prompt: string,
    runConfig?: StudioRunConfigSnapshot,
  ) => StudioRunHistoryRecord | null | Promise<StudioRunHistoryRecord | null>;
  readonly history: StudioRunHistory | null;
  readonly lastResult: StudioCapabilityRunResult | null;
  readonly historySelectionRequest: { requestId: number; record: StudioRunHistoryRecord } | null;
  readonly onSelectHistoryRun: (record: StudioRunHistoryRecord) => void;
  readonly verboseConsole: boolean;
  readonly draftPersistence: boolean;
  readonly headerActions?: ReactNode;
  readonly renderAIConfigPanel?: (input: StudioAIConfigPanelRenderInput) => ReactNode;
  readonly rootTestId?: string;
};
