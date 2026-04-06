// RL-FEAT-003 — Voice List
// Fetches available voices for the agent's voice model via bridge.media.tts.listVoices

import { useState, useCallback, useEffect } from 'react';
import { getBridge } from '../../../bridge/electron-bridge.js';

export interface Voice {
  voiceId: string;
  name: string;
}

export type VoiceListRequest = {
  connectorId?: string;
  model?: string;
  runtimeAvailable: boolean;
};

function normalizeText(value: string | undefined): string {
  return String(value || '').trim();
}

export function buildListVoicesInput(input: VoiceListRequest): { model: string; connectorId?: string } | null {
  const model = normalizeText(input.model);
  const connectorId = normalizeText(input.connectorId);
  if (!input.runtimeAvailable || !model || !connectorId) {
    return null;
  }
  return {
    model,
    connectorId,
  };
}

export function useListVoices(input: VoiceListRequest) {
  const connectorId = normalizeText(input.connectorId);
  const model = normalizeText(input.model);
  const runtimeAvailable = input.runtimeAvailable;
  const [voices, setVoices] = useState<Voice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchVoices = useCallback(async () => {
    const request = buildListVoicesInput({ connectorId, model, runtimeAvailable });
    if (!request) {
      setVoices([]);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const bridge = getBridge();
      const result = await bridge.media.tts.listVoices(request);
      setVoices(result.voices ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load voices');
      setVoices([]);
    } finally {
      setIsLoading(false);
    }
  }, [connectorId, model, runtimeAvailable]);

  // Refetch when the configured Settings TTS route changes.
  useEffect(() => {
    fetchVoices();
  }, [fetchVoices]);

  return { voices, isLoading, error, refetch: fetchVoices };
}
