// App Access page catalog: the single source of truth for group/probe metadata,
// product-language copy, guidance text, and data-testid constants. Pure module —
// no React, no SDK imports, safe for node:test contract coverage.

export type AppAccessGroupId =
  | 'storage'
  | 'realm'
  | 'ai-consumption'
  | 'agent-conversation'
  | 'boundary';

export type AppAccessProbeId =
  | 'storage-isolation'
  | 'world-list'
  | 'world-create'
  | 'portable-ai-config'
  | 'local-text'
  | 'cloud-posture'
  | 'agent-references'
  | 'agent-conversation'
  | 'agent-interrupt'
  | 'authority-injection'
  | 'storage-boundary';

export type AppAccessProbeGateKind = 'probe-passed' | 'cloud-draft' | 'agent-selection';

export type AppAccessProbeDefinition = {
  readonly id: AppAccessProbeId;
  readonly group: AppAccessGroupId;
  readonly title: string;
  readonly proves: string;
  readonly requires?: string;
  readonly running: string;
  readonly gate?: {
    readonly kind: AppAccessProbeGateKind;
    readonly probe?: AppAccessProbeId;
    readonly guidance: string;
  };
  readonly testId: string;
  readonly runTestId: string;
  readonly resultTestId: string;
};

export type AppAccessGroupDefinition = {
  readonly id: AppAccessGroupId;
  readonly title: string;
  readonly blurb: string;
  readonly probes: readonly AppAccessProbeId[];
  readonly testId: string;
  readonly runTestId: string;
};

const probe = (
  id: AppAccessProbeId,
  group: AppAccessGroupId,
  title: string,
  proves: string,
  running: string,
  extra?: { readonly requires?: string; readonly gate?: AppAccessProbeDefinition['gate'] },
): AppAccessProbeDefinition => ({
  id,
  group,
  title,
  proves,
  running,
  requires: extra?.requires,
  gate: extra?.gate,
  testId: `app-access-probe-${id}`,
  runTestId: `app-access-run-${id}`,
  resultTestId: `app-access-run-${id}-result`,
});

export const appAccessProbes: readonly AppAccessProbeDefinition[] = [
  probe(
    'storage-isolation',
    'storage',
    'Storage isolation',
    'App-private JSON write, read-back, and removal stay consistent inside the App storage boundary.',
    'Writing, reading back, and removing an App-private document…',
  ),
  probe(
    'world-list',
    'realm',
    'WorldCore listing',
    'The App can list local Realm WorldCores through its declared Realm data access.',
    'Listing local WorldCores…',
  ),
  probe(
    'world-create',
    'realm',
    'WorldCore create & read-back',
    'A WorldCore created through the App Realm owner reads back with matching identity and content hash.',
    'Creating a WorldCore and verifying the read-back…',
  ),
  probe(
    'portable-ai-config',
    'ai-consumption',
    'Portable AIConfig',
    'A portable App AIConfig whole-overwrite with a Local route persists and reads back without custody fields.',
    'Whole-overwriting a portable Local route…',
  ),
  probe(
    'local-text',
    'ai-consumption',
    'Local text generation',
    'The committed Local route serves a unary text generation through the real Runtime path.',
    'Generating text through the committed Local route…',
    {
      requires: 'Portable AIConfig',
      gate: {
        kind: 'probe-passed',
        probe: 'portable-ai-config',
        guidance: 'Run Portable AIConfig first so a Local route is committed.',
      },
    },
  ),
  probe(
    'cloud-posture',
    'ai-consumption',
    'Cloud authorization posture',
    'A grantless Cloud intent persists, and its execution must demand a Nimi-owned authorization selection.',
    'Saving a grantless Cloud intent and proving selection-required…',
    {
      requires: 'Catalog-derived Cloud values',
      gate: {
        kind: 'cloud-draft',
        guidance: 'Paste catalog-derived values for all five fields — Tester has no provider/model defaults by design. Find them in the Runtime model catalog.',
      },
    },
  ),
  probe(
    'agent-references',
    'agent-conversation',
    'Active Agent references',
    'The App can list the current account’s active Agent references for typed conversation.',
    'Listing current-account active Agent references…',
  ),
  probe(
    'agent-conversation',
    'agent-conversation',
    'Agent conversation',
    'A typed Agent conversation opens, streams, and completes with a committed assistant reply.',
    'Opening a typed Agent conversation…',
    {
      requires: 'Selected Agent reference',
      gate: {
        kind: 'agent-selection',
        guidance: 'Select an active Agent reference first.',
      },
    },
  ),
  probe(
    'agent-interrupt',
    'agent-conversation',
    'Agent turn interrupt',
    'An accepted Agent turn can be explicitly interrupted and ends in the interrupted terminal state.',
    'Opening a typed Agent conversation to interrupt…',
    {
      requires: 'Selected Agent reference',
      gate: {
        kind: 'agent-selection',
        guidance: 'Select an active Agent reference first.',
      },
    },
  ),
  probe(
    'authority-injection',
    'boundary',
    'Authority injection rejected',
    'Owner and custody fields injected into a portable AIConfig are rejected before leaving the App.',
    'Injecting forbidden owner and custody fields…',
  ),
  probe(
    'storage-boundary',
    'boundary',
    'Storage boundary rejected',
    'Path escapes and oversized writes against App-private storage are rejected.',
    'Attempting a path escape and an oversized write…',
  ),
];

export const appAccessProbeById: Readonly<Record<AppAccessProbeId, AppAccessProbeDefinition>> =
  Object.fromEntries(appAccessProbes.map((definition) => [definition.id, definition])) as Record<
    AppAccessProbeId,
    AppAccessProbeDefinition
  >;

