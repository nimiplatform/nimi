// Legacy → current naming mapping for the App Access page. Single source of
// truth shared by the contract tests (coverage/naming guards) and the redesign
// report, so the Windows acceptance recipe can re-point its probe references.

export type AppAccessTestIdMappingEntry = {
  readonly legacy: string;
  readonly current: string;
  readonly note?: string;
};

export const appAccessTestIdMapping: readonly AppAccessTestIdMappingEntry[] = [
  { legacy: 'imp4-app-access-panel', current: 'app-access-page' },
  { legacy: 'imp4-refresh-access', current: 'app-access-refresh-session' },
  { legacy: 'imp4-fact-app-running', current: 'app-access-fact-app-process' },
  { legacy: 'imp4-fact-nimi-access', current: 'app-access-fact-session' },
  { legacy: 'imp4-fact-tooling', current: 'app-access-fact-tooling' },
  { legacy: 'imp4-current-user', current: 'app-access-fact-current-user' },
  {
    legacy: 'imp4-ai-config',
    current: '(folded)',
    note: 'App AIConfig uses the covered self-owner get/options/CAS manager; Desktop remains an optional centralized handoff',
  },
  {
    legacy: 'imp4-local-text',
    current: 'app-access-probe-text-generation',
    note: 'outcome region: app-access-run-text-generation-result',
  },
  {
    legacy: 'imp4-world-create',
    current: 'app-access-probe-world-create',
    note: 'outcome region: app-access-run-world-create-result',
  },
  {
    legacy: 'imp4-agent-home-world',
    current: '(folded)',
    note: 'now a facts line inside app-access-run-world-create-result; no separate test id',
  },
  {
    legacy: 'imp4-cloud-selection',
    current: '(folded)',
    note: 'provider and model authoring moved to the Nimi-owned App configuration surface',
  },
  {
    legacy: 'imp4-run-storage',
    current: 'app-access-run-storage-isolation',
    note: 'roundtrip only; rejection assertions moved to app-access-run-storage-boundary; result ids keep the -result suffix',
  },
  {
    legacy: 'imp4-run-storage-result',
    current: 'app-access-run-storage-isolation-result',
    note: 'boundary rejections now report at app-access-run-storage-boundary-result',
  },
  { legacy: 'imp4-run-realm-list', current: 'app-access-run-world-list' },
  {
    legacy: 'imp4-run-local-ai',
    current: 'app-access-run-text-generation',
    note: 'runs against the current owner-managed App AIConfig without mutating it',
  },
  { legacy: 'imp4-run-authority-rejection', current: '(folded)', note: 'self-owner mutation and conflicts are handled by the shared Model Config manager' },
  { legacy: 'imp4-run-world-create', current: 'app-access-run-world-create' },
  { legacy: 'imp4-run-cloud-selection', current: '(folded)', note: 'Cloud route selection is available through the shared Model Config manager in Lab or Desktop' },
  { legacy: 'imp5-agent-catalog', current: 'app-access-run-agent-references-result' },
  { legacy: 'imp5-agent-select', current: 'app-access-agent-select' },
  { legacy: 'imp5-run-agent-list', current: 'app-access-run-agent-references' },
  { legacy: 'imp5-run-conversation', current: 'app-access-run-agent-conversation' },
  { legacy: 'imp5-run-agent-interrupt', current: 'app-access-run-agent-interrupt' },
  { legacy: 'imp4-cloud-implementationId', current: '(folded)' },
  { legacy: 'imp4-cloud-driverId', current: '(folded)' },
  { legacy: 'imp4-cloud-driverDialect', current: '(folded)' },
  { legacy: 'imp4-cloud-provider', current: '(folded)' },
  { legacy: 'imp4-cloud-providerModelId', current: '(folded)' },
];

export type AppAccessLabelMappingEntry = {
  readonly legacy: string;
  readonly current: string;
  readonly note?: string;
};

export const appAccessLabelMapping: readonly AppAccessLabelMappingEntry[] = [
  { legacy: 'Refresh access', current: 'Refresh session', note: 'page header action' },
  {
    legacy: 'Run storage isolation',
    current: 'Storage isolation → Run',
    note: 'roundtrip only; path-escape and oversized-write assertions moved to the Storage boundary rejected card',
  },
  { legacy: 'List local WorldCores', current: 'WorldCore listing → Run' },
  {
    legacy: 'Overwrite Local + generate',
    current: 'Configured text generation → Run',
    note: 'reads the owner-managed App AIConfig and does not mutate it',
  },
  { legacy: 'Prove owner/custody rejection', current: 'Covered by the self-owner AIConfig manager and SDK validation' },
  { legacy: 'Create + verify WorldCore', current: 'WorldCore create & read-back → Run' },
  { legacy: 'List active Agent references', current: 'Active Agent references → Run' },
  { legacy: 'Run typed Agent conversation', current: 'Agent conversation → Run' },
  { legacy: 'Run typed Agent interrupt', current: 'Agent turn interrupt → Run' },
  { legacy: 'Save Cloud + prove selection-required', current: 'Configure this App in Lab or Nimi Desktop' },
];
