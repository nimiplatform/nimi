import type {
  CatalogConsentReason,
  CatalogPackageSummary,
  CatalogTrustTier,
  RuntimeLocalManifestSummary,
  RuntimeModDiagnosticRecord,
} from '@renderer/bridge';
import type { RuntimeModRegisterFailure } from '@runtime/mod';

export const MOD_HUB_COLORS = {
  brand50: '#ecfeff',
  brand100: '#cefafe',
  brand500: '#00b8db',
  brand600: '#0092b8',
  brand700: '#007595',
  green100: '#dcfce7',
  green600: '#16a34a',
  green700: '#15803d',
  blue500: '#3b82f6',
  blue600: '#2563eb',
  cyan100: '#cffafe',
  cyan700: '#0e7490',
  orange500: '#f97316',
  purple600: '#9333ea',
  gray100: '#f3f4f6',
  gray300: '#d1d5db',
  gray400: '#9ca3af',
  gray500: '#6b7280',
  gray600: '#4b5563',
  gray700: '#374151',
} as const;

export type BadgeType = 'verified' | 'catalog' | 'official' | 'community';
export type ModHubModSource = 'runtime' | 'catalog';
export type ModHubRuntimeAction = 'install' | 'uninstall' | 'enable' | 'disable' | 'update' | 'retry';
export type ModHubActionKind = ModHubRuntimeAction | 'open' | 'open-folder';
export type ModHubPendingActionType = ModHubRuntimeAction;
export type ModHubVisualState =
  | 'failed'
  | 'conflict'
  | 'update-available'
  | 'enabled'
  | 'disabled'
  | 'available';
export type ModHubActionTone = 'primary' | 'secondary' | 'danger' | 'ghost';

export type ModHubActionDescriptor = {
  kind: ModHubActionKind;
  tone: ModHubActionTone;
};

export type ModHubSection = {
  key: 'installed' | 'available';
  mods: ModHubMod[];
};

export type ModHubMod = {
  id: string;
  name: string;
  description: string;
  author: string;
  badge?: BadgeType;
  rating?: number;
  ratingCount?: string;
  installs?: string;
  version: string;
  updatedAgo?: string;
  iconBg: string;
  iconText: string;
  iconImageSrc?: string;
  source: ModHubModSource;
  packageType?: 'desktop-mod' | 'nimi-app' | string;
  catalogPackageId?: string;
  trustTier?: CatalogTrustTier | string;
  releaseChannel?: string;
  advisoryCount?: number;
  availableUpdateVersion?: string;
  requiresUserConsent?: boolean;
  consentReasons?: CatalogConsentReason[];
  addedCapabilities?: string[];
  supportedByDesktop?: boolean;
  installDisabledReason?: string;
  warningText?: string;
  runtimeStatus?: 'loaded' | 'disabled' | 'failed' | 'conflict';
  runtimeSourceType?: 'installed' | 'dev';
  runtimeSourceDir?: string;
  runtimeManifestPath?: string;
  runtimeConflict?: boolean;
  runtimeError?: string;
  runtimeConflictPaths?: string[];
  isInstalled: boolean;
  isEnabled: boolean;
  publisherVerified?: boolean;
  visualState: ModHubVisualState;
  statusLabelKey: string;
  canOpenFromDock: boolean;
  primaryAction: ModHubActionDescriptor | null;
  secondaryAction: ModHubActionDescriptor | null;
  menuActions: ModHubActionDescriptor[];
};

function fallbackIconText(name: string, modId: string): string {
  const candidate = String(name || modId || '').trim();
  return String(candidate.slice(0, 2) || 'M').toUpperCase();
}

