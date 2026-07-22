import { useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { SimProvider, useSim } from './engine/SimContext';
import { UiProvider, useUi, PHASE_LABEL } from './shell/UiContext';
import { Field } from './shell/Field';
import { WakeScreen } from './shell/WakeScreen';
import { Spine } from './shell/Spine';
import { Lens } from './shell/Lens';
import { Cradle } from './shell/Cradle';
import { WindowManager } from './shell/WindowManager';
import { AppRail } from './shell/AppRail';
import { AppsPage } from './shell/AppsPage';
import { ConsentOverlay } from './shell/ConsentOverlay';
import { LedgerDrawer, type LedgerFilter } from './shell/LedgerDrawer';
import { ToastFloat } from './shell/ToastFloat';
import { AgentLayer } from './shell/AgentLayer';
import { FieldMenu, type FieldMenuState } from './shell/FieldMenu';
import { SkyPanel } from './shell/SkyPanel';
import { SpatialStage } from './shell/SpatialStage';

const BLOCK_MENU = '.pane-float, .window-frame, .spine, .app-rail, .apps-page, .ledger-drawer, .consent-backdrop, .lens-backdrop, .toast-float, .field-menu, .sky-panel, button, input';

function Stage() {
  const { state, goHome, tidy, toggleLedger } = useSim();
  const { awake, phase, effectivePhase, tide, setLensOpen, toggleTide, cyclePhase } = useUi();
  const [menu, setMenu] = useState<FieldMenuState | null>(null);
  const [skyPanelOpen, setSkyPanelOpen] = useState(false);
  const [appsOpen, setAppsOpen] = useState(false);
  const [ledgerFilter, setLedgerFilter] = useState<LedgerFilter>('all');
  const home = state.windows.every((w) => w.minimized);
  const openSkyPanel = useCallback(() => setSkyPanelOpen(true), []);
  const closeSkyPanel = useCallback(() => setSkyPanelOpen(false), []);
  const closeApps = useCallback(() => setAppsOpen(false), []);
  const openGrantLedger = useCallback(() => {
    setLedgerFilter('grant');
    if (!state.ledgerOpen) toggleLedger();
  }, [state.ledgerOpen, toggleLedger]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      const inDialog = Boolean(target?.closest('[role="dialog"]'));
      const inEditable = Boolean(target?.matches('input, textarea, select, [contenteditable="true"]'));
      if (!awake || inDialog) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setLensOpen(true);
      } else if (e.key === '`' || e.key === '~') {
        if (inEditable) return;
        e.preventDefault();
        toggleTide();
      } else if (e.key === 'Escape') {
        if (skyPanelOpen) closeSkyPanel();
        else if (state.ledgerOpen) toggleLedger();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [awake, setLensOpen, toggleTide, skyPanelOpen, closeSkyPanel, state.ledgerOpen, toggleLedger]);

  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest(BLOCK_MENU)) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const phaseLabel =
    phase === 'auto' ? `自动（${PHASE_LABEL[effectivePhase].slice(0, 1)}）` : PHASE_LABEL[phase];

  return (
    <Field phase={effectivePhase}>
      <SpatialStage active={tide} onContextMenu={onContextMenu} onExit={toggleTide}>
        {home && awake ? (
          <Cradle onOpenApps={() => setAppsOpen(true)} onOpenGrantLedger={openGrantLedger} />
        ) : null}
        <WindowManager />
      </SpatialStage>
      {appsOpen ? <AppsPage onClose={closeApps} /> : null}
      <AppRail />
      <AgentLayer />
      <ToastFloat />
      <ConsentOverlay />
      <LedgerDrawer filter={ledgerFilter} onFilterChange={setLedgerFilter} />
      <Spine onOpenSkyPanel={openSkyPanel} skyPanelOpen={skyPanelOpen} />
      <Lens />
      <WakeScreen />
      {tide ? <div className="tide-caption">The Tide · 滚轮聚焦 · Esc 返回</div> : null}
      <FieldMenu
        menu={menu}
        onClose={() => setMenu(null)}
        items={[
          { id: 'tidy', label: '整理场 · tidy panes', hint: 'tidy', run: tidy },
          { id: 'lens', label: '打开 Lens', hint: '⌘K', run: () => setLensOpen(true) },
          { id: 'tide', label: 'Tide 概览', hint: '`', run: toggleTide },
          { id: 'phase', label: `切换相位（当前 ${phaseLabel}）`, hint: '◐', run: cyclePhase },
          { id: 'sky', label: '光影与时间', hint: '☼', run: openSkyPanel },
          { id: 'home', label: '回到基座', hint: 'cradle', run: goHome },
        ]}
      />
      <SkyPanel open={skyPanelOpen} onClose={closeSkyPanel} />
    </Field>
  );
}

export default function App() {
  return (
    <SimProvider>
      <UiProvider>
        <Stage />
      </UiProvider>
    </SimProvider>
  );
}
