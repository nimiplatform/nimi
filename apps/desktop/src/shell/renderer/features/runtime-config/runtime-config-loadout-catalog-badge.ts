export type RuntimeConfigLoadoutCatalogVerification = 'matched' | 'not_matched' | 'unknown';

export type RuntimeConfigLoadoutCatalogBadge = {
  readonly label: 'catalog_verified' | 'catalog_not_matched' | 'catalog_verification_unknown';
  readonly tone: 'success' | 'warning' | 'neutral';
};

export function runtimeConfigLoadoutCatalogBadge(
  verification: RuntimeConfigLoadoutCatalogVerification | null | undefined,
): RuntimeConfigLoadoutCatalogBadge {
  switch (verification) {
    case 'matched':
      return Object.freeze({ label: 'catalog_verified', tone: 'success' });
    case 'not_matched':
      return Object.freeze({ label: 'catalog_not_matched', tone: 'warning' });
    default:
      return Object.freeze({ label: 'catalog_verification_unknown', tone: 'neutral' });
  }
}
