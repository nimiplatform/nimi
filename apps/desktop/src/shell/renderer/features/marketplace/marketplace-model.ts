import type { RuntimeLocalManifestSummary } from '@renderer/bridge';

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

export type BadgeType = 'verified' | 'catalog';
export type MarketplaceModSource = 'runtime' | 'catalog';
export type MarketplaceRuntimeAction = 'install' | 'uninstall' | 'enable' | 'disable' | 'settings';
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
    runtimeStatus: input.isEnabled ? 'loaded' : 'disabled',
    runtimeSourceType: summary.sourceType,
    runtimeSourceDir: summary.sourceDir,
    runtimeConflict: false,
    isInstalled: input.isInstalled,
    isEnabled: input.isEnabled,
    publisherVerified,
  };
}
