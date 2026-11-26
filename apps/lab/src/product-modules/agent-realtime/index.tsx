import { useEffect, useMemo, useState } from 'react';
import type { NimiLocalAppClient } from '@nimiplatform/sdk/app';
import {
  AgentRealtimeEntry,
  createBrowserAgentRealtimeHostMediaPort,
} from '@nimiplatform/kit/features/agent-realtime';

const INPUT_AUDIO = Object.freeze({
  codec: 'pcm-s16le' as const,
  sampleRateHz: 16_000,
  channelCount: 1 as const,
  frameDurationMs: 20,
  maximumFrameBytes: 640,
});

function useDocumentLocale(explicit?: string): string {
  const [docLang, setDocLang] = useState(() => globalThis.document?.documentElement.lang || 'en');
  useEffect(() => {
    if (explicit) return undefined;
    const root = globalThis.document?.documentElement;
    if (!root || typeof MutationObserver === 'undefined') return undefined;
    const sync = () => setDocLang(root.lang || 'en');
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['lang'] });
    return () => observer.disconnect();
  }, [explicit]);
  return explicit || docLang;
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-017
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-019c
export function AgentRealtimeCapability(props: { readonly client: NimiLocalAppClient; readonly locale?: string }) {
  const locale = useDocumentLocale(props.locale);
  const host = useMemo(() => createBrowserAgentRealtimeHostMediaPort(), []);
  return (
    <AgentRealtimeEntry
      client={props.client}
      inputAudio={INPUT_AUDIO}
      turnDetection="server-vad"
      host={host}
      locale={locale}
    />
  );
}
