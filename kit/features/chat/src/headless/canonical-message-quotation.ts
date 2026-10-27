import type { ConversationCanonicalMessage } from '../types.js';

// @nimi-authority: rule.nimi.runtime.conversation-message-interaction.quote-input
export function canQuoteCanonicalMessage(message: ConversationCanonicalMessage): boolean {
  if ((message.kind || 'text') !== 'text' || !message.text.trim() || message.metadata?.canonicalMessageCommitted !== true) return false;
  if (message.status === 'pending' || message.status === 'streaming') return false;
  if (message.metadata.canonicalPartial === true) return ['completed', 'failed', 'interrupted'].includes(String(message.metadata.canonicalTurnStatus));
  return true;
}