export const appAccessGroups: readonly AppAccessGroupDefinition[] = [
  {
    id: 'storage',
    title: 'App Storage (Base)',
    blurb: 'App-private JSON storage, isolated per App.',
    probes: ['storage-isolation'],
    testId: 'app-access-group-storage',
    runTestId: 'app-access-run-group-storage',
  },
  {
    id: 'realm',
    title: 'Realm Data',
    blurb: 'Declared Realm data access: list and create WorldCores.',
    probes: ['world-list', 'world-create'],
    testId: 'app-access-group-realm',
    runTestId: 'app-access-run-group-realm',
  },
  {
    id: 'ai-consumption',
    title: 'AI Consumption',
    blurb: 'Portable AIConfig, Local text generation, and grantless Cloud posture.',
    probes: ['portable-ai-config', 'local-text', 'cloud-posture'],
    testId: 'app-access-group-ai-consumption',
    runTestId: 'app-access-run-group-ai-consumption',
  },
  {
    id: 'agent-conversation',
    title: 'Agent Conversation',
    blurb: 'Active Agent references, typed conversation, and turn interrupt — in dependency order.',
    probes: ['agent-references', 'agent-conversation', 'agent-interrupt'],
    testId: 'app-access-group-agent-conversation',
    runTestId: 'app-access-run-group-agent-conversation',
  },
  {
    id: 'boundary',
    title: 'Boundary Probes',
    blurb: 'Forbidden authority fields and storage escapes must be rejected.',
    probes: ['authority-injection', 'storage-boundary'],
    testId: 'app-access-group-boundary',
    runTestId: 'app-access-run-group-boundary',
  },
];

export const appAccessPageIds = {
  page: 'app-access-page',
  refreshSession: 'app-access-refresh-session',
  runAll: 'app-access-run-all',
  agentSelect: 'app-access-agent-select',
} as const;

export type AppAccessSessionFactId = 'app-process' | 'session' | 'tooling' | 'current-user';

export const appAccessSessionFacts: Readonly<Record<AppAccessSessionFactId, { readonly label: string; readonly testId: string }>> = {
  'app-process': { label: 'App process', testId: 'app-access-fact-app-process' },
  session: { label: 'Nimi session', testId: 'app-access-fact-session' },
  tooling: { label: 'Developer tooling', testId: 'app-access-fact-tooling' },
  'current-user': { label: 'Current user', testId: 'app-access-fact-current-user' },
};

export const appAccessCloudFields = [
  { id: 'implementationId', label: 'Implementation ID', testId: 'app-access-cloud-implementation-id' },
  { id: 'driverId', label: 'Driver ID', testId: 'app-access-cloud-driver-id' },
  { id: 'driverDialect', label: 'Driver dialect', testId: 'app-access-cloud-driver-dialect' },
  { id: 'provider', label: 'Provider', testId: 'app-access-cloud-provider' },
  { id: 'providerModelId', label: 'Provider model ID', testId: 'app-access-cloud-provider-model-id' },
] as const;

export type AppAccessCloudFieldId = (typeof appAccessCloudFields)[number]['id'];

export type AppAccessCloudDraft = Readonly<Record<AppAccessCloudFieldId, string>>;

export const emptyAppAccessCloudDraft: AppAccessCloudDraft = {
  implementationId: '',
  driverId: '',
  driverDialect: '',
  provider: '',
  providerModelId: '',
};

export const appAccessPageCopy = {
  title: 'App Access',
  eyebrow: 'Nimi Lab',
  blurb: 'Verify a third-party local App contract against the real Runtime link: session and identity posture, app-private storage, Realm data, AI consumption, Agent conversation, and boundary rejections. Every probe runs the real path; nothing is simulated.',
  refreshSession: 'Refresh session',
  runAll: 'Run all probes',
  runGroup: 'Run group',
  signedOut: 'Sign in to Nimi from the account menu to run App Access probes.',
  sessionLost: 'The Nimi session was lost. Probe evidence from the previous session has been cleared.',
  noAgentReferences: 'No active Agent under the current account. Create and activate one in Nimi Desktop, then re-run Active Agent references.',
  technicalDetails: 'Technical details',
  notRun: 'Not run yet.',
} as const;

// Human-first failure copy for the probe-runner reason codes this page raises
// itself. Anything unmapped falls back to a generic sentence; the verbatim
// reason code always stays available in the Technical details disclosure.
export const appAccessFailureCopy: Readonly<Record<string, string>> = {
  'storage-roundtrip-mismatch': 'Stored data did not match what was written.',
  'storage-remove-failed': 'The stored document could not be removed.',
  'unexpected-success': 'The Runtime accepted an operation that must be rejected — the boundary is broken.',
  'unexpected-rejection': 'The operation was rejected for a different reason than expected.',
  'ai-config-readback-invalid': 'The saved AI configuration did not read back as a clean portable Local route.',
  'cloud-readback-invalid': 'The saved Cloud intent did not read back as a grantless portable intent.',
  'cloud-intent-field-invalid': 'A Cloud intent field is empty, has surrounding whitespace, or is too long.',
  'world-core-list-read-mismatch': 'The created WorldCore did not read back with matching identity and content hash.',
  'operation-failed': 'The probe could not be completed. See technical details.',
};

export function appAccessHumanFailure(reasonCode: string): string {
  return appAccessFailureCopy[reasonCode] ?? appAccessFailureCopy['operation-failed'];
}
