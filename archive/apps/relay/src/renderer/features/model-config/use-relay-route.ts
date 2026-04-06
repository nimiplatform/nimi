// Hook for relay route selection — loads options, binding, snapshot via bridge

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getBridge } from '../../bridge/electron-bridge.js';
import type {
  RelayRouteBinding,
  RelayRouteOptions,
  ResolvedRelayRoute,
} from '../../../shared/ipc-contract.js';
import {
  buildRelayRouteBindingForModelChange,
  deriveRelayRouteDisplayState,
} from './relay-route-binding.js';

export type RelayRouteSource = RelayRouteBinding['source'];

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
        bridge.route.getOptions(),
        bridge.route.getBinding(),
        bridge.route.getSnapshot(),
      ]);
      if (!mountedRef.current) return;
      setOptions(opts);
      setBinding(bind);
      setSnapshot(snap);
      setLoading(false);
      retryIndexRef.current = RETRY_DELAYS.length; // stop retries
    } catch (err) {
      if (!mountedRef.current) return;
      // Retry with backoff
      const idx = retryIndexRef.current;
      if (idx < RETRY_DELAYS.length) {
        console.warn(`[relay:route] loadAll attempt ${idx + 1}/${RETRY_DELAYS.length} failed`, err);
        retryIndexRef.current = idx + 1;
        const delay = RETRY_DELAYS[idx]!;
        setTimeout(() => {
          if (mountedRef.current) void loadAll();
        }, delay);
      } else {
        console.error('[relay:route] loadAll retries exhausted', err);
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
        const refreshed = await bridge.route.refresh();
        if (!mountedRef.current) return;
        setOptions(refreshed);
        // Also refresh snapshot since options may have changed resolution
        const snap = await bridge.route.getSnapshot();
        if (mountedRef.current) setSnapshot(snap);
      } catch (err) {
        console.warn('[relay:route] polling refresh failed', err);
      }
    }, interval);
    return () => clearInterval(timer);
  }, [loading, options?.connectors.length]);

  const onSourceChange = useCallback(async (source: RelayRouteSource) => {
    const bridge = getBridge();
    const newBinding: RelayRouteBinding = { source };
    const resolved = await bridge.route.setBinding(newBinding);
    setBinding(newBinding);
    setSnapshot(resolved);
  }, []);

  const onConnectorChange = useCallback(async (connectorId: string) => {
    const bridge = getBridge();
    const newBinding: RelayRouteBinding = { source: 'cloud', connectorId };
    const resolved = await bridge.route.setBinding(newBinding);
    setBinding(newBinding);
    setSnapshot(resolved);
  }, []);

  const onModelChange = useCallback(async (model: string) => {
    const bridge = getBridge();
    const newBinding = buildRelayRouteBindingForModelChange(binding, snapshot, model, options);
    const resolved = await bridge.route.setBinding(newBinding);
    setBinding(newBinding);
    setSnapshot(resolved);
  }, [binding, options, snapshot]);

  const onReset = useCallback(async () => {
    const bridge = getBridge();
    const newBinding: RelayRouteBinding = { source: 'local' };
    const resolved = await bridge.route.setBinding(newBinding);
    setBinding(newBinding);
    setSnapshot(resolved);
  }, []);

  const display = useMemo(
    () => (options ? deriveRelayRouteDisplayState(binding, snapshot, options) : null),
    [binding, options, snapshot],
  );

  return {
    options,
    binding,
    snapshot,
    display,
    loading,
    onSourceChange,
    onConnectorChange,
    onModelChange,
    onReset,
  };
}
