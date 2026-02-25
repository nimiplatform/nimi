export type {
  AdapterFamily,
  AdapterCapability,
  AdapterFamilyDescriptor,
} from './adapter-family';
export {
  ADAPTER_FAMILY_REGISTRY,
  resolveAdapterFamily,
  resolveProviderType,
} from './adapter-family';

export type { CanonicalSpeechRequest } from './canonical-request';
export type { CanonicalSpeechResponse } from './canonical-response';

export type { ProviderCapabilityEntry } from './provider-capability-matrix';
export {
  PROVIDER_CAPABILITY_MATRIX,
  supportsCapability,
} from './provider-capability-matrix';
