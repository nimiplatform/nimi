import { anyCapabilityMatches } from '@runtime/hook/contracts/capabilities';

export function assertRuntimeModCapabilitiesDeclared(input: {
  baselineCapabilities: string[];
  manifestCapabilities: string[];
}) {
  if (input.manifestCapabilities.length === 0) {
    return;
  }

  const unauthorized = input.baselineCapabilities.filter(
    (capability) => !anyCapabilityMatches(input.manifestCapabilities, capability),
  );
  if (unauthorized.length > 0) {
    throw new Error(`RUNTIME_MOD_CAPABILITY_NOT_DECLARED: ${unauthorized.join(',')}`);
  }
}
