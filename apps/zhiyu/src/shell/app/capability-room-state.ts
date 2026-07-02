import type { ZhiyuEvidence } from './evidence';

export type ZhiyuCapabilityCatalogDescriptor = {
  readonly capabilityId: string;
  readonly section: string;
  readonly editorKind: string | null;
  readonly sourceRef: {
    readonly table: string;
    readonly capability: string;
  };
  readonly runtimeEvidenceClass: string;
  readonly governance?: {
    readonly owner: string;
    readonly dataMovement: string;
    readonly retention: string;
    readonly revocation: string;
    readonly auditSource: string;
  };
};

export type ZhiyuCapabilityDeferredDescriptor = {
  readonly capability: string;
  readonly table: string;
  readonly reason: string;
  readonly sourceRule: string;
};

export type ZhiyuCapabilityRoomItemState =
  | 'ready'
  | 'catalog-only'
  | 'needs-setup'
  | 'denied'
  | 'revoked'
  | 'unsupported'
  | 'unavailable';

export type ZhiyuCapabilityConsentMatrixRow = {
  readonly ownerDomain: string;
  readonly currentState: ZhiyuCapabilityRoomItemState;
  readonly dataMovement: string;
  readonly retention: string;
  readonly revocationPath: string;
  readonly auditSource: string;
  readonly auditRef: string;
  readonly unsupportedReason: string;
  readonly setupRequirement: string;
  readonly source: 'canonical-capability-catalog' | 'not_projected';
};

export type ZhiyuCapabilityRoomItem = {
  readonly capabilityId: string;
  readonly section: string;
  readonly editorKind: string | null;
  readonly runtimeEvidenceClass: string;
  readonly sourceTable: string;
  readonly sourceCapability: string;
  readonly active: boolean;
  readonly state: ZhiyuCapabilityRoomItemState;
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly bindingRoute: 'local' | 'cloud' | null;
  readonly bindingModelId: string | null;
  readonly governance: ZhiyuCapabilityGovernanceProjection;
  readonly matrix: ZhiyuCapabilityConsentMatrixRow;
};

export type ZhiyuCapabilityGovernanceProjection = {
  readonly owner: string;
  readonly dataMovement: string;
  readonly retention: string;
  readonly revocation: string;
  readonly auditSource: string;
  readonly source: 'canonical-capability-catalog' | 'not_projected';
};

export type ZhiyuCapabilityRoomOwnerCard = {
  readonly key: 'catalog' | 'route' | 'model' | 'memory';
  readonly title: string;
  readonly owner: string;
  readonly state: 'ready' | 'blocked' | 'not-admitted';
  readonly reasonCode: string;
};

export type ZhiyuCapabilityRoomState = {
  readonly title: '能力房间';
  readonly activeCapabilityId: string;
  readonly catalogCount: number;
  readonly deferredCount: number;
  readonly readyCount: number;
  readonly blockedCount: number;
  readonly routeReady: boolean;
  readonly routeReasonCode: string;
  readonly routeActionHint: string;
  readonly executionBindingLabel: string;
  readonly items: readonly ZhiyuCapabilityRoomItem[];
  readonly owners: readonly ZhiyuCapabilityRoomOwnerCard[];
};

export function projectZhiyuCapabilityRoomState(input: {
  readonly evidence: ZhiyuEvidence;
  readonly catalog: readonly ZhiyuCapabilityCatalogDescriptor[];
  readonly deferred: readonly ZhiyuCapabilityDeferredDescriptor[];
}): ZhiyuCapabilityRoomState {
  const activeCapabilityId = input.evidence.route.capability;
  const items = input.catalog.map((descriptor) => projectCapabilityItem(input.evidence, descriptor, activeCapabilityId));
  const readyCount = items.filter((item) => item.state === 'ready').length;
  const blockedCount = items.filter((item) => item.state !== 'ready' && item.state !== 'catalog-only').length;

  return {
    title: '能力房间',
    activeCapabilityId,
    catalogCount: input.catalog.length,
    deferredCount: input.deferred.length,
    readyCount,
    blockedCount,
    routeReady: routeIsReady(input.evidence),
    routeReasonCode: input.evidence.route.reasonCode,
    routeActionHint: input.evidence.route.actionHint,
    executionBindingLabel: executionBindingLabel(input.evidence),
    items,
    owners: ownerCards(input.evidence),
  };
}

function projectCapabilityItem(
  evidence: ZhiyuEvidence,
  descriptor: ZhiyuCapabilityCatalogDescriptor,
  activeCapabilityId: string,
): ZhiyuCapabilityRoomItem {
  const active = descriptor.capabilityId === activeCapabilityId;
  const governance = projectCapabilityGovernance(descriptor);
  if (!active) {
    return {
      capabilityId: descriptor.capabilityId,
      section: descriptor.section,
      editorKind: descriptor.editorKind,
      runtimeEvidenceClass: descriptor.runtimeEvidenceClass,
      sourceTable: descriptor.sourceRef.table,
      sourceCapability: descriptor.sourceRef.capability,
      active,
      state: 'catalog-only',
      reasonCode: 'zhiyu-capability-catalog-only',
      actionHint: 'open_canonical_capability_projection',
      bindingRoute: null,
      bindingModelId: null,
      governance,
      matrix: projectCapabilityMatrix({
        governance,
        state: 'catalog-only',
        reasonCode: 'zhiyu-capability-catalog-only',
        actionHint: 'open_canonical_capability_projection',
      }),
    };
  }

  const binding = evidence.route.executionBinding;
  const ready = evidence.route.ready && Boolean(binding);
  const state = ready ? 'ready' : classifyCapabilityConsentState(evidence.route.reasonCode);
  return {
    capabilityId: descriptor.capabilityId,
    section: descriptor.section,
    editorKind: descriptor.editorKind,
    runtimeEvidenceClass: descriptor.runtimeEvidenceClass,
    sourceTable: descriptor.sourceRef.table,
    sourceCapability: descriptor.sourceRef.capability,
    active,
    state,
    reasonCode: evidence.route.reasonCode,
    actionHint: evidence.route.actionHint,
    bindingRoute: binding?.route ?? null,
    bindingModelId: binding?.modelId ?? null,
    governance,
    matrix: projectCapabilityMatrix({
      governance,
      state,
      reasonCode: evidence.route.reasonCode,
      actionHint: evidence.route.actionHint,
    }),
  };
}

