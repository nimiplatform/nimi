import { useState } from 'react';
import { StatusBadge } from '@nimiplatform/kit/ui';
import { PlayHome } from './play/play-home.js';
import { PlayRun } from './play/play-run.js';
import { StudioHome } from './studio/studio-home.js';
import { StudioIntake } from './studio/studio-intake.js';
import { StudioProject } from './studio/studio-project.js';

// Top-level Storybook shell. One app with clearly separated Play and Studio
// surfaces over the shared Engine (split_surfaces posture). The first screen is
// the app itself — Play library — not a marketing page. Play renders only Play
// components; Studio renders only Studio components, so Play never exposes
// authoring controls.

type Surface = 'play' | 'studio';

type PlayView = { screen: 'library' } | { screen: 'run'; runId: string };
type StudioView = { screen: 'projects' } | { screen: 'intake' } | { screen: 'project'; projectId: string };

export function StorybookApp() {
  const [surface, setSurface] = useState<Surface>('play');
  const [playView, setPlayView] = useState<PlayView>({ screen: 'library' });
  const [studioView, setStudioView] = useState<StudioView>({ screen: 'projects' });

  return (
    <div className="sb-app" data-testid="storybook-app">
      <header className="sb-header">
        <div className="sb-brand">
          <h1>Storybook</h1>
          <small>互动叙事工作台 · Play / Studio / Engine</small>
        </div>
        <div className="sb-surface-switch" role="tablist" aria-label="Storybook 表面切换">
          <button
            type="button"
            role="tab"
            aria-selected={surface === 'play'}
            className={`sb-surface-switch__btn${surface === 'play' ? ' sb-surface-switch__btn--active' : ''}`}
            onClick={() => setSurface('play')}
            data-testid="surface-play"
          >
            Play
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={surface === 'studio'}
            className={`sb-surface-switch__btn${surface === 'studio' ? ' sb-surface-switch__btn--active' : ''}`}
            onClick={() => setSurface('studio')}
            data-testid="surface-studio"
          >
            Studio
          </button>
        </div>
        <StatusBadge tone="info" shape="dot">
          {surface === 'play' ? '玩家模式：低配置开玩' : '创作者模式：作者工作台'}
        </StatusBadge>
      </header>

      <main className="sb-content">
        {surface === 'play' ? (
          playView.screen === 'library' ? (
            <PlayHome onStartRun={(runId) => setPlayView({ screen: 'run', runId })} />
          ) : (
            <PlayRun runId={playView.runId} onExit={() => setPlayView({ screen: 'library' })} />
          )
        ) : studioView.screen === 'projects' ? (
          <StudioHome
            onNewProject={() => setStudioView({ screen: 'intake' })}
            onOpenProject={(projectId) => setStudioView({ screen: 'project', projectId })}
          />
        ) : studioView.screen === 'intake' ? (
          <StudioIntake
            onCreated={(projectId) => setStudioView({ screen: 'project', projectId })}
            onCancel={() => setStudioView({ screen: 'projects' })}
          />
        ) : (
          <StudioProject
            projectId={studioView.projectId}
            onBack={() => setStudioView({ screen: 'projects' })}
          />
        )}
      </main>
    </div>
  );
}
