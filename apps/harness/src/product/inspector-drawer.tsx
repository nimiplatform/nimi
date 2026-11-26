import { useEffect, useRef } from 'react';
import { Button, motion, nimiOverlayPanelMotion, useNimiReducedMotion } from '@nimiplatform/kit/ui';
import type { NimiAppScope } from '@nimiplatform/kit/auth/app';
import { FolderTree, Plug, SlidersHorizontal, X } from 'lucide-react';
import { useI18n } from '../i18n.js';
import type { SessionDrafts } from './session-drafts.js';
import type { HarnessView } from './harness-types.js';
import { WorkspaceFiles } from './workspace-files.js';
import { SessionSettings } from './session-settings.js';
import { IntegrationsPanel } from './integrations-panel.js';

export type InspectorTab = 'files' | 'session' | 'integrations';
const INSPECTOR_TABS: readonly InspectorTab[] = ['files', 'session', 'integrations'];

export function InspectorDrawer({
  id = 'harness-inspector-drawer',
  tab,
  onTabChange,
  onClose,
  view,
  selectedFile,
  onSelectFile,
  scope,
  drafts,
  report,
}: {
  id?: string;
  tab: InspectorTab;
  onTabChange: (next: InspectorTab) => void;
  onClose: () => void;
  view: HarnessView;
  selectedFile?: string;
  onSelectFile: (ref: string | undefined) => void;
  scope?: NimiAppScope;
  drafts?: SessionDrafts;
  report: (message: string) => void;
}) {
  const { t } = useI18n();
  const reducedMotion = useNimiReducedMotion();
  const tabRefs = useRef<Record<InspectorTab, HTMLButtonElement | null>>({
    files: null,
    session: null,
    integrations: null,
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 768px)').matches) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function activateTab(next: InspectorTab, moveFocus = false) {
    onTabChange(next);
    if (moveFocus) tabRefs.current[next]?.focus();
  }

  function handleTabListKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const idx = INSPECTOR_TABS.indexOf(tab);
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      activateTab(INSPECTOR_TABS[(idx + 1) % INSPECTOR_TABS.length], true);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      activateTab(INSPECTOR_TABS[(idx - 1 + INSPECTOR_TABS.length) % INSPECTOR_TABS.length], true);
    } else if (event.key === 'Home') {
      event.preventDefault();
      activateTab(INSPECTOR_TABS[0], true);
    } else if (event.key === 'End') {
      event.preventDefault();
      activateTab(INSPECTOR_TABS[INSPECTOR_TABS.length - 1], true);
    }
  }

  const drawerMotion = nimiOverlayPanelMotion({ kind: 'drawer', side: 'right', reducedMotion });

  return (
    <motion.aside
      id={id}
      className="harness-inspector"
      aria-label={t('inspector.region')}
      {...drawerMotion}
    >
      <header className="harness-inspector__header">
        <div
          className="harness-inspector__tabs"
          role="tablist"
          aria-label={t('inspector.tabsLabel')}
          onKeyDown={handleTabListKeyDown}
        >
          <button
            ref={el => { tabRefs.current.files = el; }}
            id="harness-inspector-tab-files"
            type="button"
            role="tab"
            tabIndex={tab === 'files' ? 0 : -1}
            aria-selected={tab === 'files'}
            aria-controls="harness-inspector-tabpanel"
            className={`harness-tab-btn ${tab === 'files' ? 'harness-tab-btn--active' : ''}`}
            onClick={() => activateTab('files')}
          >
            <FolderTree size={14} aria-hidden="true" />
            <span>{t('inspector.files')}</span>
          </button>
          <button
            ref={el => { tabRefs.current.session = el; }}
            id="harness-inspector-tab-session"
            type="button"
            role="tab"
            tabIndex={tab === 'session' ? 0 : -1}
            aria-selected={tab === 'session'}
            aria-controls="harness-inspector-tabpanel"
            className={`harness-tab-btn ${tab === 'session' ? 'harness-tab-btn--active' : ''}`}
            onClick={() => activateTab('session')}
          >
            <SlidersHorizontal size={14} aria-hidden="true" />
            <span>{t('inspector.session')}</span>
          </button>
          <button
            ref={el => { tabRefs.current.integrations = el; }}
            id="harness-inspector-tab-integrations"
            type="button"
            role="tab"
            tabIndex={tab === 'integrations' ? 0 : -1}
            aria-selected={tab === 'integrations'}
            aria-controls="harness-inspector-tabpanel"
            className={`harness-tab-btn ${tab === 'integrations' ? 'harness-tab-btn--active' : ''}`}
            onClick={() => activateTab('integrations')}
          >
            <Plug size={14} aria-hidden="true" />
            <span>{t('inspector.integrations')}</span>
          </button>
        </div>
        <Button size="sm" tone="ghost" leadingIcon={<X size={14} />} onClick={onClose} aria-label={t('inspector.close')} />
      </header>

      <div
        id="harness-inspector-tabpanel"
        role="tabpanel"
        aria-labelledby={`harness-inspector-tab-${tab}`}
        className="harness-inspector__body"
      >
        {tab === 'files' && (
          <WorkspaceFiles
            key={'files:' + view.sessionId + ':' + (view.workspaceDir ?? '')}
            sessionId={view.sessionId}
            selected={selectedFile}
            toolRevision={view.workspaceRevision}
            drafts={drafts}
            onSelect={onSelectFile}
          />
        )}
        {tab === 'session' && scope && (
          <SessionSettings
            key={'settings:' + scope.viewKey + ':' + view.sessionId}
            scope={scope}
            id={view.sessionId}
            instructions={view.instructions}
            running={view.running}
            usage={view.usage}
            contextWindowTokens={view.contextWindowTokens}
            sessionAllowlist={view.sessionAllowlist}
            report={report}
          />
        )}
        {tab === 'integrations' && <IntegrationsPanel />}
      </div>
    </motion.aside>
  );
}
