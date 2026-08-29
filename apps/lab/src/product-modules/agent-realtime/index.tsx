import { useMemo } from 'react';
import type { NimiLocalAppClient } from '@nimiplatform/sdk/app';
import {
  AgentRealtimeEntry,
  createBrowserAgentRealtimeHostMediaPort,
} from '@nimiplatform/kit/features/agent-realtime';

const INPUT_AUDIO = Object.freeze({
  codec: 'pcm-s16le' as const,
  sampleRateHz: 24_000,
  channelCount: 1 as const,
  frameDurationMs: 20,
  maximumFrameBytes: 960,
});

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-017
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-019c
export function AgentRealtimeCapability(props: { readonly client: NimiLocalAppClient }) {
  const host = useMemo(() => createBrowserAgentRealtimeHostMediaPort(), []);
  return (
    <AgentRealtimeEntry
      client={props.client}
      inputAudio={INPUT_AUDIO}
      turnDetection="server-vad"
      host={host}
      locale={globalThis.document?.documentElement.lang || 'en'}
    />
  );
}