function normalizeRuntimeDisplayName(input: {
  id: string;
  summaryName: string;
  manifestName: string;
  fallbackName: string;
}): string {
  const id = String(input.id || '').trim();
  const candidate = String(
    input.summaryName
      || input.manifestName
      || input.fallbackName,
  ).trim();

  if (!candidate) {
    return id || 'Runtime Mod';
  }
  if (/^desktop\s+/i.test(candidate)) {
    return candidate.replace(/^desktop\s+/i, '').trim() || candidate;
  }
  return candidate;
}

function trustTierBadge(trustTier: CatalogTrustTier | string | undefined): BadgeType | undefined {
  if (trustTier === 'official') return 'official';
  if (trustTier === 'verified') return 'verified';
  if (trustTier === 'community') return 'community';
  return undefined;
}

function resolveVisualState(mod: {
  isInstalled: boolean;
  isEnabled: boolean;
  runtimeStatus?: ModHubMod['runtimeStatus'];
  availableUpdateVersion?: string;
}): ModHubVisualState {
  if (mod.runtimeStatus === 'conflict') return 'conflict';
  if (mod.runtimeStatus === 'failed') return 'failed';
  if (mod.isInstalled && mod.availableUpdateVersion) return 'update-available';
  if (mod.isInstalled && mod.isEnabled) return 'enabled';
  if (mod.isInstalled) return 'disabled';
  return 'available';
}

function resolveStatusLabelKey(visualState: ModHubVisualState): string {
  switch (visualState) {
    case 'failed':
      return 'statusFailed';
    case 'conflict':
      return 'statusConflict';
    case 'update-available':
      return 'statusUpdateReady';
    case 'enabled':
      return 'statusEnabled';
    case 'disabled':
      return 'statusDisabled';
    default:
      return 'statusAvailable';
  }
}

function resolvePrimaryAction(mod: {
  visualState: ModHubVisualState;
  isInstalled: boolean;
  supportedByDesktop?: boolean;
  installDisabledReason?: string;
}): ModHubActionDescriptor | null {
  if (!mod.isInstalled) {
    if (mod.supportedByDesktop === false || mod.installDisabledReason) {
      return null;
    }
    return { kind: 'install', tone: 'primary' };
  }
  switch (mod.visualState) {
    case 'failed':
      return { kind: 'retry', tone: 'primary' };
    case 'conflict':
      return null;
    case 'update-available':
      return { kind: 'update', tone: 'primary' };
    case 'enabled':
      return { kind: 'open', tone: 'primary' };
    case 'disabled':
      return { kind: 'enable', tone: 'primary' };
    default:
      return null;
  }
}

function resolveSecondaryAction(mod: {
  visualState: ModHubVisualState;
  isInstalled: boolean;
  isEnabled: boolean;
  runtimeStatus?: ModHubMod['runtimeStatus'];
}): ModHubActionDescriptor | null {
  if (!mod.isInstalled) {
    return null;
  }
  switch (mod.visualState) {
    case 'update-available':
      if (mod.isEnabled && mod.runtimeStatus === 'loaded') {
        return { kind: 'open', tone: 'secondary' };
      }
      return { kind: 'enable', tone: 'secondary' };
    case 'enabled':
      return { kind: 'disable', tone: 'secondary' };
    default:
      return null;
  }
}

function resolveMenuActions(mod: {
  isInstalled: boolean;
  isEnabled: boolean;
  visualState: ModHubVisualState;
  runtimeSourceDir?: string;
  runtimeManifestPath?: string;
}): ModHubActionDescriptor[] {
  if (!mod.isInstalled) {
    return [];
  }
  const actions: ModHubActionDescriptor[] = [];
  if (mod.visualState === 'failed' && mod.isEnabled) {
    actions.push({ kind: 'disable', tone: 'ghost' });
  }
  actions.push({ kind: 'uninstall', tone: 'danger' });
  if (String(mod.runtimeSourceDir || '').trim() || String(mod.runtimeManifestPath || '').trim()) {
    actions.push({ kind: 'open-folder', tone: 'ghost' });
  }
  return actions;
}

