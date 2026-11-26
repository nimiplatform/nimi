import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Globe, Laptop } from 'lucide-react';
import { AnimatePresence, motion, nimiOverlayPanelMotion, useNimiReducedMotion } from '@nimiplatform/kit/ui';
import {
  nimiRuntimeConfigConnectorVendorLabel,
  providerToNimiRuntimeConnectorVendor,
} from '@nimiplatform/sdk/runtime';
import {
  LOCAL_MODEL_CATALOG,
  PROVIDER_CAPABILITIES,
  type LocalCapabilityModel,
} from '../landing/generated/index.js';
import type { LandingLocale } from '../landing/i18n/locale.js';
import type { CapabilityId } from './platform-capability-samples.js';

export type CloudCapabilityService = {
  provider: string;
  label: string;
};

export type CapabilityRouteDetails = {
  localModels: readonly LocalCapabilityModel[];
  cloudServices: readonly CloudCapabilityService[];
};

export function getCapabilityRouteDetails(capability: CapabilityId): CapabilityRouteDetails {
  const localModels = LOCAL_MODEL_CATALOG[capability] ?? [];
  const cloudServices = PROVIDER_CAPABILITIES
    .filter((entry) => (
      entry.runtimePlane === 'remote'
      && (entry.capabilities as readonly string[]).includes(capability)
    ))
    .map((entry) => ({
      provider: entry.provider,
      label: nimiRuntimeConfigConnectorVendorLabel(
        providerToNimiRuntimeConnectorVendor(entry.provider),
      ),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return { localModels, cloudServices };
}

const ROUTE_COPY = {
  zh: {
    localPill: '本地模型',
    remotePill: '云端服务',
    localHeading: '可用本地模型',
    remoteHeading: '可用云端服务',
    localHint: '在 Nimi Home 中按需下载并在本机运行',
    remoteHint: '在 Nimi Home 接入密钥后可随时选用',
    localEmpty: '当前能力仅支持云端实时流服务，暂未提供本地模型。',
    remoteEmpty: '当前能力仅在本机运行，暂无需云端服务。',
    byoTag: '自备权重',
  },
  en: {
    localPillSingular: 'Local model',
    localPillPlural: 'Local models',
    remotePillSingular: 'Cloud service',
    remotePillPlural: 'Cloud services',
    localHeading: 'Available local models',
    remoteHeading: 'Available cloud services',
    localHint: 'Download on demand and run locally in Nimi Home',
    remoteHint: 'Connect your API key in Nimi Home to use on demand',
    localEmpty: 'Currently available via cloud live stream services only.',
    remoteEmpty: 'Currently runs locally on your device with no cloud service required.',
    byoTag: 'BYO weights',
  },
} as const;

type RoutePopoverKind = 'local' | 'remote';

export function PlatformCapabilityRouteCounts({
  capability,
  locale,
  initialOpen = null,
}: {
  capability: CapabilityId;
  locale: LandingLocale;
  initialOpen?: RoutePopoverKind | null;
}) {
  const [openKind, setOpenKind] = useState<RoutePopoverKind | null>(initialOpen);
  const [pinnedKind, setPinnedKind] = useState<RoutePopoverKind | null>(initialOpen);
  const rootRef = useRef<HTMLDivElement>(null);
  const localTriggerRef = useRef<HTMLButtonElement>(null);
  const remoteTriggerRef = useRef<HTMLButtonElement>(null);
  const hoverCloseTimerRef = useRef<number | null>(null);
  const suppressNextFocusOpenRef = useRef<RoutePopoverKind | null>(null);
  const localPopoverId = useId();
  const remotePopoverId = useId();
  const reducedMotion = useNimiReducedMotion();
  const popoverMotion = nimiOverlayPanelMotion({
    kind: 'popover',
    side: 'bottom',
    align: 'end',
    reducedMotion,
  });

  const clearHoverCloseTimer = () => {
    if (hoverCloseTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  };

  useEffect(() => clearHoverCloseTimer, []);

  const { localModels, cloudServices } = useMemo(
    () => getCapabilityRouteDetails(capability),
    [capability],
  );

  useEffect(() => {
    setOpenKind(initialOpen);
    setPinnedKind(initialOpen);
  }, [capability, initialOpen]);

  useEffect(() => {
    if (!openKind) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        clearHoverCloseTimer();
        setOpenKind(null);
        setPinnedKind(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        clearHoverCloseTimer();
        const closingKind = openKind;
        suppressNextFocusOpenRef.current = closingKind;
        setOpenKind(null);
        setPinnedKind(null);
        const trigger = closingKind === 'local' ? localTriggerRef.current : remoteTriggerRef.current;
        trigger?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openKind]);

  const copy = ROUTE_COPY[locale];
  const localLabel = locale === 'zh'
    ? ROUTE_COPY.zh.localPill
    : (localModels.length === 1 ? ROUTE_COPY.en.localPillSingular : ROUTE_COPY.en.localPillPlural);
  const remoteLabel = locale === 'zh'
    ? ROUTE_COPY.zh.remotePill
    : (cloudServices.length === 1 ? ROUTE_COPY.en.remotePillSingular : ROUTE_COPY.en.remotePillPlural);

  const handleMouseEnter = (kind: RoutePopoverKind) => {
    clearHoverCloseTimer();
    setOpenKind(kind);
  };

  const handleMouseLeave = (kind: RoutePopoverKind) => {
    clearHoverCloseTimer();
    if (typeof window === 'undefined') {
      setOpenKind((current) => (pinnedKind === kind ? kind : current === kind ? null : current));
      return;
    }
    hoverCloseTimerRef.current = window.setTimeout(() => {
      hoverCloseTimerRef.current = null;
      setOpenKind((current) => (pinnedKind === kind ? kind : current === kind ? null : current));
    }, 100);
  };

  const handleFocusOpen = (kind: RoutePopoverKind) => {
    if (suppressNextFocusOpenRef.current === kind) {
      suppressNextFocusOpenRef.current = null;
      return;
    }
    clearHoverCloseTimer();
    setOpenKind(kind);
  };

  const handleTriggerClick = (kind: RoutePopoverKind) => {
    clearHoverCloseTimer();
    suppressNextFocusOpenRef.current = null;
    if (pinnedKind === kind) {
      setPinnedKind(null);
      setOpenKind(null);
    } else {
      setPinnedKind(kind);
      setOpenKind(kind);
    }
  };

  const isLocalOpen = openKind === 'local';
  const isRemoteOpen = openKind === 'remote';

  return (
    <div className="public-capability-route-counts" ref={rootRef}>
      <div
        className={`public-capability-route-pill${isLocalOpen ? ' is-open' : ''}${localModels.length === 0 ? ' is-empty' : ''}`}
        data-route-kind="local"
        onMouseEnter={() => handleMouseEnter('local')}
        onMouseLeave={() => handleMouseLeave('local')}
        onFocus={() => handleFocusOpen('local')}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            clearHoverCloseTimer();
            setOpenKind((current) => (current === 'local' ? null : current));
            setPinnedKind((current) => (current === 'local' ? null : current));
          }
        }}
      >
        <button
          ref={localTriggerRef}
          type="button"
          className="public-capability-route-trigger"
          aria-expanded={isLocalOpen}
          aria-controls={localPopoverId}
          onClick={() => handleTriggerClick('local')}
        >
          <Laptop size={13} aria-hidden="true" />
          <strong>{localModels.length}</strong>
          <span>{localLabel}</span>
        </button>

        <AnimatePresence>
          {isLocalOpen && (
            <motion.div
              className="public-capability-route-popover-bridge"
              {...popoverMotion}
              style={{ ...popoverMotion.style, transformOrigin: 'top right' }}
            >
              <div
                id={localPopoverId}
                className={`public-capability-route-popover${localModels.length >= 7 ? ' is-wide' : ''}`}
                role="region"
                aria-label={copy.localHeading}
              >
                <div className="public-capability-route-popover-head">
                  <div>
                    <strong>{copy.localHeading}</strong>
                    <p>{copy.localHint}</p>
                  </div>
                  <span className="public-capability-route-popover-count">{localModels.length}</span>
                </div>
                {localModels.length > 0 ? (
                  <ul className={`public-capability-route-popover-list${localModels.length >= 7 ? ' is-two-col' : ''}`}>
                    {localModels.map((model) => (
                      <li key={model.id}>
                        <span>{model.label}</span>
                        {model.byo && (
                          <em className="public-capability-route-byo-tag">{copy.byoTag}</em>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="public-capability-route-popover-empty">{copy.localEmpty}</p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div
        className={`public-capability-route-pill${isRemoteOpen ? ' is-open' : ''}${cloudServices.length === 0 ? ' is-empty' : ''}`}
        data-route-kind="remote"
        onMouseEnter={() => handleMouseEnter('remote')}
        onMouseLeave={() => handleMouseLeave('remote')}
        onFocus={() => handleFocusOpen('remote')}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            clearHoverCloseTimer();
            setOpenKind((current) => (current === 'remote' ? null : current));
            setPinnedKind((current) => (current === 'remote' ? null : current));
          }
        }}
      >
        <button
          ref={remoteTriggerRef}
          type="button"
          className="public-capability-route-trigger"
          aria-expanded={isRemoteOpen}
          aria-controls={remotePopoverId}
          onClick={() => handleTriggerClick('remote')}
        >
          <Globe size={13} aria-hidden="true" />
          <strong>{cloudServices.length}</strong>
          <span>{remoteLabel}</span>
        </button>

        <AnimatePresence>
          {isRemoteOpen && (
            <motion.div
              className="public-capability-route-popover-bridge"
              {...popoverMotion}
              style={{ ...popoverMotion.style, transformOrigin: 'top right' }}
            >
              <div
                id={remotePopoverId}
                className={`public-capability-route-popover${cloudServices.length >= 9 ? ' is-wide' : ''}`}
                role="region"
                aria-label={copy.remoteHeading}
              >
                <div className="public-capability-route-popover-head">
                  <div>
                    <strong>{copy.remoteHeading}</strong>
                    <p>{copy.remoteHint}</p>
                  </div>
                  <span className="public-capability-route-popover-count">{cloudServices.length}</span>
                </div>
                {cloudServices.length > 0 ? (
                  <ul className="public-capability-route-popover-chips">
                    {cloudServices.map((service) => (
                      <li key={service.provider}>{service.label}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="public-capability-route-popover-empty">{copy.remoteEmpty}</p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
