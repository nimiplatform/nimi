// Hook for relay route selection — loads options, binding, snapshot via bridge

import { useState, useEffect, useCallback, useRef } from 'react';
import { getBridge } from '../../bridge/electron-bridge.js';

export type RelayRouteSource = 'local' | 'cloud';

export type RelayLocalModelOption = {
  localModelId: string;
  modelId: string;
  engine: string;
  status: 'active' | 'installed' | 'unhealthy' | 'removed' | 'unspecified';
  capabilities: string[];
};

export type RelayConnectorModelOption = {
  modelId: string;
  modelLabel: string;
  available: boolean;
  capabilities: string[];
};

export type RelayConnectorOption = {
  connectorId: string;
  provider: string;
  label: string;
  status: string;
  models: RelayConnectorModelOption[];
};

export type RelayRouteOptions = {
  local: { models: RelayLocalModelOption[] };
  connectors: RelayConnectorOption[];
  selected: RelayRouteBinding | null;
};

export type RelayRouteBinding = {
  source: RelayRouteSource;
  model?: string;
  connectorId?: string;
  localModelId?: string;
};

export type ResolvedRelayRoute = {
  source: RelayRouteSource;
  model: string;
  connectorId?: string;
  localModelId?: string;
  provider?: string;
};

const POLL_INTERVAL_WITH_CONNECTORS = 30_000;
const POLL_INTERVAL_WITHOUT_CONNECTORS = 60_000;
const RETRY_DELAYS = [0, 200, 500, 1000];

export function useRelayRoute() {
  const [options, setOptions] = useState<RelayRouteOptions | null>(null);
  const [binding, setBinding] = useState<RelayRouteBinding | null>(null);
  const [snapshot, setSnapshot] = useState<ResolvedRelayRoute | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);
  const retryIndexRef = useRef(0);

  const loadAll = useCallback(async () => {
    const bridge = getBridge();
    try {
      const [opts, bind, snap] = await Promise.all([
        bridge.route.getOptions() as Promise<RelayRouteOptions>,
        bridge.route.getBinding() as Promise<RelayRouteBinding | null>,
        bridge.route.getSnapshot() as Promise<ResolvedRelayRoute | null>,
      ]);
      if (!mountedRef.current) return;
      setOptions(opts);
      setBinding(bind);
      setSnapshot(snap);
      setLoading(false);
      retryIndexRef.current = RETRY_DELAYS.length; // stop retries
    } catch {
      if (!mountedRef.current) return;
      // Retry with backoff
      const idx = retryIndexRef.current;
      if (idx < RETRY_DELAYS.length) {
        retryIndexRef.current = idx + 1;
        const delay = RETRY_DELAYS[idx]!;
        setTimeout(() => {
          if (mountedRef.current) void loadAll();
        }, delay);
      } else {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadAll();
    return () => {
      mountedRef.current = false;
    };
  }, [loadAll]);

  // Polling
  useEffect(() => {
    if (loading) return;
    const hasConnectors = (options?.connectors.length ?? 0) > 0;
    const interval = hasConnectors ? POLL_INTERVAL_WITH_CONNECTORS : POLL_INTERVAL_WITHOUT_CONNECTORS;
    const timer = setInterval(async () => {
      if (!mountedRef.current) return;
      try {
        const bridge = getBridge();
        const refreshed = await bridge.route.refresh() as RelayRouteOptions;
        if (!mountedRef.current) return;
        setOptions(refreshed);
        // Also refresh snapshot since options may have changed resolution
        const snap = await bridge.route.getSnapshot() as ResolvedRelayRoute | null;
        if (mountedRef.current) setSnapshot(snap);
      } catch {
        // Silently ignore polling errors
      }
    }, interval);
    return () => clearInterval(timer);
  }, [loading, options?.connectors.length]);

  const onSourceChange = useCallback(async (source: RelayRouteSource) => {
    const bridge = getBridge();
    const newBinding: RelayRouteBinding = { source };
    const resolved = await bridge.route.setBinding(newBinding) as ResolvedRelayRoute | null;
    setBinding(newBinding);
    setSnapshot(resolved);
  }, []);

  const onConnectorChange = useCallback(async (connectorId: string) => {
    const bridge = getBridge();
    const newBinding: RelayRouteBinding = { source: 'cloud', connectorId };
    const resolved = await bridge.route.setBinding(newBinding) as ResolvedRelayRoute | null;
    setBinding(newBinding);
    setSnapshot(resolved);
  }, []);

  const onModelChange = useCallback(async (model: string) => {
    const bridge = getBridge();
    const source = binding?.source ?? 'local';
    const newBinding: RelayRouteBinding = {
      source,
      model,
      connectorId: source === 'cloud' ? binding?.connectorId : undefined,
      localModelId: source === 'local' ? model : undefined,
    };
    const resolved = await bridge.route.setBinding(newBinding) as ResolvedRelayRoute | null;
    setBinding(newBinding);
    setSnapshot(resolved);
  }, [binding]);

  const onReset = useCallback(async () => {
    const bridge = getBridge();
    const newBinding: RelayRouteBinding = { source: 'local' };
    const resolved = await bridge.route.setBinding(newBinding) as ResolvedRelayRoute | null;
    setBinding(newBinding);
    setSnapshot(resolved);
  }, []);

  return {
    options,
    binding,
    snapshot,
    loading,
    onSourceChange,
    onConnectorChange,
    onModelChange,
    onReset,
  };
}