function decorateModHubMod(base: Omit<ModHubMod, 'visualState' | 'statusLabelKey' | 'canOpenFromDock' | 'primaryAction' | 'secondaryAction' | 'menuActions'>): ModHubMod {
  const visualState = resolveVisualState(base);
  return {
    ...base,
    visualState,
    statusLabelKey: resolveStatusLabelKey(visualState),
    canOpenFromDock: base.isInstalled && base.isEnabled && base.runtimeStatus === 'loaded' && !base.availableUpdateVersion,
    primaryAction: resolvePrimaryAction({
      visualState,
      isInstalled: base.isInstalled,
      supportedByDesktop: base.supportedByDesktop,
      installDisabledReason: base.installDisabledReason,
    }),
    secondaryAction: resolveSecondaryAction({
      visualState,
      isInstalled: base.isInstalled,
      isEnabled: base.isEnabled,
      runtimeStatus: base.runtimeStatus,
    }),
    menuActions: resolveMenuActions({
      isInstalled: base.isInstalled,
      isEnabled: base.isEnabled,
      visualState,
      runtimeSourceDir: base.runtimeSourceDir,
      runtimeManifestPath: base.runtimeManifestPath,
    }),
  };
}

function resolveRuntimeStatus(input: {
  isInstalled: boolean;
  isEnabled: boolean;
  diagnostic?: RuntimeModDiagnosticRecord | null;
  failure?: RuntimeModRegisterFailure | null;
  fused?: { reason: string; lastError: string; at: string } | null;
}): ModHubMod['runtimeStatus'] {
  if (input.diagnostic?.status === 'conflict') {
    return 'conflict';
  }
  if (input.failure || input.fused || input.diagnostic?.status === 'invalid') {
    return 'failed';
  }
  if (input.isInstalled && input.isEnabled) {
    return 'loaded';
  }
  return 'disabled';
}

function resolveRuntimeError(input: {
  diagnostic?: RuntimeModDiagnosticRecord | null;
  failure?: RuntimeModRegisterFailure | null;
  fused?: { reason: string; lastError: string; at: string } | null;
}): string {
  return String(
    input.failure?.error
      || input.fused?.lastError
      || input.diagnostic?.error
      || '',
  ).trim();
}

