import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { NimiAppActivityChange, NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';
import { invokeChecked } from '../../bridge/runtime-bridge/invoke.js';
import { isConversationReply } from '../home/home-app-activity-model.js';
import { resolvePartnerForHandle } from '../agents/partner-directory-model.js';
import { isPrimaryReply } from '../chat/chat-agent-canonical-conversation-projection.js';
import { CLOSE_PARTNER_CHAT_NOTICE, SHOW_PARTNER_CHAT_NOTICE } from '../../../shared/human-chat-notice.js';

// @nimi-authority: rule.nimi.desktop.product-surfaces.partner-chat-notice
export function useSystemEntryPartnerNotices(input: {
  sdk: DesktopRendererSdkPort; accountId: string; scope: string | null; contactsScope: string;
  generation: string | null; isCurrent: () => boolean;
}) {
  const queries = useQueryClient();
  const scope = useRef<{ key: string | null; arrivals: Set<string>; unread: Set<string> }>({ key: null, arrivals: new Set(), unread: new Set() });
  if (scope.current.key !== input.scope) scope.current = { key: input.scope, arrivals: new Set(), unread: new Set() };
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return (change: NimiAppActivityChange) => {
    const state = scope.current;
    if (!input.scope || !input.generation || !input.isCurrent()) return;
    const generation = input.generation;
    const homeWasFocused = globalThis.document?.hasFocus();
    const activityId = change.kind === 'upsert' ? change.record.activityId : change.activityId;
    const current = () => mounted.current && scope.current === state && state.key === input.scope && input.isCurrent();
    const close = () => invokeChecked(CLOSE_PARTNER_CHAT_NOTICE, { payload: { generation, activityId } }, value => value);
    if (change.kind === 'remove' || !change.record.userView.unread) {
      if (state.unread.delete(activityId)) void close().catch(() => undefined);
      return;
    }
    const record = change.record;
    if (!isConversationReply(record) || !record.agent || !record.key.startsWith('turn:') || state.arrivals.has(activityId)) return;
    state.arrivals.add(activityId);
    state.unread.add(activityId);
    const turnId = record.key.slice('turn:'.length);
    const activityAgentRef = record.agent.agentRef;
    void (async () => {
      const reference = (await input.sdk.appProduct().agents.listReferences()).find(value => value.activityAgentRef === activityAgentRef);
      if (!current() || !reference) return;
      const identityKey = ['home-contact-activity-partner', input.contactsScope, activityAgentRef];
      const { partner } = await queries.fetchQuery({ queryKey: identityKey, staleTime: 30_000,
        queryFn: () => resolvePartnerForHandle(input.sdk, input.accountId, reference.agentHandle) });
      if (!current()) return;
      if (!state.unread.has(activityId) || homeWasFocused || globalThis.document?.hasFocus()) return;
      let messageId: string | undefined;
      try {
        const conversation = input.sdk.conversation();
        const agentHandle: NimiLocalAppAgentHandle = reference.agentHandle;
        const { conversationAnchorId } = await conversation.open({ agentHandle });
        if (!current() || !state.unread.has(activityId)) return;
        const snapshot = await conversation.snapshot({ agentHandle, conversationAnchorId });
        const matches = snapshot.messages.filter(message => message.turnId === turnId && isPrimaryReply(message));
        if (matches.length === 1) messageId = matches[0]?.messageId;
      } catch { /* The live window may not expose the exact message yet. Preserve its turn target. */ }
      if (!current() || !state.unread.has(activityId)) return;
      await invokeChecked(SHOW_PARTNER_CHAT_NOTICE, { payload: { generation, activityId, localAgentRef: partner.localAgentRef,
        turnId, sender: reference.displayName, ...(messageId ? { messageId } : {}) } }, value => value);
      if (current() && !state.unread.has(activityId)) await close();
    })().catch(() => undefined);
  };
}
