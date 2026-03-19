// RL-FEAT-003 — Voice List
// Fetches available voices for the agent's voice model via bridge.media.tts.listVoices

import { useState, useCallback, useEffect } from 'react';
import { getBridge } from '../../../bridge/electron-bridge.js';
import { useAppStore } from '../../../app-shell/providers/app-store.js';

export interface Voice {
  voiceId: string;
  name: string;
}

export function useListVoices() {
  const currentAgent = useAppStore((s) => s.currentAgent);
  const runtimeAvailable = useAppStore((s) => s.runtimeAvailable);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchVoices = useCallback(async () => {
    if (!currentAgent?.voiceModel || !runtimeAvailable) {
      setVoices([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const bridge = getBridge();
      const result = await bridge.media.tts.listVoices({
        model: currentAgent.voiceModel,
      });
      setVoices(result.voices ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load voices');
      setVoices([]);
    } finally {
      setIsLoading(false);
    }
  }, [currentAgent?.voiceModel, runtimeAvailable]);

  // Refetch when agent changes (new voice model)
  useEffect(() => {
    fetchVoices();
  }, [fetchVoices]);

  return { voices, isLoading, error, refetch: fetchVoices };
}
