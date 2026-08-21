// App Access page catalog: the single source of truth for group/probe metadata,
// product-language copy, guidance text, and data-testid constants. Pure module —
// no React, no SDK imports, safe for node:test contract coverage.
//
// All user-visible copy is stored as i18n keys into the `AppAccess` locale
// section (src/shell/i18n/locales/<locale>/app-access.json); the render layer
// resolves them through t() so locale switches re-render with fresh copy.

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
  | 'persona-owner-list'
  | 'persona-owner-create-replace'
  | 'persona-owner-persistence'
  | 'text-generation'
  | 'agent-references'
  | 'agent-conversation'
  | 'agent-interrupt'
  | 'storage-boundary';

export type AppAccessProbeGateKind = 'agent-selection';

export type AppAccessProbeDefinition = {
  readonly id: AppAccessProbeId;
  readonly group: AppAccessGroupId;
  readonly titleKey: string;
  readonly provesKey: string;
  readonly requiresKey?: string;
  /** Must only run from an explicit, per-operation confirmation. Group and run-all plans exclude it. */
  readonly requiresExplicitConfirmation?: boolean;
  /** Read-only diagnostic with a prerequisite that bulk plans cannot establish safely. */
  readonly excludeFromAutomaticPlans?: boolean;
  readonly runningKey: string;
  readonly gate?: {
    readonly kind: AppAccessProbeGateKind;
    readonly guidanceKey: string;
  };
  readonly testId: string;
  readonly runTestId: string;
  readonly resultTestId: string;
};

export type AppAccessGroupDefinition = {
  readonly id: AppAccessGroupId;
  readonly titleKey: string;
  readonly blurbKey: string;
  readonly probes: readonly AppAccessProbeId[];
  readonly testId: string;
  readonly runTestId: string;
};

const probe = (
  id: AppAccessProbeId,
  group: AppAccessGroupId,
  keySegment: string,
  extra?: {
    readonly requiresKey?: string;
    readonly requiresExplicitConfirmation?: boolean;
    readonly excludeFromAutomaticPlans?: boolean;
    readonly gate?: AppAccessProbeDefinition['gate'];
  },
): AppAccessProbeDefinition => ({
  id,
  group,
  titleKey: `AppAccess.probes.${keySegment}.title`,
  provesKey: `AppAccess.probes.${keySegment}.proves`,
  runningKey: `AppAccess.probes.${keySegment}.running`,
  requiresKey: extra?.requiresKey,
  requiresExplicitConfirmation: extra?.requiresExplicitConfirmation,
  excludeFromAutomaticPlans: extra?.excludeFromAutomaticPlans,
  gate: extra?.gate,
  testId: `app-access-probe-${id}`,
  runTestId: `app-access-run-${id}`,
  resultTestId: `app-access-run-${id}-result`,
});

export const appAccessProbes: readonly AppAccessProbeDefinition[] = [
  probe('storage-isolation', 'storage', 'storageIsolation'),
  probe('world-list', 'realm', 'worldList'),
  probe('world-create', 'realm', 'worldCreate', {
    requiresKey: 'AppAccess.probes.worldCreate.requires',
    requiresExplicitConfirmation: true,
  }),
  probe('persona-owner-list', 'realm', 'personaOwnerList'),
  probe('persona-owner-create-replace', 'realm', 'personaOwnerCreateReplace', {
    requiresKey: 'AppAccess.probes.personaOwnerCreateReplace.requires',
    requiresExplicitConfirmation: true,
  }),
  probe('persona-owner-persistence', 'realm', 'personaOwnerPersistence', {
    requiresKey: 'AppAccess.probes.personaOwnerPersistence.requires',
    excludeFromAutomaticPlans: true,
  }),
  probe('text-generation', 'ai-consumption', 'textGeneration'),
  probe('agent-references', 'agent-conversation', 'agentReferences'),
  probe('agent-conversation', 'agent-conversation', 'agentConversation', {
    requiresKey: 'AppAccess.probes.agentConversation.requires',
    gate: {
      kind: 'agent-selection',
      guidanceKey: 'AppAccess.probes.agentConversation.gateGuidance',
    },
  }),
  probe('agent-interrupt', 'agent-conversation', 'agentInterrupt', {
    requiresKey: 'AppAccess.probes.agentInterrupt.requires',
    gate: {
      kind: 'agent-selection',
      guidanceKey: 'AppAccess.probes.agentInterrupt.gateGuidance',
    },
  }),
  probe('storage-boundary', 'boundary', 'storageBoundary'),
];

