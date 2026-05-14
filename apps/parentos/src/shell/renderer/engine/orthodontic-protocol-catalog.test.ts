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
  APPLIANCE_PHASES,
  defaultReviewIntervalDays,
} from '../features/profile/orthodontic-derive.js';
import type { OrthodonticApplianceType } from '../bridge/sqlite-bridge.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const YAML_PATH = resolve(__dirname, '../../../../spec/kernel/tables/orthodontic-protocols.yaml');

interface OrthoProtocolsYamlRule {
  ruleId: string;
  applianceTypes?: string[];
  defaultIntervalDays?: number;
}
interface OrthoProtocolsYamlPhase {
  phaseId: string;
  label: string;
  expectedMonths: number;
}
interface OrthoProtocolsYaml {
  rules: OrthoProtocolsYamlRule[];
  appliancePhases: Record<string, OrthoProtocolsYamlPhase[]>;
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
    // Metal braces are non-removable, so neither the legacy daily wear rules
    // (retired by PO-ORTHO-005b) nor the new wear-gap rule applies.
    expect(applicable).toContain('PO-ORTHO-REVIEW-FIXED');
    expect(applicable).not.toContain('PO-ORTHO-WEAR-DAILY');
    expect(applicable).not.toContain('PO-ORTHO-RETENTION-WEAR');
    expect(applicable).not.toContain('PO-ORTHO-UNWEAR-OPEN');
    expect(applicable).not.toContain('PO-ORTHO-ALIGNER-CHANGE');
    expect(applicable).not.toContain('PO-ORTHO-EXPANDER-ACTIVATION');
  });

  it('clear-aligner emits the wear-gap nudge, aligner-change, and review rules', () => {
    const applicable = rulesTargetingAppliance('clear-aligner').map((r) => r.ruleId);
    expect(applicable).toEqual(expect.arrayContaining([
      'PO-ORTHO-UNWEAR-OPEN',
      'PO-ORTHO-ALIGNER-CHANGE',
      'PO-ORTHO-REVIEW-ALIGNER',
    ]));
    // The legacy daily-wear rule was retired in v15 (PO-ORTHO-005b).
    expect(applicable).not.toContain('PO-ORTHO-WEAR-DAILY');
    expect(applicable).not.toContain('PO-ORTHO-EXPANDER-ACTIVATION');
  });

  it('expander emits activation and interceptive-review rules', () => {
    const applicable = rulesTargetingAppliance('expander').map((r) => r.ruleId);
    expect(applicable).toContain('PO-ORTHO-EXPANDER-ACTIVATION');
    expect(applicable).toContain('PO-ORTHO-REVIEW-INTERCEPTIVE');
    expect(applicable).not.toContain('PO-ORTHO-ALIGNER-CHANGE');
    // Expander is fixed in mouth — never a wear-gap candidate.
    expect(applicable).not.toContain('PO-ORTHO-UNWEAR-OPEN');
  });

  it('retention rules target removable and fixed retainers via wear-gap + review', () => {
    const removable = rulesTargetingAppliance('retainer-removable').map((r) => r.ruleId);
    // Removable retainers participate in the wear-gap stream, not the legacy
    // PO-ORTHO-RETENTION-WEAR daily rule (retired in v15).
    expect(removable).toContain('PO-ORTHO-UNWEAR-OPEN');
    expect(removable).toContain('PO-ORTHO-RETENTION-REVIEW');
    expect(removable).not.toContain('PO-ORTHO-RETENTION-WEAR');
    const fixed = rulesTargetingAppliance('retainer-fixed').map((r) => r.ruleId);
    expect(fixed).toContain('PO-ORTHO-RETENTION-REVIEW');
    expect(fixed).not.toContain('PO-ORTHO-UNWEAR-OPEN'); // not removable
    expect(fixed).not.toContain('PO-ORTHO-RETENTION-WEAR');
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

  /**
   * TS ↔ YAML drift guard for the per-appliance treatment-phase mirror in
   * orthodontic-derive.ts#APPLIANCE_PHASES (PO-ORTHO-013). The Rust mirror is
   * guarded separately by `protocol_catalog_drift_guard::appliance_phases_match_yaml`.
   */
  it('APPLIANCE_PHASES (TS) matches orthodontic-protocols.yaml#appliancePhases for every applianceType', () => {
    const yaml = loadProtocolsYaml();
    const admittedTypes: OrthodonticApplianceType[] = [
      'twin-block', 'expander', 'activator',
      'metal-braces', 'ceramic-braces', 'clear-aligner',
      'retainer-fixed', 'retainer-removable',
    ];
    // Every applianceType has a YAML sequence and a matching TS mirror, in order.
    for (const applianceType of admittedTypes) {
      const yamlPhases = yaml.appliancePhases[applianceType];
      expect(yamlPhases, `appliancePhases missing "${applianceType}"`).toBeDefined();
      const tsPhases = APPLIANCE_PHASES[applianceType];
      expect(tsPhases.map((p) => p.phaseId)).toEqual(yamlPhases!.map((p) => p.phaseId));
      expect(tsPhases.map((p) => p.label)).toEqual(yamlPhases!.map((p) => p.label));
      expect(tsPhases.map((p) => p.expectedMonths)).toEqual(
        yamlPhases!.map((p) => p.expectedMonths),
      );
    }
    // Reverse: the YAML must not declare a sequence for an unknown applianceType.
    for (const key of Object.keys(yaml.appliancePhases)) {
      expect(admittedTypes).toContain(key as OrthodonticApplianceType);
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