export function toRuntimeModRow(
  summary: RuntimeLocalManifestSummary,
  index: number,
  input: {
    iconImageSrc?: string;
    isInstalled: boolean;
    isEnabled: boolean;
    availableUpdateVersion?: string;
    advisoryCount?: number;
    requiresUserConsent?: boolean;
    consentReasons?: CatalogConsentReason[];
    addedCapabilities?: string[];
    diagnostic?: RuntimeModDiagnosticRecord | null;
    failure?: RuntimeModRegisterFailure | null;
    fused?: { reason: string; lastError: string; at: string } | null;
  },
): ModHubMod {
  const manifest = summary.manifest && typeof summary.manifest === 'object'
    ? (summary.manifest as Record<string, unknown>)
    : {};
  const id = String(summary.id || '').trim();
  const displayName = normalizeRuntimeDisplayName({
    id,
    summaryName: String(summary.name || ''),
    manifestName: String(manifest.name || ''),
    fallbackName: id || `mod-${index + 1}`,
  });
  const description = String(summary.description || manifest.description || 'Runtime registered mod');
  const version = String(summary.version || manifest.version || '1.0.0');
  const author = (() => {
    const publisherValue = manifest.publisher;
    if (publisherValue && typeof publisherValue === 'object') {
      const name = String((publisherValue as Record<string, unknown>).name || '').trim();
      if (name) return name;
    }
    const authorValue = manifest.author;
    if (authorValue && typeof authorValue === 'object') {
      const name = String((authorValue as Record<string, unknown>).name || '').trim();
      if (name) return name;
    }
    const plainAuthor = String(authorValue || '').trim();
    if (plainAuthor) return plainAuthor;
    return 'Runtime Mod';
  })();
  const publisherRecord = manifest.publisher && typeof manifest.publisher === 'object'
    ? manifest.publisher as Record<string, unknown>
    : null;
  const publisherVerified = Boolean(publisherRecord?.verified);

  return decorateModHubMod({
    id,
    name: displayName,
    description,
    author,
    badge: publisherVerified ? 'verified' : undefined,
    version: `v${String(version).replace(/^v/i, '')}`,
    iconBg: `linear-gradient(135deg, ${MOD_HUB_COLORS.brand500}, ${MOD_HUB_COLORS.blue600})`,
    iconText: fallbackIconText(displayName, id),
    iconImageSrc: input.iconImageSrc,
    source: 'runtime',
    packageType: 'desktop-mod',
    catalogPackageId: id,
    trustTier: undefined,
    releaseChannel: undefined,
    advisoryCount: input.advisoryCount || 0,
    availableUpdateVersion: input.availableUpdateVersion,
    requiresUserConsent: input.requiresUserConsent,
    consentReasons: input.consentReasons,
    addedCapabilities: input.addedCapabilities,
    supportedByDesktop: true,
    installDisabledReason: undefined,
    warningText: undefined,
    runtimeStatus: resolveRuntimeStatus(input),
    runtimeSourceType: summary.sourceType,
    runtimeSourceDir: summary.sourceDir,
    runtimeManifestPath: summary.path,
    runtimeConflict: input.diagnostic?.status === 'conflict',
    runtimeError: resolveRuntimeError(input),
    runtimeConflictPaths: Array.isArray(input.diagnostic?.conflictPaths) ? input.diagnostic?.conflictPaths : [],
    isInstalled: input.isInstalled,
    isEnabled: input.isEnabled,
    publisherVerified,
  });
}

export function toCatalogModRow(
  summary: CatalogPackageSummary,
  input: {
    localIconImageSrc?: string;
    isInstalled: boolean;
    isEnabled: boolean;
    installedVersion?: string;
    availableUpdateVersion?: string;
    advisoryCount?: number;
    requiresUserConsent?: boolean;
    consentReasons?: CatalogConsentReason[];
    addedCapabilities?: string[];
    runtimeStatus?: ModHubMod['runtimeStatus'];
    runtimeSourceType?: 'installed' | 'dev';
    runtimeSourceDir?: string;
    runtimeManifestPath?: string;
    runtimeError?: string;
    runtimeConflict?: boolean;
    runtimeConflictPaths?: string[];
  },
): ModHubMod {
  const trustTier = summary.publisher.trustTier;
  const isSupported = summary.packageType === 'desktop-mod';
  const version = input.installedVersion || summary.latestVersion || '0.0.0';
  const iconImageSrc = input.localIconImageSrc || summary.iconUrl;

  return decorateModHubMod({
    id: summary.packageId,
    name: summary.name,
    description: summary.description,
    author: summary.publisher.displayName,
    badge: trustTierBadge(trustTier),
    version: `v${String(version).replace(/^v/i, '')}`,
    iconBg: trustTier === 'official'
      ? `linear-gradient(135deg, ${MOD_HUB_COLORS.brand600}, ${MOD_HUB_COLORS.cyan700})`
      : trustTier === 'verified'
        ? `linear-gradient(135deg, ${MOD_HUB_COLORS.blue600}, ${MOD_HUB_COLORS.purple600})`
        : `linear-gradient(135deg, ${MOD_HUB_COLORS.gray500}, ${MOD_HUB_COLORS.gray700})`,
    iconText: fallbackIconText(summary.name, summary.packageId),
    iconImageSrc,
    source: 'catalog',
    packageType: summary.packageType,
    catalogPackageId: summary.packageId,
    trustTier,
    releaseChannel: summary.latestChannel,
    advisoryCount: input.advisoryCount || 0,
    availableUpdateVersion: input.availableUpdateVersion,
    requiresUserConsent: input.requiresUserConsent,
    consentReasons: input.consentReasons,
    addedCapabilities: input.addedCapabilities,
    supportedByDesktop: isSupported,
    installDisabledReason: isSupported ? undefined : 'Desktop v1 does not install nimi-app packages yet.',
    warningText: summary.state.quarantined
      ? 'Quarantined by catalog policy.'
      : summary.state.yanked
        ? 'This release is yanked and cannot be installed.'
        : trustTier === 'community'
          ? 'Community package. Review publisher and capabilities before enabling.'
          : undefined,
    runtimeStatus: input.runtimeStatus,
    runtimeSourceType: input.runtimeSourceType,
    runtimeSourceDir: input.runtimeSourceDir,
    runtimeManifestPath: input.runtimeManifestPath,
    runtimeConflict: input.runtimeConflict,
    runtimeError: input.runtimeError,
    runtimeConflictPaths: input.runtimeConflictPaths || [],
    isInstalled: input.isInstalled,
    isEnabled: input.isEnabled,
    publisherVerified: trustTier === 'official' || trustTier === 'verified',
  });
}

