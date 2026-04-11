import { describe, expect, it } from 'vitest';
import {
  findGrowthReportTypeConsistencyErrors,
  findRouteConsistencyErrors,
  findRouteTableConstraintErrors,
} from './check-parentos-spec-consistency.js';

describe('check-parentos-spec-consistency', () => {
  it('fails when the router exposes a route outside spec authority', () => {
    const errors = findRouteConsistencyErrors({
      routes: [
        { path: '/timeline', nav: true },
        { path: '/settings', nav: true },
      ],
      routerSource: '<Route path="/timeline" /><Route path="/settings" /><Route path="/reports" />',
      navSource: "const navItems = [{ to: '/timeline' }, { to: '/settings' }]",
      kernelIndexExists: true,
    });

    expect(errors).toContain('Route /reports is registered in routes.tsx but missing from routes.yaml');
  });

  it('fails when routes.yaml breaks its own parent-feature constraint', () => {
    const errors = findRouteTableConstraintErrors([
      { path: '/profile', feature: 'profile' },
      { path: '/settings/ai', parent: '/settings', feature: 'profile' },
      { path: '/settings', feature: 'settings', isDefault: true },
    ]);

    expect(errors).toContain(
      'Route /settings/ai feature profile does not match parent /settings feature settings',
    );
  });

  it('fails when growth_reports.reportType drifts across spec, TS, and Rust', () => {
    const errors = findGrowthReportTypeConsistencyErrors({
      storageTables: [
        {
          name: 'growth_reports',
          columns: [
            { name: 'reportType', description: 'monthly | quarterly | quarterly-letter | custom' },
          ],
        },
      ],
      structuredReportSource: "const GROWTH_REPORT_TYPES = ['monthly', 'quarterly-letter', 'custom'] as const;",
      rustGrowthReportSource: 'matches!(report_type, "monthly" | "quarterly" | "quarterly-letter" | "custom")',
    });

    expect(errors).toContain(
      'growth_reports.reportType mismatch between local-storage.yaml and structured-report.ts: spec=[custom, monthly, quarterly, quarterly-letter] ts=[custom, monthly, quarterly-letter]',
    );
  });
});
