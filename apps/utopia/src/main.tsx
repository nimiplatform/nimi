import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { openNimiAppAssetMediaUrl } from '@nimiplatform/kit/core/app-asset-media';
import {
  createNimiLocalAppStandardShellSurface,
  installNimiShellRuntimeBridge,
} from '@nimiplatform/kit/shell/renderer/bridge';
import {
  Button,
  EmptyState,
  InlineAlert,
  NimiThemeProvider,
  NimiToaster,
  TooltipProvider,
  useNimiReducedMotion,
} from '@nimiplatform/kit/ui';
import { NimiAppChrome } from '@nimiplatform/kit/ui/app-chrome';
import { createNimiClient } from '@nimiplatform/sdk';
import type {
  NimiUtopiaResident,
  NimiUtopiaSnapshot,
  NimiUtopiaUpdateIntent,
} from '@nimiplatform/sdk/app';
import appPackage from '../package.json';
import { loadAgentReferenceDirectory } from './domain/agent-profiles.js';
import {
  openHomePartnerManagementFromUtopia,
  openHomePartnersFromUtopia,
  openPartnerConversationInZhiyuFromUtopia,
} from './domain/desktop-open.js';
import {
  BUILTIN_PACK_SLUGS,
  cleanupOrphanedBundleAssets,
  loadBuiltinPackFromFetch,
  readImportedPacksIndex,
  resolvePackMediaUrls,
  type InstalledUtopiaPack,
  type ResolvedStageMedia,
  type UtopiaStoragePort,
} from './domain/bundle-registry.js';
import {
  loadPersistedChibiWardrobe,
  patchPersistedChibiWardrobeEntry,
  resolveChibiAppearance,
  resolveWardrobeStorageKey,
  type ChibiAppearance,
  type ChibiWardrobeMap,
} from './domain/chibi-wardrobe.js';
import {
  computeVisitJournalHighlights,
  evalDaypartInTimezone,
  evalStageCondition,
  readLocalVisitCursor,
  saveLocalVisitCursor,
  type VisitCursor,
} from './domain/visit-journal.js';
import { HorizonTopBar, type UtopiaDrawerTab } from './panels/HorizonTopBar.js';
import { JournalAndSharedTab } from './panels/JournalAndSharedTab.js';
import {
  ResidentDetailAndDraft,
  createZeroSideEffectDraftState,
  type ChibiAppearanceUpdater,
  type LocalChatDraftState,
} from './panels/ResidentDetailAndDraft.js';
import { AmbientAudioController, readSavedAudioVolume } from './stage/AmbientAudioController.js';
import { UtopiaStageViewport } from './stage/UtopiaStageViewport.js';
import './styles.css';

const LazyDeterministicTunerPanel = React.lazy(() =>
  import('./panels/DeterministicTunerPanel.js').then((m) => ({ default: m.DeterministicTunerPanel })),
);
const LazyRelocationAndPackDrawer = React.lazy(() =>
  import('./panels/RelocationAndPackDrawer.js').then((m) => ({ default: m.RelocationAndPackDrawer })),
);

installNimiShellRuntimeBridge();

const client = createNimiClient({
  localApp: { standardShell: createNimiLocalAppStandardShellSurface() },
});

function isSessionUnboundStorageError(failure: unknown): boolean {
  const code = failure && typeof failure === 'object' && 'reasonCode' in failure
    ? String((failure as { reasonCode?: unknown }).reasonCode ?? '').toLowerCase().replaceAll('_', '-')
    : '';
  const msg = failure instanceof Error ? failure.message.toLowerCase() : '';
  return /account-changed|session-invalid|access-denied|runtime-unauthenticated|revoked|unbound|not-connected/u.test(
    `${code} ${msg}`,
  );
}

