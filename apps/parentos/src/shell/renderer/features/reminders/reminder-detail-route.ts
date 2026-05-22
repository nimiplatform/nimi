/**
 * Domain → dedicated detail route resolution for reminder primary actions.
 *
 * `actionType` decides the primary button copy (PO-REMI-002); the route target
 * is the domain's own detail surface from `routes.yaml`. Domains without a
 * dedicated detail surface fall back to the profile console.
 */

const DOMAIN_DETAIL_ROUTE: Record<string, string> = {
  vaccine: '/profile/vaccines',
  checkup: '/profile/medical-events',
  vision: '/profile/vision',
  dental: '/profile/dental',
  growth: '/profile/growth',
  posture: '/profile/posture',
  sleep: '/profile/sleep',
  tanner: '/profile/tanner',
  fitness: '/profile/fitness',
  outdoor: '/profile/outdoor',
};

export function domainDetailRoute(domain: string): string {
  return DOMAIN_DETAIL_ROUTE[domain] ?? '/profile';
}
