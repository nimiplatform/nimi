import type {
  CatalogConsentReason,
  CatalogPackageSummary,
  CatalogTrustTier,
  RuntimeLocalManifestSummary,
} from '@renderer/bridge';

export const MARKETPLACE_COLORS = {
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
export type MarketplaceModSource = 'runtime' | 'catalog';
export type MarketplaceRuntimeAction = 'install' | 'uninstall' | 'enable' | 'disable' | 'settings' | 'update';
export type MarketplacePendingActionType =
  | MarketplaceRuntimeAction
  | 'install-from-path'
  | 'install-from-url';

export type MarketplaceMod = {
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
  source: MarketplaceModSource;
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
  runtimeConflict?: boolean;
  isInstalled: boolean;
  isEnabled: boolean;
  publisherVerified?: boolean;
};

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

export function toRuntimeModRow(
  summary: RuntimeLocalManifestSummary,
  index: number,
  input: {
    isInstalled: boolean;
    isEnabled: boolean;
  },
): MarketplaceMod {
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

  return {
    id,
    name: displayName,
    description,
    author,
    badge: publisherVerified ? 'verified' : undefined,
    version: `v${String(version).replace(/^v/i, '')}`,
    iconBg: `linear-gradient(135deg, ${MARKETPLACE_COLORS.brand500}, ${MARKETPLACE_COLORS.blue600})`,
    iconText: String(displayName.slice(0, 2) || 'M').toUpperCase(),
    source: 'runtime',
    packageType: 'desktop-mod',
    catalogPackageId: id,
    runtimeStatus: input.isEnabled ? 'loaded' : 'disabled',
    runtimeSourceType: summary.sourceType,
    runtimeSourceDir: summary.sourceDir,
    runtimeConflict: false,
    isInstalled: input.isInstalled,
    isEnabled: input.isEnabled,
    publisherVerified,
    supportedByDesktop: true,
  };
}

function trustTierBadge(trustTier: CatalogTrustTier | string | undefined): BadgeType | undefined {
  if (trustTier === 'official') return 'official';
  if (trustTier === 'verified') return 'verified';
  if (trustTier === 'community') return 'community';
  return undefined;
}

export function toCatalogModRow(
  summary: CatalogPackageSummary,
  input: {
    isInstalled: boolean;
    isEnabled: boolean;
    installedVersion?: string;
    availableUpdateVersion?: string;
    advisoryCount?: number;
    requiresUserConsent?: boolean;
    consentReasons?: CatalogConsentReason[];
    addedCapabilities?: string[];
  },
): MarketplaceMod {
  const trustTier = summary.publisher.trustTier;
  const isSupported = summary.packageType === 'desktop-mod';
  const version = input.installedVersion || summary.latestVersion || '0.0.0';
  return {
    id: summary.packageId,
    name: summary.name,
    description: summary.description,
    author: summary.publisher.displayName,
    badge: trustTierBadge(trustTier),
    version: `v${String(version).replace(/^v/i, '')}`,
    iconBg: trustTier === 'official'
      ? `linear-gradient(135deg, ${MARKETPLACE_COLORS.brand600}, ${MARKETPLACE_COLORS.cyan700})`
      : trustTier === 'verified'
        ? `linear-gradient(135deg, ${MARKETPLACE_COLORS.blue600}, ${MARKETPLACE_COLORS.purple600})`
        : `linear-gradient(135deg, ${MARKETPLACE_COLORS.gray500}, ${MARKETPLACE_COLORS.gray700})`,
    iconText: String(summary.name.slice(0, 2) || summary.packageId.slice(0, 2) || 'M').toUpperCase(),
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
    isInstalled: input.isInstalled,
    isEnabled: input.isEnabled,
    publisherVerified: trustTier === 'official' || trustTier === 'verified',
  };
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