function managementPriority(mod: ModHubMod): number {
  switch (mod.visualState) {
    case 'failed':
    case 'conflict':
      return 5;
    case 'update-available':
      return 4;
    case 'enabled':
      return 3;
    case 'disabled':
      return 2;
    default:
      return 1;
  }
}

export function sortModsForManagement(input: readonly ModHubMod[]): ModHubMod[] {
  return [...input].sort((a, b) => {
    const priorityDiff = managementPriority(b) - managementPriority(a);
    if (priorityDiff !== 0) return priorityDiff;
    return a.name.localeCompare(b.name);
  });
}

export function sortModsForDock(input: readonly ModHubMod[]): ModHubMod[] {
  return [...input].sort((a, b) => {
    const aScore = a.canOpenFromDock ? 2 : a.isInstalled ? 1 : 0;
    const bScore = b.canOpenFromDock ? 2 : b.isInstalled ? 1 : 0;
    if (aScore !== bScore) return bScore - aScore;
    return a.name.localeCompare(b.name);
  });
}

export function buildDockMods(input: readonly ModHubMod[]): ModHubMod[] {
  return sortModsForDock(input.filter((item) => item.isInstalled));
}

export function buildManagementSections(input: {
  mods: readonly ModHubMod[];
  query: string;
}): ModHubSection[] {
  const query = input.query.toLowerCase().trim();
  const visibleMods = (query
    ? input.mods.filter(
        (mod) =>
          mod.name.toLowerCase().includes(query)
          || mod.description.toLowerCase().includes(query)
          || mod.author.toLowerCase().includes(query)
          || String(mod.catalogPackageId || '').toLowerCase().includes(query),
      )
    : input.mods
  );
  const installed = sortModsForManagement(visibleMods.filter((mod) => mod.isInstalled));
  const available = sortModsForManagement(
    visibleMods.filter((mod) => !mod.isInstalled && mod.source === 'catalog'),
  );

  return [
    { key: 'installed', mods: installed },
    { key: 'available', mods: available },
  ];
}

export function describeConsentReason(reason: CatalogConsentReason): string {
  switch (reason) {
    case 'advisory-review':
      return 'Catalog advisory requires review';
    case 'capability-increase':
      return 'New capabilities were added';
    case 'community-package':
      return 'Community trust tier requires manual review';
    case 'trust-tier-downgrade':
      return 'Publisher trust tier was downgraded';
    default:
      return String(reason || '').trim();
  }
}

export function describeConsentReasons(reasons: readonly CatalogConsentReason[] | undefined): string[] {
  if (!Array.isArray(reasons)) return [];
  return reasons
    .map((item) => describeConsentReason(item))
    .filter(Boolean);
}
