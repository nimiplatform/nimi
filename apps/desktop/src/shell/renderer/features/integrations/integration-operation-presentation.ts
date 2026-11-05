import type { NimiIntegrationOperation } from '@nimiplatform/sdk/app';
import { Eye, ImageDown, Inbox, PencilLine, Reply, Send, Zap, type LucideIcon } from 'lucide-react';

// @nimi-authority: rule.nimi.runtime.integration.description
export function integrationOperationDisplayName(
  operation: Pick<NimiIntegrationOperation, 'name' | 'displayName'>,
): string {
  if (operation.displayName) return operation.displayName;
  const words = operation.name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._\s/-]+/g, ' ')
    .trim();
  return words.replace(/(^|\s)\S/g, letter => letter.toUpperCase()) || operation.name;
}

// Display copy only, selected by exact declared IDs. Runtime descriptors still
// own availability, effects and admission. Dynamic operations use source copy.
export function integrationOperationPresentation(
  kind: string,
  operation: NimiIntegrationOperation,
  translate: (key: string) => string,
) {
  const action = operation.name.startsWith(`${kind}.`) ? operation.name.slice(kind.length + 1) : '';
  const actions: Record<string, string> = kind === 'telegram'
    ? { sendMessage: 'send', 'updates.read': 'receive' }
    : {
        'messages.send': 'send',
        'messages.reply': 'reply',
        'messages.update': 'update',
        'updates.read': 'receive',
        'media.fetch': 'media',
      };
  const key = actions[action];
  if (!['telegram', 'weixin', 'feishu', 'qq-official', 'onebot-v11'].includes(kind)
    || !key || (key === 'update' && kind !== 'feishu')) {
    return { name: integrationOperationDisplayName(operation), summary: operation.description };
  }
  const summary = kind === 'telegram'
    ? `${key}_telegram`
    : key === 'send' && (kind === 'weixin' || kind === 'qq-official')
      ? `${key}_${kind === 'weixin' ? 'weixin' : 'qq'}`
      : key;
  return {
    name: translate(`Integrations.operationNames.${key}`),
    summary: translate(`Integrations.operationSummaries.${summary}`),
  };
}

// Visual affordance only; operation identity and admission stay with the
// Runtime descriptor. Unknown app-provided operations fall back by effect.
export function integrationOperationIcon(kind:string, operation:NimiIntegrationOperation):LucideIcon {
  if (kind === 'telegram' && operation.name === 'telegram.sendMessage') return Send;
  const action=operation.name.startsWith(`${kind}.`)?operation.name.slice(kind.length+1):'';
  switch(action){
    case 'messages.send':return Send;
    case 'messages.reply':return Reply;
    case 'messages.update':return PencilLine;
    case 'updates.read':return Inbox;
    case 'media.fetch':return ImageDown;
    default:return operation.effect==='write'?Zap:Eye;
  }
}
