import YAML from 'yaml';

export interface NimiDoctorLedgerClaim {
  readonly capability: string;
  readonly support: string;
  readonly mode?: string;
}

export class NimiDoctorLedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NimiDoctorLedgerError';
  }
}

export function loadAdapterCapabilityLedger(yamlText: string): ReadonlyMap<string, readonly NimiDoctorLedgerClaim[]> {
  const raw = YAML.parse(yamlText) as Record<string, unknown> | null;
  const adapters = (raw?.entries ?? raw?.surfaces) as unknown;
  if (!Array.isArray(adapters) || adapters.length === 0) {
    throw new NimiDoctorLedgerError('adapter capability ledger declares no adapter entries');
  }
  const claimsByAdapter = new Map<string, readonly NimiDoctorLedgerClaim[]>();
  for (const adapter of adapters as Record<string, unknown>[]) {
    const id = adapter.id;
    if (typeof id !== 'string' || id.trim() === '') {
      throw new NimiDoctorLedgerError('adapter ledger entry is missing id');
    }
    const rawClaims = adapter.capability_claims;
    if (!Array.isArray(rawClaims)) {
      throw new NimiDoctorLedgerError(`adapter ${id}: capability_claims must be a list`);
    }
    claimsByAdapter.set(
      id,
      rawClaims.map((claim) => parseClaim(id, claim as Record<string, unknown>)),
    );
  }
  return claimsByAdapter;
}

function parseClaim(adapterId: string, raw: Record<string, unknown>): NimiDoctorLedgerClaim {
  const capability = raw.capability;
  const support = raw.support;
  if (typeof capability !== 'string' || capability.trim() === '') {
    throw new NimiDoctorLedgerError(`adapter ${adapterId}: claim is missing capability`);
  }
  if (typeof support !== 'string' || support.trim() === '') {
    throw new NimiDoctorLedgerError(`adapter ${adapterId}: claim ${capability} is missing support`);
  }
  return {
    capability,
    support,
    mode: typeof raw.mode === 'string' ? raw.mode : undefined,
  };
}