export const appAccessProbeById: Readonly<Record<AppAccessProbeId, AppAccessProbeDefinition>> =
  Object.fromEntries(appAccessProbes.map((definition) => [definition.id, definition])) as Record<
    AppAccessProbeId,
    AppAccessProbeDefinition
  >;

export const appAccessGroups: readonly AppAccessGroupDefinition[] = [
  {
    id: 'storage',
    titleKey: 'AppAccess.groups.storage.title',
    blurbKey: 'AppAccess.groups.storage.blurb',
    probes: ['storage-isolation'],
    testId: 'app-access-group-storage',
    runTestId: 'app-access-run-group-storage',
  },
  {
    id: 'realm',
    titleKey: 'AppAccess.groups.realm.title',
    blurbKey: 'AppAccess.groups.realm.blurb',
    probes: ['world-list', 'world-create', 'persona-owner-list', 'persona-owner-create-replace', 'persona-owner-persistence'],
    testId: 'app-access-group-realm',
    runTestId: 'app-access-run-group-realm',
  },
  {
    id: 'ai-consumption',
    titleKey: 'AppAccess.groups.aiConsumption.title',
    blurbKey: 'AppAccess.groups.aiConsumption.blurb',
    probes: ['text-generation'],
    testId: 'app-access-group-ai-consumption',
    runTestId: 'app-access-run-group-ai-consumption',
  },
  {
    id: 'agent-conversation',
    titleKey: 'AppAccess.groups.agentConversation.title',
    blurbKey: 'AppAccess.groups.agentConversation.blurb',
    probes: ['agent-references', 'agent-conversation', 'agent-interrupt'],
    testId: 'app-access-group-agent-conversation',
    runTestId: 'app-access-run-group-agent-conversation',
  },
  {
    id: 'boundary',
    titleKey: 'AppAccess.groups.boundary.title',
    blurbKey: 'AppAccess.groups.boundary.blurb',
    probes: ['storage-boundary'],
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

export const appAccessSessionFacts: Readonly<Record<AppAccessSessionFactId, { readonly labelKey: string; readonly testId: string }>> = {
  'app-process': { labelKey: 'AppAccess.sessionFacts.appProcess', testId: 'app-access-fact-app-process' },
  session: { labelKey: 'AppAccess.sessionFacts.session', testId: 'app-access-fact-session' },
  tooling: { labelKey: 'AppAccess.sessionFacts.tooling', testId: 'app-access-fact-tooling' },
  'current-user': { labelKey: 'AppAccess.sessionFacts.currentUser', testId: 'app-access-fact-current-user' },
};

// Page-level copy as i18n keys. Renderers resolve each value through t().
export const appAccessPageCopy = {
  title: 'AppAccess.page.title',
  eyebrow: 'AppAccess.page.eyebrow',
  blurb: 'AppAccess.page.blurb',
  refreshSession: 'AppAccess.page.refreshSession',
  runAll: 'AppAccess.page.runAll',
  runGroup: 'AppAccess.page.runGroup',
  signedOut: 'AppAccess.page.signedOut',
  sessionLost: 'AppAccess.page.sessionLost',
  noAgentReferences: 'AppAccess.page.noAgentReferences',
  technicalDetails: 'AppAccess.page.technicalDetails',
  notRun: 'AppAccess.page.notRun',
} as const;

// Human-first failure copy for the probe-runner reason codes this page raises
// itself, as i18n keys. Anything unmapped falls back to a generic sentence;
// the verbatim reason code always stays available in the Technical details
// disclosure. Keys stay camelCase so they never embed the raw reason code.
export const appAccessFailureCopy: Readonly<Record<string, string>> = {
  'storage-roundtrip-mismatch': 'AppAccess.failures.storageRoundtripMismatch',
  'storage-remove-failed': 'AppAccess.failures.storageRemoveFailed',
  'unexpected-success': 'AppAccess.failures.unexpectedSuccess',
  'unexpected-rejection': 'AppAccess.failures.unexpectedRejection',
  'world-core-list-read-mismatch': 'AppAccess.failures.worldCoreListReadMismatch',
  'operation-failed': 'AppAccess.failures.operationFailed',
};

export function appAccessHumanFailureKey(reasonCode: string): string {
  return appAccessFailureCopy[reasonCode] ?? appAccessFailureCopy['operation-failed'];
}
