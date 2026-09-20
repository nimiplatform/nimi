import { useCallback, useMemo, useState } from 'react';
import { cn } from '@nimiplatform/kit/ui';
import type { ConversationCanonicalMessage } from '@nimiplatform/kit/features/chat/types';
import type { HeroDemo, HeroDemoSurface } from '../content/landing-content.js';
import { DemoAppsSurface } from './demo-apps.js';
import { DemoChatSurface, materializeAgentMessages } from './demo-chat.js';
import { DemoExploreSurface } from './demo-explore.js';
import { DemoRail, DemoSurfaceSwitcher } from './demo-rail.js';
import { DemoRuntimeSurface } from './demo-runtime.js';
import { DemoSettingsSurface } from './demo-settings.js';

export type HeroDemoProps = {
  demo: HeroDemo;
  /** Initial internal surface; the hero starts on chat, the apps screen on apps. */
  defaultSurface?: HeroDemoSurface;
  /** Forces the visible surface while set — used by the hero↔apps morph so the
   * zooming window cross-fades to the apps surface before it lands. */
  surfaceOverride?: HeroDemoSurface | null;
  /** Fills the parent instead of using the fixed hero mockup heights. */
  expanded?: boolean;
};

export function HeroDemoView({ demo, defaultSurface, surfaceOverride, expanded }: HeroDemoProps) {
  const initialSurface = defaultSurface ?? 'chat';
  const [internalSurface, setInternalSurface] = useState<HeroDemoSurface>(initialSurface);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [localMessages, setLocalMessages] = useState<Readonly<Record<string, readonly ConversationCanonicalMessage[]>>>({});
  const [prevDemo, setPrevDemo] = useState(demo);
  if (prevDemo !== demo) {
    // Locale switched: demo-local state resets entirely (D7). Mock messages are
    // translated per locale, so carrying local echoes across would mix languages.
    setPrevDemo(demo);
    setInternalSurface(initialSurface);
    setActiveAgentId(null);
    setLocalMessages({});
  }
  const surface = surfaceOverride ?? internalSurface;

  const baseMessages = useMemo(() => materializeAgentMessages(demo.chat), [demo]);

  const handleSubmit = useCallback((text: string) => {
    const targetId = activeAgentId ?? demo.chat.defaultTargetId;
    const agent = demo.chat.agents.find((candidate) => candidate.id === targetId);
    if (!agent) return;
    const stamp = Date.now();
    const sessionId = `demo-${targetId}`;
    const echo: ConversationCanonicalMessage = {
      id: `local-${stamp}-user`,
      sessionId,
      targetId,
      source: 'agent',
      role: 'user',
      text,
      createdAt: new Date(stamp).toISOString(),
      status: 'complete',
      kind: 'text',
      senderName: demo.chat.userName,
      senderKind: 'human',
    };
    const reply: ConversationCanonicalMessage = {
      id: `local-${stamp}-agent`,
      sessionId,
      targetId,
      source: 'agent',
      role: 'assistant',
      text: demo.chat.scriptedReply,
      createdAt: new Date(stamp + 1).toISOString(),
      status: 'complete',
      kind: 'text',
      senderName: agent.name,
      senderKind: 'agent',
    };
    setLocalMessages((prev) => ({
      ...prev,
      [targetId]: [...(prev[targetId] ?? []), echo, reply],
    }));
    setActiveAgentId(targetId);
  }, [activeAgentId, demo]);

  return (
    <div
      className={cn(
        'hero-demo-frame',
        expanded && 'flex h-full min-h-0 flex-col',
      )}
      data-demo-owns-scroll="true"
      data-demo-interactive="true"
    >
      <div className="hero-demo-titlebar flex shrink-0 items-center gap-2 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#fca5a5]" aria-hidden="true" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#fcd34d]" aria-hidden="true" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#6ee7b7]" aria-hidden="true" />
        <span className="ml-2 text-sm font-semibold tracking-tight text-slate-700">{demo.windowTitle}</span>
      </div>

      <div className="shrink-0 px-3 pt-2 md:hidden">
        <DemoSurfaceSwitcher demo={demo} surface={surface} onSelect={setInternalSurface} />
      </div>

      <div className={expanded ? 'flex min-h-0 flex-1' : 'flex h-[520px] md:h-[620px] lg:h-[min(720px,80vh)] xl:h-[min(780px,82vh)] 2xl:h-[min(840px,84vh)]'}>
        <div className="hidden md:flex">
          <DemoRail demo={demo} surface={surface} onSelect={setInternalSurface} />
        </div>
        <div className="min-w-0 flex-1 p-2 lg:p-3">
          {/* Keyed remount on every surface switch so the incoming surface
              plays its fade-in, including the switch the hero↔apps morph
              performs after the window has landed (the outgoing surface is
              faded out through data-demo-surface first). */}
          <div key={surface} data-demo-surface className="demo-surface-enter h-full min-h-0">
            {surface === 'chat' ? (
              <DemoChatSurface
                chat={demo.chat}
                activeAgentId={activeAgentId}
                baseMessages={baseMessages}
                localMessages={localMessages}
                onOpenAgent={setActiveAgentId}
                onBack={() => setActiveAgentId(null)}
                onSubmit={handleSubmit}
              />
            ) : null}
            {surface === 'explore' ? <DemoExploreSurface explore={demo.explore} /> : null}
            {surface === 'apps' ? <DemoAppsSurface apps={demo.apps} preview={demo.appPreview} /> : null}
            {surface === 'runtime' ? <DemoRuntimeSurface runtime={demo.runtime} /> : null}
            {surface === 'settings' ? <DemoSettingsSurface settings={demo.settings} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
