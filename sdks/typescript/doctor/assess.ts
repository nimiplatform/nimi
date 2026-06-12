import type { NimiDoctorLedgerClaim } from './ledger';
import type { NimiDoctorFramework } from './map';
import type {
  NimiDoctorDynamicImport,
  NimiDoctorScanHit,
  NimiDoctorScanLocation,
  NimiDoctorUnboundCall,
  NimiDoctorUnknownApi,
} from './scanner';

export interface NimiDoctorCapabilityFinding {
  readonly capability: string;
  readonly support: string;
  readonly mode?: string;
  readonly apis: readonly string[];
  readonly locations: readonly NimiDoctorScanLocation[];
  readonly heuristic: boolean;
}

export interface NimiDoctorUnresolvedConditional {
  readonly api: string;
  readonly capability: string;
  readonly when: string;
  readonly location: NimiDoctorScanLocation;
}

export interface NimiDoctorFrameworkAssessment {
  readonly frameworkId: string;
  readonly upstreamPackage: string;
  readonly apiHitCount: number;
  readonly supported: readonly NimiDoctorCapabilityFinding[];
  readonly partial: readonly NimiDoctorCapabilityFinding[];
  readonly unsupported: readonly NimiDoctorCapabilityFinding[];
  readonly notApplicable: readonly NimiDoctorCapabilityFinding[];
  readonly unknownApis: readonly NimiDoctorUnknownApi[];
  readonly unboundCalls: readonly NimiDoctorUnboundCall[];
  readonly unresolvedConditional: readonly NimiDoctorUnresolvedConditional[];
  readonly dynamicImports: readonly NimiDoctorDynamicImport[];
}

export interface NimiDoctorAssessment {
  readonly frameworks: readonly NimiDoctorFrameworkAssessment[];
  readonly pendingFrameworks: readonly { readonly frameworkId: string; readonly upstreamPackage: string }[];
  readonly configErrors: readonly string[];
  readonly totals: {
    readonly supported: number;
    readonly partial: number;
    readonly unsupported: number;
    readonly unknownApis: number;
    readonly unboundCalls: number;
    readonly unresolvedConditional: number;
  };
}

export class NimiDoctorAssessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NimiDoctorAssessError';
  }
}

export function assess(input: {
  readonly frameworks: readonly NimiDoctorFramework[];
  readonly ledger: ReadonlyMap<string, readonly NimiDoctorLedgerClaim[]>;
  readonly hits: readonly NimiDoctorScanHit[];
  readonly unknownApis: readonly NimiDoctorUnknownApi[];
  readonly unboundCalls?: readonly NimiDoctorUnboundCall[];
  readonly dynamicImports?: readonly NimiDoctorDynamicImport[];
  readonly detectedPendingFrameworks: readonly string[];
}): NimiDoctorAssessment {
  const configErrors = validateMapAgainstLedger(input.frameworks, input.ledger);
  const unboundCalls = input.unboundCalls ?? [];
  const dynamicImports = input.dynamicImports ?? [];

  const frameworkAssessments: NimiDoctorFrameworkAssessment[] = [];
  for (const framework of input.frameworks) {
    if (framework.status !== 'mapped') {
      continue;
    }
    const frameworkHits = input.hits.filter((hit) => hit.frameworkId === framework.id);
    const frameworkUnknowns = input.unknownApis.filter((unknown) => unknown.frameworkId === framework.id);
    const frameworkUnbound = unboundCalls.filter((call) => call.frameworkId === framework.id);
    const frameworkDynamic = dynamicImports.filter((dyn) => dyn.frameworkId === framework.id);
    if (frameworkHits.length === 0 && frameworkUnknowns.length === 0 && frameworkUnbound.length === 0 && frameworkDynamic.length === 0) {
      continue;
    }
    frameworkAssessments.push(
      assessFramework(framework, input.ledger.get(framework.id) ?? [], frameworkHits, frameworkUnknowns, frameworkUnbound, frameworkDynamic),
    );
  }

  const pendingFrameworks = input.frameworks
    .filter((framework) => input.detectedPendingFrameworks.includes(framework.id))
    .map((framework) => ({ frameworkId: framework.id, upstreamPackage: framework.upstreamPackage }));

  const totals = frameworkAssessments.reduce(
    (acc, framework) => ({
      supported: acc.supported + framework.supported.length,
      partial: acc.partial + framework.partial.length,
      unsupported: acc.unsupported + framework.unsupported.length,
      unknownApis: acc.unknownApis + framework.unknownApis.length,
      unboundCalls: acc.unboundCalls + framework.unboundCalls.length,
      unresolvedConditional: acc.unresolvedConditional + framework.unresolvedConditional.length,
    }),
    { supported: 0, partial: 0, unsupported: 0, unknownApis: 0, unboundCalls: 0, unresolvedConditional: 0 },
  );

  return { frameworks: frameworkAssessments, pendingFrameworks, configErrors, totals };
}

