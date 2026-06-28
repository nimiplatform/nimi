import type { ReactNode } from 'react';
import type { TesterCapability } from '../tester-capabilities.js';
import type { TesterAIConfigSummary } from '../tester-ai-config.js';
import type { TesterRunConfigSnapshot, TesterRunHistory, TesterRunHistoryRecord } from '../tester-history.js';
import type { TesterCapabilityRunResult } from '../tester-runtime.js';

export {
  STATUS_PILL_LABEL,
  presetFor,
  statusForCapability,
} from './section-ai-testing-admission.js';
export type {
  CapabilityStatus,
  ScenarioPreset,
} from './section-ai-testing-admission.js';
export { CapabilityRunHistory } from './section-ai-testing-history.js';
export { DrawerErrorBoundary, TesterAiConfigSettingsPanel } from './section-ai-testing-model-config.js';
export {
  ArtifactMediaPreview,
  RuntimeDiagnosticsActions,
  TextStudioOutputBody,
  artifactExtension,
  downloadArtifactUrl,
  downloadTextFile,
  formatRuntimeRequestDiagnostics,
  hasPreviewableArtifact,
  resultPlainText,
} from './section-ai-testing-output.js';
export { StudioResult } from './section-ai-testing-studio-result.js';

export type SectionAITestingProps = {
  capability: TesterCapability;
  onResult: (result: TesterCapabilityRunResult, prompt: string, runConfig?: TesterRunConfigSnapshot) => TesterRunHistoryRecord | null | Promise<TesterRunHistoryRecord | null>;
  summary: TesterAIConfigSummary | null;
  history: TesterRunHistory | null;
  lastResult: TesterCapabilityRunResult | null;
  historySelectionRequest: { requestId: number; record: TesterRunHistoryRecord } | null;
  onSelectHistoryRun: (record: TesterRunHistoryRecord) => void;
  verboseConsole: boolean;
  draftPersistence: boolean;
  headerActions?: ReactNode;
};
