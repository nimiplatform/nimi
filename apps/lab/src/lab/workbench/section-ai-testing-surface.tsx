import type { ReactNode } from 'react';
import type { LabCapability } from '../lab-capabilities.js';
import type { LabAIConfigSummary } from '../lab-ai-config.js';
import type { LabRunConfigSnapshot, LabRunHistory, LabRunHistoryRecord } from '../lab-history.js';
import type { LabCapabilityRunResult } from '../lab-runtime.js';

export {
  presetFor,
  statusForCapability,
} from './section-ai-testing-admission.js';
export type {
  CapabilityStatus,
  ScenarioPreset,
} from './section-ai-testing-admission.js';
export { CapabilityRunHistory } from './section-ai-testing-history.js';
export { DrawerErrorBoundary, LabAiConfigSettingsPanel } from './section-ai-testing-ai-config.js';
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

export type SectionAITestingProps = {
  capability: LabCapability;
  onResult: (result: LabCapabilityRunResult, prompt: string, runConfig?: LabRunConfigSnapshot) => LabRunHistoryRecord | null | Promise<LabRunHistoryRecord | null>;
  summary: LabAIConfigSummary | null;
  history: LabRunHistory | null;
  lastResult: LabCapabilityRunResult | null;
  historySelectionRequest: { requestId: number; record: LabRunHistoryRecord } | null;
  onSelectHistoryRun: (record: LabRunHistoryRecord) => void;
  verboseConsole: boolean;
  draftPersistence: boolean;
  headerActions?: ReactNode;
};