function assessFramework(
  framework: NimiDoctorFramework,
  claims: readonly NimiDoctorLedgerClaim[],
  hits: readonly NimiDoctorScanHit[],
  unknownApis: readonly NimiDoctorUnknownApi[],
  unboundCalls: readonly NimiDoctorUnboundCall[],
  dynamicImports: readonly NimiDoctorDynamicImport[],
): NimiDoctorFrameworkAssessment {
  const claimsByCapability = new Map(claims.map((claim) => [claim.capability, claim]));
  const entriesByApi = new Map(framework.apiEntries.map((entry) => [entry.api, entry]));

  interface Accumulator {
    readonly claim: NimiDoctorLedgerClaim;
    readonly apis: Set<string>;
    readonly locations: NimiDoctorScanLocation[];
    heuristic: boolean;
  }
  const findings = new Map<string, Accumulator>();
  const unresolvedConditional: NimiDoctorUnresolvedConditional[] = [];

  for (const hit of hits) {
    const entry = entriesByApi.get(hit.api);
    if (!entry) {
      throw new NimiDoctorAssessError(`hit references api ${hit.api} that is absent from framework ${framework.id} map`);
    }
    for (const binding of entry.capabilities) {
      if (binding.when) {
        const activated = evaluateWhen(binding.when, hit);
        if (activated === 'inactive') {
          continue;
        }
        if (activated === 'unresolvable') {
          unresolvedConditional.push({
            api: hit.api,
            capability: binding.capability,
            when: binding.when,
            location: hit.location,
          });
          continue;
        }
      }
      const claim = claimsByCapability.get(binding.capability);
      if (!claim) {
        // Surfaced through configErrors during map validation; skip here.
        continue;
      }
      const existing = findings.get(binding.capability);
      if (existing) {
        existing.apis.add(hit.api);
        existing.locations.push(hit.location);
        existing.heuristic = existing.heuristic && hit.heuristic;
      } else {
        findings.set(binding.capability, {
          claim,
          apis: new Set([hit.api]),
          locations: [hit.location],
          heuristic: hit.heuristic,
        });
      }
    }
  }

  const buckets: Record<'supported' | 'partial' | 'unsupported' | 'not-applicable', NimiDoctorCapabilityFinding[]> = {
    supported: [],
    partial: [],
    unsupported: [],
    'not-applicable': [],
  };
  for (const [capability, accumulator] of findings) {
    const finding: NimiDoctorCapabilityFinding = {
      capability,
      support: accumulator.claim.support,
      mode: accumulator.claim.mode,
      apis: [...accumulator.apis].sort(),
      locations: accumulator.locations,
      heuristic: accumulator.heuristic,
    };
    const bucket = buckets[finding.support as keyof typeof buckets];
    if (!bucket) {
      throw new NimiDoctorAssessError(
        `ledger support value ${finding.support} for ${framework.id}/${capability} is not an admitted support level`,
      );
    }
    bucket.push(finding);
  }

  const byCapability = (a: NimiDoctorCapabilityFinding, b: NimiDoctorCapabilityFinding) => a.capability.localeCompare(b.capability);
  return {
    frameworkId: framework.id,
    upstreamPackage: framework.upstreamPackage,
    apiHitCount: hits.length,
    supported: buckets.supported.sort(byCapability),
    partial: buckets.partial.sort(byCapability),
    unsupported: buckets.unsupported.sort(byCapability),
    notApplicable: buckets['not-applicable'].sort(byCapability),
    unknownApis,
    unboundCalls,
    unresolvedConditional,
    dynamicImports,
  };
}

// 'active': the condition is met by observed option keys.
// 'inactive': options were fully resolved and the condition is provably unmet.
// 'unresolvable': options could not be fully resolved, so an unmet condition
// cannot be disproven — the binding must surface as uncertainty, not vanish.
function evaluateWhen(when: string, hit: NimiDoctorScanHit): 'active' | 'inactive' | 'unresolvable' {
  if (when.startsWith('option-function:')) {
    const key = when.slice('option-function:'.length);
    if (hit.optionFunctionKeys.includes(key)) {
      return 'active';
    }
    return hit.optionsResolved ? 'inactive' : 'unresolvable';
  }
  const key = when.slice('option:'.length);
  if (hit.optionKeys.includes(key)) {
    return 'active';
  }
  return hit.optionsResolved ? 'inactive' : 'unresolvable';
}

export function validateMapAgainstLedger(
  frameworks: readonly NimiDoctorFramework[],
  ledger: ReadonlyMap<string, readonly NimiDoctorLedgerClaim[]>,
): readonly string[] {
  const errors: string[] = [];
  for (const framework of frameworks) {
    if (framework.status !== 'mapped') {
      continue;
    }
    const claims = ledger.get(framework.id);
    if (!claims) {
      errors.push(`framework ${framework.id} has no adapter entry in the capability ledger`);
      continue;
    }
    const claimed = new Set(claims.map((claim) => claim.capability));
    for (const entry of framework.apiEntries) {
      for (const binding of entry.capabilities) {
        if (!claimed.has(binding.capability)) {
          errors.push(
            `framework ${framework.id} api ${entry.api}: capability ${binding.capability} is not a ledger capability_claim`,
          );
        }
      }
    }
  }
  return errors;
}
