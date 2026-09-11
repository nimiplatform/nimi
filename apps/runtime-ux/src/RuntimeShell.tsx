import { useState, type ComponentType } from 'react';
import { pageOrder, type PageId } from './pages';
import { HomePage } from './pages/HomePage';
import { AnswersPage } from './pages/AnswersPage';
import { PersonalityPage } from './pages/PersonalityPage';
import { UsageAccessPage } from './pages/UsageAccessPage';
import { StatusPage } from './pages/StatusPage';
import { SetupGuide } from './SetupGuide';
import { NewProfileWizard } from './NewProfileWizard';
import { IconChat, IconGauge, IconHome, IconProfile, IconPulse } from './icons';

const pageIcons: Record<PageId, ComponentType<{ size?: number }>> = {
  home: IconHome,
  answers: IconChat,
  personality: IconProfile,
  usage: IconGauge,
  status: IconPulse,
};

type Overlay = 'none' | 'setup-guide' | 'new-personality';

export function RuntimeShell({
  initialPage = 'home',
  setupIncomplete = false,
  answersEmpty = false,
  presetApplied = false,
  justInstalled = false,
}: {
  initialPage?: PageId;
  setupIncomplete?: boolean;
  answersEmpty?: boolean;
  presetApplied?: boolean;
  justInstalled?: boolean;
}) {
  const [page, setPage] = useState<PageId>(initialPage);
  const [overlay, setOverlay] = useState<Overlay>('none');

  if (overlay === 'setup-guide') {
    return (
      <div className="rt-shell">
        <SetupGuide onClose={() => setOverlay('none')} />
      </div>
    );
  }
  if (overlay === 'new-personality') {
    return (
      <div className="rt-shell">
        <NewProfileWizard onClose={() => setOverlay('none')} />
      </div>
    );
  }

  return (
    <div className="rt-shell">
      <nav className="rt-sidebar" aria-label="Runtime settings">
        <div className="rt-sidebar-title">Runtime</div>
        {pageOrder.map(({ id, label }) => {
          const Icon = pageIcons[id];
          return (
            <button
              key={id}
              type="button"
              className={`rt-nav-item${id === page ? ' active' : ''}`}
              onClick={() => setPage(id)}
              aria-current={id === page ? 'page' : undefined}
            >
              <Icon size={16} />
              {label}
            </button>
          );
        })}
        <div className="rt-sidebar-footer">
          Nimi Desktop
          <br />
          Runtime settings — UX prototype
        </div>
      </nav>
      <main className="rt-content">
        {page === 'home' && (
          <HomePage
            setupComplete={!setupIncomplete}
            onNavigate={setPage}
            onOpenSetupGuide={() => setOverlay('setup-guide')}
          />
        )}
        {page === 'answers' && (
          <AnswersPage empty={answersEmpty} presetApplied={presetApplied} justInstalled={justInstalled} />
        )}
        {page === 'personality' && (
          <PersonalityPage onNewPersonality={() => setOverlay('new-personality')} />
        )}
        {page === 'usage' && <UsageAccessPage />}
        {page === 'status' && <StatusPage onNavigate={setPage} />}
      </main>
    </div>
  );
}