function UtopiaApp() {
  const reducedMotion = useNimiReducedMotion();

  const [snapshot, setSnapshot] = useState<NimiUtopiaSnapshot | null>(null);
  const [avatarsByHandle, setAvatarsByHandle] = useState<Readonly<Record<string, string | null>>>({});
  const [bindingsByHandle, setBindingsByHandle] = useState<Readonly<Record<string, string>>>({});
  const [chibiWardrobe, setChibiWardrobe] = useState<ChibiWardrobeMap>({});
  const [wardrobeReady, setWardrobeReady] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [actionAlert, setActionAlert] = useState<{ tone: 'warning' | 'danger' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [packs, setPacks] = useState<readonly InstalledUtopiaPack[]>([]);
  const [packIndexError, setPackIndexError] = useState<string | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Readonly<Record<string, string>>>({});
  const [stageMedia, setStageMedia] = useState<ResolvedStageMedia | null>(null);
  const [transitioning, setTransitioning] = useState(false);

  // Full-bleed living world by default (`activeDrawerTab === null`); floating parchment sheet opens on demand
  const [activeDrawerTab, setActiveDrawerTab] = useState<UtopiaDrawerTab | null>(null);
  const lastDrawerTabRef = useRef<UtopiaDrawerTab>('journal');
  const [hudHidden, setHudHidden] = useState(false);

  const [packDrawerOpen, setPackDrawerOpen] = useState(false);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [draftState, setDraftState] = useState<LocalChatDraftState | null>(null);
  const [audioMuted, setAudioMuted] = useState(true);
  const [audioVolume, setAudioVolume] = useState<number>(() => readSavedAudioVolume());

  const [initialVisitCursor] = useState<VisitCursor | null>(() => readLocalVisitCursor());
  const audioControllerRef = useRef<AmbientAudioController | null>(null);
  if (!audioControllerRef.current) {
    audioControllerRef.current = new AmbientAudioController();
  }

  const openDrawerTab = useCallback((tab: UtopiaDrawerTab) => {
    lastDrawerTabRef.current = tab;
    setHudHidden(false);
    setActiveDrawerTab(tab);
  }, []);

  const toggleDrawerTab = useCallback((tab: UtopiaDrawerTab) => {
    setHudHidden(false);
    setActiveDrawerTab((cur) => {
      if (cur === tab) return null;
      lastDrawerTabRef.current = tab;
      return tab;
    });
  }, []);

  // Escape exits pure-canvas mode, closes place note card, or closes floating drawer
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || packDrawerOpen) return;
      if (hudHidden) {
        setHudHidden(false);
      } else if (selectedPlaceId) {
        setSelectedPlaceId(null);
      } else if (activeDrawerTab !== null) {
        setActiveDrawerTab(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hudHidden, selectedPlaceId, activeDrawerTab, packDrawerOpen]);

  const storagePort = useMemo<UtopiaStoragePort>(() => ({
    json: client.storage,
    assets: client.storage.assets,
  }), []);

  const hasBoundSession = snapshot !== null;
  const hasBoundSessionRef = useRef(hasBoundSession);
  hasBoundSessionRef.current = hasBoundSession;
  const bindingsByHandleRef = useRef(bindingsByHandle);
  bindingsByHandleRef.current = bindingsByHandle;
  const chibiWardrobeRef = useRef(chibiWardrobe);
  chibiWardrobeRef.current = chibiWardrobe;
  const wardrobeReadyRef = useRef(wardrobeReady);
  wardrobeReadyRef.current = wardrobeReady;

  const refreshPacks = useCallback(async () => {
    const builtins = await Promise.all(
      BUILTIN_PACK_SLUGS.map((slug) => loadBuiltinPackFromFetch(slug)),
    );
    let imported: readonly InstalledUtopiaPack[] = [];
    try {
      imported = await readImportedPacksIndex(storagePort);
      setPackIndexError(null);
    } catch (err) {
      if (!hasBoundSessionRef.current && isSessionUnboundStorageError(err)) {
        setPackIndexError(null);
      } else {
        setPackIndexError(err instanceof Error ? err.message : '无法读取本地已导入的洞天包索引');
      }
    }
    setPacks([...builtins, ...imported]);
  }, [storagePort]);

  useEffect(() => {
    void cleanupOrphanedBundleAssets(storagePort).catch(() => undefined);
    void refreshPacks().catch(() => undefined);
  }, [refreshPacks, storagePort]);

  useEffect(() => {
    if (!hasBoundSession) return;
    void cleanupOrphanedBundleAssets(storagePort).catch(() => undefined);
    void refreshPacks().catch(() => undefined);
  }, [hasBoundSession, refreshPacks, storagePort]);

  // Resolve cover preview URLs for pack library cards (keyed by contentDigest + fallback bundleId)
  useEffect(() => {
    const controller = new AbortController();
    const revokers: (() => Promise<void>)[] = [];
    void (async () => {
      const nextUrls: Record<string, string> = {};
      for (const pack of packs) {
        if (pack.source === 'builtin' && pack.slug) {
          const url = `./builtin-packs/${pack.slug}/${pack.manifest.previewAsset}`;
          nextUrls[pack.contentDigest] = url;
          nextUrls[pack.manifest.bundleId] ??= url;
        } else {
          try {
            const opened = await openNimiAppAssetMediaUrl(
              client.storage.assets,
              `${pack.assetRoot}/${pack.manifest.previewAsset}`,
              controller.signal,
            );
            revokers.push(opened.revoke);
            nextUrls[pack.contentDigest] = opened.url;
            nextUrls[pack.manifest.bundleId] ??= opened.url;
          } catch {
            // Skip preview if asset read unavailable
          }
        }
      }
      if (!controller.signal.aborted) {
        setPreviewUrls(nextUrls);
      }
    })();
    return () => {
      controller.abort();
      void Promise.allSettled(revokers.map((fn) => fn()));
    };
  }, [packs]);

  const snapshotSeq = useRef(0);
  const refreshSnapshot = useCallback(async () => {
    const seq = ++snapshotSeq.current;
    try {
      const next = await client.utopia.snapshot();
      if (seq !== snapshotSeq.current) return;
      setSnapshot(next);
      setFrozen(false);
      setAuthError(null);
      saveLocalVisitCursor({
        lastVisitedAtMs: Date.now(),
        lastActivationId: next.habitatActivationId,
      });
    } catch (failure) {
      if (seq !== snapshotSeq.current) return;
      const code = failure && typeof failure === 'object' && 'reasonCode' in failure
        ? String((failure as { reasonCode?: unknown }).reasonCode ?? '').toLowerCase().replaceAll('_', '-')
        : '';
      if (/account-changed|session-invalid|access-denied|runtime-unauthenticated|revoked/u.test(code)) {
        setSnapshot(null);
        setDraftState(null);
        setAvatarsByHandle({});
        setBindingsByHandle({});
        setChibiWardrobe({});
        setWardrobeReady(false);
        setFrozen(false);
        setAuthError('暂时无法访问住地。请确认已在 Nimi Home 登录并授予 NimiUtopia 住地权限。');
      } else {
        setFrozen(true);
        setAuthError('暂时无法连接 Runtime 住地服务，请确认 Nimi 正在运行。');
      }
    }
  }, []);

  useEffect(() => {
    void refreshSnapshot();
    const pollId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refreshSnapshot();
      }
    }, 15_000);
    const clockId = window.setInterval(() => setNowMs(Date.now()), 30_000);
    const onFocus = () => { void refreshSnapshot(); };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(pollId);
      window.clearInterval(clockId);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshSnapshot]);

  // Read-only avatar + stable agentBinding lookup via admitted agent.local listReferences,
  // followed by account-scoped wardrobe hydration so pending recovery and handle->binding
  // migration use the verified current-account binding set without cross-account leakage.
  const residentHandlesKey = useMemo(
    () => (snapshot ? snapshot.residents.map((r) => r.agentHandle).join('|') : ''),
    [snapshot],
  );

  useEffect(() => {
    if (!hasBoundSession) {
      setWardrobeReady(false);
      return;
    }
    let alive = true;
    void (async () => {
      const handles = residentHandlesKey ? residentHandlesKey.split('|').filter(Boolean) : [];
      const dir = handles.length > 0
        ? await loadAgentReferenceDirectory(client)
        : { avatarsByHandle: {}, bindingsByHandle: {} };
      if (!alive) return;
      setAvatarsByHandle(dir.avatarsByHandle);
      setBindingsByHandle(dir.bindingsByHandle);

      try {
        const loaded = await loadPersistedChibiWardrobe(client.storage, {
          bindingsByHandle: dir.bindingsByHandle,
        });
        if (!alive) return;
        setChibiWardrobe(loaded);
        setWardrobeReady(true);
      } catch {
        if (!alive) return;
        setWardrobeReady(false);
        setActionAlert({
          tone: 'warning',
          text: '暂时无法读取小人衣柜，已暂停换装，避免影响伙伴现有的装扮。',
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [hasBoundSession, residentHandlesKey]);

  const handleUpdateChibiAppearance = useCallback((agentHandle: string, updater: ChibiAppearanceUpdater) => {
    if (!wardrobeReadyRef.current) return;
    const prevSnapshot = chibiWardrobeRef.current;
    const bindings = bindingsByHandleRef.current;
    const storageKey = resolveWardrobeStorageKey(agentHandle, bindings);
    const deleteKeys = storageKey !== agentHandle ? [agentHandle] : [];
    const nextAppearance: ChibiAppearance | null = updater === null
      ? null
      : typeof updater === 'function'
        ? Object.freeze(updater(resolveChibiAppearance(agentHandle, prevSnapshot, bindings)))
        : updater;

    setChibiWardrobe((prev) => {
      const copy: Record<string, ChibiAppearance> = { ...prev };
      for (const delKey of deleteKeys) delete copy[delKey];
      if (nextAppearance === null) {
        delete copy[storageKey];
      } else {
        copy[storageKey] = nextAppearance;
      }
      return Object.freeze(copy);
    });

    void patchPersistedChibiWardrobeEntry(
      { key: storageKey, appearance: nextAppearance, deleteKeys },
      client.storage,
    ).then(
      (merged) => {
        setChibiWardrobe(merged);
      },
      async () => {
        try {
          const authoritative = await loadPersistedChibiWardrobe(client.storage, {
            bindingsByHandle: bindingsByHandleRef.current,
          });
          setChibiWardrobe(authoritative);
        } catch {
          setChibiWardrobe(prevSnapshot);
        }
        setActionAlert({
          tone: 'warning',
          text: '保存小人装扮未成功，已恢复受管衣柜记录，请稍后重试。',
        });
      },
    );
  }, []);

  // Resolve active visual stage pack matching snapshot.contentDigest
  useEffect(() => {
    if (!snapshot) {
      setStageMedia(null);
      return;
    }
    const matchedPack = packs.find((p) => p.contentDigest === snapshot.contentDigest) ?? null;
    if (!matchedPack) {
      setStageMedia(null);
      return;
    }

    const controller = new AbortController();
    let mountedMedia: ResolvedStageMedia | null = null;
    void (async () => {
      try {
        const resolved = await resolvePackMediaUrls(matchedPack, client.storage.assets, controller.signal);
        if (controller.signal.aborted) {
          await resolved.revokeAll();
          return;
        }
        mountedMedia = resolved;
        setStageMedia(resolved);
      } catch {
        if (!controller.signal.aborted) setStageMedia(null);
      }
    })();

    return () => {
      controller.abort();
      if (mountedMedia) {
        void mountedMedia.revokeAll();
      }
    };
  }, [snapshot?.contentDigest, packs]);

  const daypart = useMemo(
    () => evalDaypartInTimezone(nowMs, snapshot?.timezone ?? 'UTC'),
    [nowMs, snapshot?.timezone],
  );

  const activeAudioTrack = useMemo(() => {
    if (!snapshot || !stageMedia || stageMedia.pack.contentDigest !== snapshot.contentDigest) {
      return null;
    }
    const matched = stageMedia.pack.stage.ambientAudio.find((track) =>
      evalStageCondition(track.activeWhen, daypart, snapshot.parameterValues, snapshot.activeEvents),
    );
    if (!matched) return null;
    const url = stageMedia.assetUrls[matched.assetPath];
    if (!url) return null;
    return { id: matched.id, url, gain: matched.gain };
  }, [snapshot, stageMedia, daypart]);

  useEffect(() => {
    void audioControllerRef.current?.setTrack(activeAudioTrack);
  }, [activeAudioTrack]);

  useEffect(() => {
    const handleVis = () => {
      const hidden = document.visibilityState === 'hidden';
      void audioControllerRef.current?.setHostSuspended(hidden || frozen);
    };
    handleVis();
    document.addEventListener('visibilitychange', handleVis);
    return () => document.removeEventListener('visibilitychange', handleVis);
  }, [frozen]);

  useEffect(() => () => {
    void audioControllerRef.current?.dispose();
  }, []);

  const journalHighlights = useMemo(
    () => (snapshot ? computeVisitJournalHighlights(snapshot, initialVisitCursor, nowMs) : []),
    [snapshot, initialVisitCursor, nowMs],
  );

  const applyIntent = useCallback(async (intent: NimiUtopiaUpdateIntent, expectedRevision?: string): Promise<boolean> => {
    if (!snapshot || busy) return false;
    setBusy(true);
    setActionAlert(null);
    const isRelocation = intent.kind === 'activate-habitat' || intent.kind === 'restore-default';
    if (isRelocation && !reducedMotion) {
      setTransitioning(true);
    }
    try {
      await client.utopia.update({
        expectedRevision: expectedRevision ?? snapshot.revision,
        intent,
      });
      await refreshSnapshot();
      if (isRelocation) {
        setSelectedPlaceId(null);
      }
      return true;
    } catch (failure) {
      const code = failure && typeof failure === 'object' && 'reasonCode' in failure
        ? String((failure as { reasonCode?: unknown }).reasonCode ?? '').toLowerCase().replaceAll('_', '-')
        : '';
      if (code.includes('revision-conflict') || code.includes('aborted')) {
        await refreshSnapshot();
        setActionAlert({
          tone: 'warning',
          text: '洞天状态刚刚在别处更新，已为你同步最新画面，请核对后重新操作。',
        });
      } else {
        const msg = failure instanceof Error ? failure.message : '未能保存洞天变更，请确认应用具备管理权限。';
        setActionAlert({ tone: 'danger', text: msg });
      }
      return false;
    } finally {
      setBusy(false);
      if (isRelocation) {
        window.setTimeout(() => setTransitioning(false), reducedMotion ? 0 : 280);
      }
    }
  }, [snapshot, busy, reducedMotion, refreshSnapshot]);

  const handleToggleAudioMute = () => {
    const controller = audioControllerRef.current;
    if (!controller) return;
    const nextMuted = !audioMuted;
    setAudioMuted(nextMuted);
    void controller.setMuted(nextMuted);
  };

  const handleAudioVolumeChange = (nextVolume: number) => {
    setAudioVolume(nextVolume);
    audioControllerRef.current?.setVolume(nextVolume);
  };

  const handleOpenDraftForResident = (resident: NimiUtopiaResident, prefill: string) => {
    setDraftState(createZeroSideEffectDraftState(resident, prefill));
    openDrawerTab('residents');
  };

  const handleSelectStageResident = (resident: NimiUtopiaResident) => {
    if (!draftState || draftState.agentHandle !== resident.agentHandle) {
      setDraftState(createZeroSideEffectDraftState(resident, ''));
    }
    openDrawerTab('residents');
  };

  const handleOpenHomePartners = useCallback(() => {
    void openHomePartnersFromUtopia().then((outcome) => {
      if (!outcome.ok) {
        setActionAlert({ tone: 'warning', text: outcome.message });
      }
    });
  }, []);

  const handleOpenHomePartnerManagement = useCallback((input: {
    readonly conversationAnchorId?: string | null;
    readonly displayName: string;
  }) => {
    void openHomePartnerManagementFromUtopia(input).then((outcome) => {
      if (!outcome.ok) {
        setActionAlert({ tone: 'warning', text: outcome.message });
      }
    });
  }, []);

  const handleOpenPartnerInZhiyu = useCallback(async (input: {
    readonly agentHandle: NimiUtopiaResident['agentHandle'];
    readonly mountedAnchorId?: string | null;
    readonly draftText?: string | null;
  }): Promise<boolean> => {
    const outcome = await openPartnerConversationInZhiyuFromUtopia({
      agentHandle: input.agentHandle,
      mountedAnchorId: input.mountedAnchorId,
      draftText: input.draftText,
      openConversation: (req) => client.conversation.open(req),
    });
    if (!outcome.ok) {
      setActionAlert({ tone: 'warning', text: outcome.message });
      return false;
    }
    return true;
  }, []);

  const drawerVisible = activeDrawerTab !== null && !hudHidden;
  const packFallbackReason: 'pack-index-error' | 'version-mismatch' | 'no-pack' = packIndexError
    ? 'pack-index-error'
    : snapshot && packs.some((p) => p.habitat.habitatId === snapshot.habitat.habitatId && p.contentDigest !== snapshot.contentDigest)
      ? 'version-mismatch'
      : 'no-pack';

  return (
    <div className="utopia-app-frame">
      <NimiAppChrome
        metadata={{ name: 'NimiUtopia', version: appPackage.version }}
        locale="zh"
        sidebar={{
          visible: drawerVisible,
          onVisibleChange: (vis) => {
            if (vis) {
              openDrawerTab(lastDrawerTabRef.current);
            } else {
              setActiveDrawerTab(null);
            }
          },
        }}
      />

      <div className="utopia-world-shell">
        <HorizonTopBar
          snapshot={snapshot}
          nowMs={nowMs}
          daypart={daypart}
          frozen={frozen}
          busy={busy}
          audioMuted={audioMuted}
          audioVolume={audioVolume}
          hasAudioTrack={Boolean(activeAudioTrack)}
          sidebarCollapsed={!drawerVisible}
          activeDrawerTab={activeDrawerTab}
          residentCount={snapshot?.residents.length ?? 0}
          hudHidden={hudHidden}
          onSelectDrawerTab={toggleDrawerTab}
          onToggleAudioMute={handleToggleAudioMute}
          onAudioVolumeChange={handleAudioVolumeChange}
          onQuickCycleParameter={(key, nextVal) => {
            void applyIntent({
              kind: 'apply-tuning',
              parameters: { [key]: nextVal },
            });
          }}
          onOpenTuner={() => openDrawerTab('tuner')}
          onOpenPackLibrary={() => setPackDrawerOpen(true)}
          onToggleSidebar={() => {
            if (drawerVisible) {
              setActiveDrawerTab(null);
            } else {
              openDrawerTab(lastDrawerTabRef.current);
            }
          }}
          onRetryRefresh={() => void refreshSnapshot()}
        />

        {actionAlert && !hudHidden && (
          <div className="utopia-floating-alert">
            <InlineAlert
              tone={actionAlert.tone}
              action={(
                <Button tone="ghost" size="sm" onClick={() => setActionAlert(null)}>
                  知道了
                </Button>
              )}
            >
              {actionAlert.text}
            </InlineAlert>
          </div>
        )}

        {!snapshot ? (
          <main className="utopia-loading-canvas">
            {authError ? (
              <div className="utopia-parchment-empty">
                <EmptyState
                  title="尚未连接洞天住地"
                  description={authError}
                  action={(
                    <Button tone="primary" onClick={() => void refreshSnapshot()}>
                      重新连接
                    </Button>
                  )}
                />
              </div>
            ) : (
              <p className="utopia-loading-scroll-pill" role="status">
                正在展开手绘洞天与伙伴行迹…
              </p>
            )}
          </main>
        ) : (
          <main className="utopia-world-canvas-main">
            <UtopiaStageViewport
              snapshot={snapshot}
              stageMedia={stageMedia}
              daypart={daypart}
              frozen={frozen}
              reducedMotion={reducedMotion}
              transitioning={transitioning}
              selectedPlaceId={selectedPlaceId}
              selectedResidentHandle={draftState?.agentHandle ?? null}
              chibiWardrobe={chibiWardrobe}
              bindingsByHandle={bindingsByHandle}
              packFallbackReason={packFallbackReason}
              packFallbackDetail={packIndexError}
              onOpenPackLibrary={() => setPackDrawerOpen(true)}
              busy={busy}
              drawerOpen={drawerVisible}
              hudHidden={hudHidden}
              onToggleHudHidden={() => setHudHidden((h) => !h)}
              onOpenTuner={() => openDrawerTab('tuner')}
              onOpenHomePartners={handleOpenHomePartners}
              onSelectPlace={(placeId) => setSelectedPlaceId((prev) => (prev === placeId ? null : placeId))}
              onSelectResident={handleSelectStageResident}
              onBackgroundClick={() => {
                if (selectedPlaceId) {
                  setSelectedPlaceId(null);
                }
              }}
              onQuickApplyParameters={(params) => {
                void applyIntent({
                  kind: 'apply-tuning',
                  parameters: params,
                });
              }}
            />

            {drawerVisible && activeDrawerTab && (
              <aside className="utopia-floating-drawer" aria-label="洞天手记卷轴">
                <div className="utopia-drawer-top-strip">
                  <nav className="utopia-tab-strip" role="tablist" aria-label="手记卷轴标签页">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeDrawerTab === 'journal'}
                      className={`utopia-tab-btn ${activeDrawerTab === 'journal' ? 'is-active' : ''}`}
                      onClick={() => openDrawerTab('journal')}
                    >
                      住地手记
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeDrawerTab === 'residents'}
                      className={`utopia-tab-btn ${activeDrawerTab === 'residents' ? 'is-active' : ''}`}
                      onClick={() => openDrawerTab('residents')}
                    >
                      伙伴 ({snapshot.residents.length})
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeDrawerTab === 'tuner'}
                      className={`utopia-tab-btn ${activeDrawerTab === 'tuner' ? 'is-active' : ''}`}
                      onClick={() => openDrawerTab('tuner')}
                    >
                      营造调音
                    </button>
                  </nav>

                  <button
                    type="button"
                    className="utopia-drawer-close-btn"
                    aria-label="收起手记卷轴回到全幅画卷"
                    title="收起手记卷轴 (Esc)"
                    onClick={() => setActiveDrawerTab(null)}
                  >
                    ×
                  </button>
                </div>

                <div className="utopia-rail-scroll">
                  {activeDrawerTab === 'journal' && (
                    <JournalAndSharedTab
                      snapshot={snapshot}
                      highlights={journalHighlights}
                      avatarsByHandle={avatarsByHandle}
                      onOpenDraft={handleOpenDraftForResident}
                    />
                  )}

                  {activeDrawerTab === 'residents' && (
                    <ResidentDetailAndDraft
                      client={client}
                      snapshot={snapshot}
                      busy={busy}
                      draftState={draftState}
                      avatarsByHandle={avatarsByHandle}
                      bindingsByHandle={bindingsByHandle}
                      chibiWardrobe={chibiWardrobe}
                      wardrobeReady={wardrobeReady}
                      onUpdateChibiAppearance={handleUpdateChibiAppearance}
                      onDraftStateChange={setDraftState}
                      onApplyIntent={async (intent) => { await applyIntent(intent); }}
                      onOpenHomePartners={handleOpenHomePartners}
                      onOpenHomePartnerManagement={handleOpenHomePartnerManagement}
                      onOpenPartnerInZhiyu={handleOpenPartnerInZhiyu}
                    />
                  )}

                  {activeDrawerTab === 'tuner' && (
                    <React.Suspense fallback={<p className="utopia-empty-hint">正在展开营造调音台…</p>}>
                      <LazyDeterministicTunerPanel
                        client={client}
                        snapshot={snapshot}
                        nowMs={nowMs}
                        busy={busy}
                        onApplyIntent={applyIntent}
                      />
                    </React.Suspense>
                  )}
                </div>
              </aside>
            )}
          </main>
        )}
      </div>

      {packDrawerOpen && (
        <React.Suspense fallback={null}>
          <LazyRelocationAndPackDrawer
            open={packDrawerOpen}
            onClose={() => setPackDrawerOpen(false)}
            snapshot={snapshot}
            frozen={frozen}
            packs={packs}
            packIndexError={packIndexError}
            previewUrls={previewUrls}
            storagePort={storagePort}
            busy={busy}
            resolveActiveContentDigest={async () => (await client.utopia.snapshot()).contentDigest}
            onPacksChanged={refreshPacks}
            onExecuteRelocation={applyIntent}
          />
        </React.Suspense>
      )}

      <NimiToaster />
    </div>
  );
}

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <React.StrictMode>
      <NimiThemeProvider accentPack="nimi-accent">
        <TooltipProvider>
          <UtopiaApp />
        </TooltipProvider>
      </NimiThemeProvider>
    </React.StrictMode>,
  );
}
