import type { ConversationCapabilityRouteRuntime } from './conversation-capability.js';

let runtime: ConversationCapabilityRouteRuntime | null = null;

export function setProductionConversationCapabilityRouteRuntime(
  next: ConversationCapabilityRouteRuntime | null,
): void {
  runtime = next;
}

export function getProductionConversationCapabilityRouteRuntime(): ConversationCapabilityRouteRuntime | null {
  return runtime;
}
