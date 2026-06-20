import type { CanonicalCapabilitySectionId } from '@nimiplatform/kit/core/runtime-capabilities';
import { CAPABILITY_TO_SECTION } from '../tester-capability-sections.js';
import type { TesterCapabilityId } from '../tester-capabilities.js';

export function resolveSectionAITestingConfigSection({
  open,
  capabilityId,
}: {
  open: boolean;
  capabilityId: TesterCapabilityId;
}): CanonicalCapabilitySectionId | null {
  if (!open) return null;
  return CAPABILITY_TO_SECTION[capabilityId];
}
