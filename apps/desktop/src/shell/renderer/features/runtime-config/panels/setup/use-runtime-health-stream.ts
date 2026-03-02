import { useEffect, useRef, useState } from 'react';
import type { RuntimeHealthEvent, AIProviderHealthEvent } from '@nimiplatform/sdk/runtime';
import {
  subscribeRuntimeHealth,
  subscribeProviderHealth,
} from '../../domain/diagnostics/audit-sdk-service.js';

export function useRuntimeHealthStream(enabled: boolean): {
  latestHealth: RuntimeHealthEvent | null;
  latestProviderEvents: AIProviderHealthEvent[];
  streaming: boolean;
  streamError: string | null;
} {
  const [latestHealth, setLatestHealth] = useState<RuntimeHealthEvent | null>(null);
  const [latestProviderEvents, setLatestProviderEvents] = useState<AIProviderHealthEvent[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled) {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      setStreaming(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    setStreamError(null);

    let cancelled = false;

    async function consumeHealthStream() {
      try {
        const stream = await subscribeRuntimeHealth();
        for await (const event of stream) {
          if (cancelled) break;
          setLatestHealth(event);
        }
      } catch (err) {
        if (!cancelled) {
          setStreamError(err instanceof Error ? err.message : String(err));
          setStreaming(false);
        }
      }
    }

    async function consumeProviderStream() {
      try {
        const stream = await subscribeProviderHealth();
        for await (const event of stream) {
          if (cancelled) break;
          setLatestProviderEvents((prev) => {
            const existing = prev.findIndex((e) => e.providerName === event.providerName);
            if (existing >= 0) {
              const next = [...prev];
              next[existing] = event;
              return next;
            }
            return [...prev, event];
          });
        }
      } catch (err) {
        if (!cancelled) {
          setStreamError(err instanceof Error ? err.message : String(err));
          setStreaming(false);
        }
      }
    }

    void consumeHealthStream();
    void consumeProviderStream();

    return () => {
      cancelled = true;
      controller.abort();
      abortRef.current = null;
      setStreaming(false);
    };
  }, [enabled]);

  return { latestHealth, latestProviderEvents, streaming, streamError };
}
