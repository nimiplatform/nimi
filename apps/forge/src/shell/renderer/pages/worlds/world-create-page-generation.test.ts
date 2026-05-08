import { describe, expect, it } from 'vitest';
import {
  assertOfficialFactoryQualityGateAdmitted,
  type ForgeOfficialFactoryQualityGate,
} from './world-create-page-generation.js';

describe('assertOfficialFactoryQualityGateAdmitted', () => {
  it('admits pass and warning quality gates', () => {
    expect(() => assertOfficialFactoryQualityGateAdmitted({ status: 'PASS', findingCount: 0 })).not.toThrow();
    expect(() => assertOfficialFactoryQualityGateAdmitted({ status: 'WARN', findingCount: 1 })).not.toThrow();
  });

  it('blocks fail and bypassed quality gates before publish mutation', () => {
    for (const qualityGate of [
      { status: 'FAIL', findingCount: 1 },
      { status: 'BYPASSED' },
    ] satisfies ForgeOfficialFactoryQualityGate[]) {
      expect(() => assertOfficialFactoryQualityGateAdmitted(qualityGate))
        .toThrow(`FORGE_OFFICIAL_PUBLISH_QUALITY_GATE_NOT_ADMITTED:${qualityGate.status}`);
    }
  });
});