function projectCapabilityGovernance(
  descriptor: ZhiyuCapabilityCatalogDescriptor,
): ZhiyuCapabilityGovernanceProjection {
  const governance = descriptor.governance;
  if (!governance) {
    return {
      owner: 'not_projected',
      dataMovement: 'not_projected',
      retention: 'not_projected',
      revocation: 'not_projected',
      auditSource: 'not_projected',
      source: 'not_projected',
    };
  }
  return {
    owner: governance.owner,
    dataMovement: governance.dataMovement,
    retention: governance.retention,
    revocation: governance.revocation,
    auditSource: governance.auditSource,
    source: 'canonical-capability-catalog',
  };
}

function projectCapabilityMatrix(input: {
  readonly governance: ZhiyuCapabilityGovernanceProjection;
  readonly state: ZhiyuCapabilityRoomItemState;
  readonly reasonCode: string;
  readonly actionHint: string;
}): ZhiyuCapabilityConsentMatrixRow {
  return {
    ownerDomain: input.governance.owner,
    currentState: input.state,
    dataMovement: input.governance.dataMovement,
    retention: input.governance.retention,
    revocationPath: input.governance.revocation,
    auditSource: input.governance.auditSource,
    auditRef: 'not_projected',
    unsupportedReason: unsupportedReasonForState(input.state, input.reasonCode),
    setupRequirement: setupRequirementForState(input.state, input.actionHint),
    source: input.governance.source,
  };
}

function classifyCapabilityConsentState(reasonCode: string): ZhiyuCapabilityRoomItemState {
  const reason = reasonCode.toLowerCase();
  if (reason.includes('revoked')) {
    return 'revoked';
  }
  if (reason.includes('denied') || reason.includes('unauthorized') || reason.includes('forbidden')) {
    return 'denied';
  }
  if (reason.includes('unsupported')) {
    return 'unsupported';
  }
  if (
    reason.includes('setup')
    || reason.includes('required')
    || reason.includes('missing')
    || reason.includes('selection')
  ) {
    return 'needs-setup';
  }
  return 'unavailable';
}

function unsupportedReasonForState(
  state: ZhiyuCapabilityRoomItemState,
  reasonCode: string,
): string {
  if (state === 'unsupported') {
    return reasonCode;
  }
  if (state === 'catalog-only') {
    return 'not_evaluated';
  }
  return 'not_unsupported';
}

function setupRequirementForState(
  state: ZhiyuCapabilityRoomItemState,
  actionHint: string,
): string {
  switch (state) {
    case 'ready':
      return 'none';
    case 'catalog-only':
      return 'select_capability_to_evaluate_route';
    case 'denied':
      return 'restore_permission_or_route_access';
    case 'revoked':
      return 'restore_revoked_runtime_or_connector_access';
    case 'unsupported':
      return 'choose_admitted_capability_or_route';
    case 'needs-setup':
    case 'unavailable':
    default:
      return actionHint;
  }
}

function ownerCards(evidence: ZhiyuEvidence): readonly ZhiyuCapabilityRoomOwnerCard[] {
  const routeReady = routeIsReady(evidence);
  return [
    {
      key: 'catalog',
      title: '能力身份',
      owner: 'Platform capability catalog',
      state: 'ready',
      reasonCode: 'P-CAPCAT-001',
    },
    {
      key: 'route',
      title: '出站路由',
      owner: 'Runtime/SDK route projection',
      state: routeReady ? 'ready' : 'blocked',
      reasonCode: evidence.route.reasonCode,
    },
    {
      key: 'model',
      title: '模型绑定',
      owner: 'AIConfig and Runtime route binding',
      state: evidence.route.executionBinding ? 'ready' : 'blocked',
      reasonCode: evidence.route.executionBinding ? 'runtime-route-binding-ready' : evidence.route.reasonCode,
    },
    {
      key: 'memory',
      title: '记忆使用',
      owner: 'Cognition memory projection',
      state: 'not-admitted',
      reasonCode: 'zhiyu-memory-observability-projection-not-admitted',
    },
  ];
}

function routeIsReady(evidence: ZhiyuEvidence): boolean {
  return evidence.route.ready && Boolean(evidence.route.executionBinding);
}

function executionBindingLabel(evidence: ZhiyuEvidence): string {
  const binding = evidence.route.executionBinding;
  if (!evidence.route.ready || !binding) {
    return '等待 Runtime/SDK route projection';
  }
  return `${binding.route}:${binding.modelId}`;
}
