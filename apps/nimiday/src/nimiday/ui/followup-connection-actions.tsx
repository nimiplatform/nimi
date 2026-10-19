import { useEffect, useRef, useState } from 'react';
import { Button, InlineAlert } from '@nimiplatform/kit/ui';
import { openDesktopIntent } from '@nimiplatform/kit/shell/renderer/bridge';
import { useNimiDay } from '../app/context.js';

export function FollowUpConnectionActions({ account, agent, refresh, refreshing = false }: {
  account: boolean;
  agent: boolean;
  refresh?: () => Promise<void>;
  refreshing?: boolean;
}) {
  const { copy } = useNimiDay();
  const [error, setError] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const open = async (integrations: boolean) => {
    setError(false);
    try {
      const result = await openDesktopIntent({ intent: integrations ? { kind: 'open-integrations' } : { kind: 'open-apps', appId: 'nimi.day' } });
      if (alive.current) setError(result.status !== 'accepted');
    } catch { if (alive.current) setError(true); }
  };
  return <div className="nd-followup-connection-actions">
    <div className="nd-inline-actions">
      {account && <Button type="button" tone="ghost" size="sm" onClick={() => { void open(true); }}>{copy.followups.connectTelegram}</Button>}
      {agent && <Button type="button" tone="ghost" size="sm" onClick={() => { void open(false); }}>{copy.followups.manageAgentAccess}</Button>}
      {refresh && <Button type="button" tone="ghost" size="sm" loading={refreshing} onClick={() => { void refresh(); }}>{copy.followups.refreshConnections}</Button>}
    </div>
    {error && <InlineAlert tone="warning">{copy.agent.openHomeFailed}</InlineAlert>}
  </div>;
}
