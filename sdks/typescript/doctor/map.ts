import YAML from 'yaml';

export type NimiDoctorDetection =
  | { readonly kind: 'import-call'; readonly package: string; readonly symbol: string }
  | { readonly kind: 'constructor'; readonly package: string; readonly symbol: string }
  | { readonly kind: 'member-call'; readonly package: string; readonly constructor: string; readonly member: string }
  | { readonly kind: 'member-chain'; readonly package: string; readonly constructor: string; readonly chain: string }
  | { readonly kind: 'member-name'; readonly package: string; readonly member: string };

export interface NimiDoctorCapabilityBinding {
  readonly capability: string;
  readonly when?: string;
}

export interface NimiDoctorApiEntry {
  readonly api: string;
  readonly detection: NimiDoctorDetection;
  readonly capabilities: readonly NimiDoctorCapabilityBinding[];
  readonly note?: string;
}

export type NimiDoctorFrameworkStatus = 'mapped' | 'pending-upstream-binding';

export interface NimiDoctorFramework {
  readonly id: string;
  readonly upstreamPackage: string;
  readonly status: NimiDoctorFrameworkStatus;
  readonly apiEntries: readonly NimiDoctorApiEntry[];
}

const DETECTION_KINDS = new Set(['import-call', 'constructor', 'member-call', 'member-chain', 'member-name']);
const FRAMEWORK_STATUSES = new Set<NimiDoctorFrameworkStatus>(['mapped', 'pending-upstream-binding']);
const WHEN_PATTERN = /^option(?:-function)?:[A-Za-z_][A-Za-z0-9_]*$/;

export class NimiDoctorMapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NimiDoctorMapError';
  }
}

export function loadFrameworkApiCapabilityMap(yamlText: string): readonly NimiDoctorFramework[] {
  const raw = YAML.parse(yamlText) as Record<string, unknown> | null;
  if (!raw || !Array.isArray(raw.frameworks) || raw.frameworks.length === 0) {
    throw new NimiDoctorMapError('framework-api-capability-map declares no frameworks');
  }
  return raw.frameworks.map((framework) => parseFramework(framework as Record<string, unknown>));
}

function parseFramework(raw: Record<string, unknown>): NimiDoctorFramework {
  const id = requireString(raw.id, 'framework id');
  const upstreamPackage = requireString(raw.upstream_package, `framework ${id} upstream_package`);
  const status = requireString(raw.status, `framework ${id} status`) as NimiDoctorFrameworkStatus;
  if (!FRAMEWORK_STATUSES.has(status)) {
    throw new NimiDoctorMapError(`framework ${id}: status ${status} is not an admitted framework status`);
  }
  const rawEntries = raw.api_entries;
  if (!Array.isArray(rawEntries)) {
    throw new NimiDoctorMapError(`framework ${id}: api_entries must be a list`);
  }
  if (status === 'mapped' && rawEntries.length === 0) {
    throw new NimiDoctorMapError(`framework ${id}: a mapped framework must declare at least one api entry`);
  }
  if (status === 'pending-upstream-binding' && rawEntries.length > 0) {
    throw new NimiDoctorMapError(`framework ${id}: a pending framework must not declare api entries`);
  }
  return {
    id,
    upstreamPackage,
    status,
    apiEntries: rawEntries.map((entry) => parseApiEntry(id, entry as Record<string, unknown>)),
  };
}

function parseApiEntry(frameworkId: string, raw: Record<string, unknown>): NimiDoctorApiEntry {
  const api = requireString(raw.api, `framework ${frameworkId} api entry name`);
  const detection = parseDetection(frameworkId, api, raw.detection as Record<string, unknown> | undefined);
  const rawCapabilities = raw.capabilities;
  if (!Array.isArray(rawCapabilities)) {
    throw new NimiDoctorMapError(`framework ${frameworkId} api ${api}: capabilities must be a list`);
  }
  const capabilities = rawCapabilities.map((binding) => parseCapabilityBinding(frameworkId, api, binding as Record<string, unknown>));
  return {
    api,
    detection,
    capabilities,
    note: typeof raw.note === 'string' ? raw.note : undefined,
  };
}

function parseDetection(frameworkId: string, api: string, raw: Record<string, unknown> | undefined): NimiDoctorDetection {
  if (!raw || typeof raw !== 'object') {
    throw new NimiDoctorMapError(`framework ${frameworkId} api ${api}: detection is required`);
  }
  const kind = requireString(raw.kind, `framework ${frameworkId} api ${api} detection kind`);
  if (!DETECTION_KINDS.has(kind)) {
    throw new NimiDoctorMapError(`framework ${frameworkId} api ${api}: detection kind ${kind} is not admitted`);
  }
  const pkg = requireString(raw.package, `framework ${frameworkId} api ${api} detection package`);
  switch (kind) {
    case 'import-call':
    case 'constructor':
      return { kind, package: pkg, symbol: requireString(raw.symbol, `framework ${frameworkId} api ${api} detection symbol`) };
    case 'member-call':
      return {
        kind,
        package: pkg,
        constructor: requireString(raw.constructor, `framework ${frameworkId} api ${api} detection constructor`),
        member: requireString(raw.member, `framework ${frameworkId} api ${api} detection member`),
      };
    case 'member-chain':
      return {
        kind,
        package: pkg,
        constructor: requireString(raw.constructor, `framework ${frameworkId} api ${api} detection constructor`),
        chain: requireString(raw.chain, `framework ${frameworkId} api ${api} detection chain`),
      };
    case 'member-name':
      return { kind, package: pkg, member: requireString(raw.member, `framework ${frameworkId} api ${api} detection member`) };
    default:
      throw new NimiDoctorMapError(`framework ${frameworkId} api ${api}: unreachable detection kind`);
  }
}

function parseCapabilityBinding(frameworkId: string, api: string, raw: Record<string, unknown>): NimiDoctorCapabilityBinding {
  const capability = requireString(raw.capability, `framework ${frameworkId} api ${api} capability`);
  const when = raw.when;
  if (when !== undefined) {
    if (typeof when !== 'string' || !WHEN_PATTERN.test(when)) {
      throw new NimiDoctorMapError(`framework ${frameworkId} api ${api}: when condition ${String(when)} is not an admitted condition form`);
    }
  }
  return { capability, when: when as string | undefined };
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new NimiDoctorMapError(`${label} must be a non-empty string`);
  }
  return value;
}
