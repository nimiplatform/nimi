import React, { useEffect, useRef, useState } from 'react';
import type { NimiLocalAppAgentHandle, NimiLocalAppConversationClient } from '@nimiplatform/kit/core/sdk-contract';
import { Button } from '@nimiplatform/kit/ui';

// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-061
/** Cancels the named media tail; it never substitutes a newer text turn. */
export function LocalAppConversationMediaStopButton(props: {
  agentHandle: string;
  conversationAnchorId: string;
  turnId: string;
  conversation: () => NimiLocalAppConversationClient;
  label: string;
  errorLabel: string;
  onError?: (error: unknown) => void;
}) {
  const key = JSON.stringify([props.agentHandle, props.conversationAnchorId, props.turnId]);
  const currentKey = useRef<string | null>(key);
  currentKey.current = key;
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    currentKey.current = key;
    busyRef.current = false;
    setBusy(false);
    setFailed(false);
    return () => { currentKey.current = null; };
  }, [key]);
  const stop = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFailed(false);
    try {
      await props.conversation().interruptTurn({
        agentHandle: props.agentHandle as NimiLocalAppAgentHandle,
        conversationAnchorId: props.conversationAnchorId,
        expectedTurnId: props.turnId,
      });
      // The owner event/snapshot removes the control. A receipt is not a new UI terminal.
    } catch (error) {
      if (currentKey.current === key) {
        setFailed(true);
        props.onError?.(error);
      }
    } finally {
      if (currentKey.current === key) { busyRef.current = false; setBusy(false); }
    }
  };
  return <div className="mt-2 text-xs">
    <Button tone="ghost" size="sm" disabled={busy} onClick={() => { void stop(); }}>{props.label}</Button>
    {failed ? <p role="status">{props.errorLabel}</p> : null}
  </div>;
}
