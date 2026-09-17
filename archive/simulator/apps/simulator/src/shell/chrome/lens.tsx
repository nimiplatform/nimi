import { useEffect, useMemo, useRef, useState } from 'react';
import { useUi, SCENE_PHASE_LABEL } from './ui-context.tsx';
import { useShellActions } from './shell-actions.tsx';

interface Command {
  id: string;
  label: string;
  hint: string;
  run: () => void;
}

/** The Lens — ⌘K command palette. */
export function Lens() {
  const {
    lensOpen,
    setLensOpen,
    cycleScenePhase,
    phase,
    setAppsPageOpen,
    setSkyPanelOpen,
  } = useUi();
  const { modules, navigate, reset, open, phase: sessionPhase } = useShellActions();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!lensOpen) return undefined;
    setQuery('');
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(focusTimer);
  }, [lensOpen]);

  const commands = useMemo<Command[]>(
    () => [
      ...modules.flatMap((module) => module.surfaces.map((surface) => ({
        id: `open-${module.moduleId}-${surface.id}`,
        label: `打开 ${module.moduleId} · ${surface.label}`,
        hint: `${module.moduleId} · ${surface.id}`,
        run: () => open(module.moduleId, surface.id),
      }))),
      { id: 'apps', label: '应用 · Apps', hint: 'launcher', run: () => setAppsPageOpen(true) },
      { id: 'home', label: '回到基座', hint: 'cradle', run: () => navigate({ kind: 'home' }) },
      { id: 'diagnostics', label: '会话诊断', hint: 'diagnostics', run: () => navigate({ kind: 'diagnostics' }) },
      {
        id: 'phase',
        label: `切换月昼相位（当前 ${SCENE_PHASE_LABEL[phase]}）`,
        hint: 'lunar light',
        run: cycleScenePhase,
      },
      { id: 'sky', label: '光影与时间', hint: 'light & time', run: () => setSkyPanelOpen(true) },
      ...(sessionPhase === 'open'
        ? [{ id: 'reset', label: '重置场景（新 epoch）', hint: 'reset', run: reset }]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modules, navigate, cycleScenePhase, phase, reset, sessionPhase, setAppsPageOpen, setSkyPanelOpen],
  );

  if (!lensOpen) return null;
  const q = query.trim().toLowerCase();
  const matched = q ? commands.filter((c) => (c.label + c.hint).toLowerCase().includes(q)) : commands;

  const runAndClose = (c: Command) => {
    c.run();
    setLensOpen(false);
  };

  return (
    <div
      className="lens-backdrop"
      data-nimi-material="glass-thin"
      data-nimi-tone="overlay"
      onClick={() => setLensOpen(false)}
    >
      <div
        className="lens pane"
        data-nimi-material="glass-chrome"
        data-nimi-tone="overlay"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Lens"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matched[0]) runAndClose(matched[0]);
            if (e.key === 'Escape') setLensOpen(false);
          }}
          placeholder="输入命令 · open, phase, reset…"
        />
        <div className="lens-list">
          {matched.length === 0 ? <p className="t-caption lens-empty">没有匹配的命令</p> : null}
          {matched.map((c, i) => (
            <button key={c.id} type="button" className="lens-row" onClick={() => runAndClose(c)}>
              <span>{c.label}</span>
              <span className="t-mono">{c.hint}</span>
              {i === 0 ? <kbd>⏎</kbd> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
