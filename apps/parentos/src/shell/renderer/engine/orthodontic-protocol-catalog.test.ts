/**
 * Scenario tests for the compiled orthodontic protocol catalog.
 *
 * Confirms the product-level rules in the Phase 5 checklist are
 * surface-observable: fixed braces, clear aligners, expander, retention each
 * emit the correct set of admitted reminder ruleIds after the Phase 4
 * compilation step.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { REMINDER_RULES } from '../knowledge-base/index.js';
import {
  defaultReviewIntervalDays,
} from '../features/profile/orthodontic-tab-forms.js';
import type { OrthodonticApplianceType } from '../bridge/sqlite-bridge.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const YAML_PATH = resolve(__dirname, '../../../../spec/kernel/tables/orthodontic-protocols.yaml');

interface OrthoProtocolsYamlRule {
  ruleId: string;
  applianceTypes?: string[];
  defaultIntervalDays?: number;
}
interface OrthoProtocolsYaml {
  rules: OrthoProtocolsYamlRule[];
}

function loadProtocolsYaml(): OrthoProtocolsYaml {
  const raw = readFileSync(YAML_PATH, 'utf-8');
  return parseYaml(raw) as OrthoProtocolsYaml;
}

function rulesTargetingAppliance(applianceType: string) {
  return REMINDER_RULES.filter((rule) =>
    rule.ruleId.startsWith('PO-ORTHO-') &&
    (rule.tags ?? []).includes(`appliance:${applianceType}`),
  );
}

describe('orthodontic protocol catalog coverage', () => {
  it('fixed metal-braces only produces the review/adjustment protocol rule', () => {
    const applicable = rulesTargetingAppliance('metal-braces').map((r) => r.ruleId);
    // Metal braces should match PO-ORTHO-REVIEW-FIXED (adjustments) and nothing daily.
    expect(applicable).toContain('PO-ORTHO-REVIEW-FIXED');
    expect(applicable).not.toContain('PO-ORTHO-WEAR-DAILY');
    expect(applicable).not.toContain('PO-ORTHO-ALIGNER-CHANGE');
    expect(applicable).not.toContain('PO-ORTHO-EXPANDER-ACTIVATION');
  });

  it('clear-aligner emits daily wear, aligner-change, and review rules', () => {
    const applicable = rulesTargetingAppliance('clear-aligner').map((r) => r.ruleId);
    expect(applicable).toEqual(expect.arrayContaining([
      'PO-ORTHO-WEAR-DAILY',
      'PO-ORTHO-ALIGNER-CHANGE',
      'PO-ORTHO-REVIEW-ALIGNER',
    ]));
    expect(applicable).not.toContain('PO-ORTHO-EXPANDER-ACTIVATION');
  });

  it('expander emits activation and interceptive-review rules', () => {
    const applicable = rulesTargetingAppliance('expander').map((r) => r.ruleId);
    expect(applicable).toContain('PO-ORTHO-EXPANDER-ACTIVATION');
    expect(applicable).toContain('PO-ORTHO-REVIEW-INTERCEPTIVE');
    expect(applicable).not.toContain('PO-ORTHO-ALIGNER-CHANGE');
  });

  it('retention rules target removable and fixed retainers', () => {
    const removable = rulesTargetingAppliance('retainer-removable').map((r) => r.ruleId);
    expect(removable).toContain('PO-ORTHO-RETENTION-WEAR');
    expect(removable).toContain('PO-ORTHO-RETENTION-REVIEW');
    const fixed = rulesTargetingAppliance('retainer-fixed').map((r) => r.ruleId);
    expect(fixed).toContain('PO-ORTHO-RETENTION-REVIEW');
    expect(fixed).not.toContain('PO-ORTHO-RETENTION-WEAR'); // nothing daily to wear
  });

  it('dental follow-up rules exist for each admitted dental eventType', () => {
    const followupIds = REMINDER_RULES
      .filter((r) => r.ruleId.startsWith('PO-DEN-FOLLOWUP-'))
      .map((r) => r.ruleId);
    expect(followupIds).toEqual(expect.arrayContaining([
      'PO-DEN-FOLLOWUP-CLEANING',
      'PO-DEN-FOLLOWUP-FLUORIDE',
      'PO-DEN-FOLLOWUP-SEALANT',
      'PO-DEN-FOLLOWUP-FILLING',
      'PO-DEN-FOLLOWUP-CHECKUP',
    ]));
  });

  /**
   * TS ↔ YAML drift guard for the review-interval mirror in
   * orthodontic-tab-forms.tsx#defaultReviewIntervalDays. The Rust mirror is
   * guarded separately by the cargo test `protocol_catalog_drift_guard`;
   * this test covers the frontend side against the same YAML authority so
   * any unilateral drift on TS trips here, not silently at runtime.
   */
  it('defaultReviewIntervalDays (TS) matches orthodontic-protocols.yaml for every applianceType', () => {
    const yaml = loadProtocolsYaml();
    const reviewRuleIds = new Set([
      'PO-ORTHO-REVIEW-ALIGNER',
      'PO-ORTHO-REVIEW-FIXED',
      'PO-ORTHO-REVIEW-INTERCEPTIVE',
      'PO-ORTHO-RETENTION-REVIEW',
    ]);

    // Flatten YAML: applianceType → defaultIntervalDays from whichever review
    // rule lists it in applianceTypes. One-to-one mapping is enforced by the
    // Rust drift guard; this test asserts the TS helper agrees with that
    // mapping's intervalDays for every applianceType the YAML admits.
    const expectedByAppliance = new Map<string, number>();
    for (const rule of yaml.rules) {
      if (!reviewRuleIds.has(rule.ruleId)) continue;
      if (rule.defaultIntervalDays === undefined) continue;
      for (const applianceType of rule.applianceTypes ?? []) {
        expectedByAppliance.set(applianceType, rule.defaultIntervalDays);
      }
    }
    expect(expectedByAppliance.size).toBeGreaterThan(0);

    for (const [applianceType, expectedDays] of expectedByAppliance) {
      const tsDays = defaultReviewIntervalDays(applianceType as OrthodonticApplianceType);
      expect(tsDays).toBe(expectedDays);
    }

    // Reverse: every applianceType the TS helper returns a value for must be
    // admitted by the YAML and produce the same number.
    const admittedTypes: OrthodonticApplianceType[] = [
      'twin-block', 'expander', 'activator',
      'metal-braces', 'ceramic-braces', 'clear-aligner',
      'retainer-fixed', 'retainer-removable',
    ];
    for (const applianceType of admittedTypes) {
      const tsDays = defaultReviewIntervalDays(applianceType);
      const yamlDays = expectedByAppliance.get(applianceType);
      expect(tsDays).toBe(yamlDays);
    }
  });

  it('no runtime-synthesized ruleIds remain in the compiled catalog', () => {
    const synthetic = REMINDER_RULES.filter((r) =>
      r.ruleId.startsWith('dental-auto-') ||
      r.ruleId.startsWith('ortho-dyn-') ||
      /\d{4}-\d{2}-\d{2}/.test(r.ruleId),
    );
    expect(synthetic).toHaveLength(0);
  });
});
