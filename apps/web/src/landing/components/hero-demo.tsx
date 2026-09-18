import { useCallback, useMemo, useState } from 'react';
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
};

export function HeroDemoView({ demo }: HeroDemoProps) {
  const [surface, setSurface] = useState<HeroDemoSurface>('chat');
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [localMessages, setLocalMessages] = useState<Readonly<Record<string, readonly ConversationCanonicalMessage[]>>>({});
  const [prevDemo, setPrevDemo] = useState(demo);
  if (prevDemo !== demo) {
    // Locale switched: demo-local state resets entirely (D7). Mock messages are
    // translated per locale, so carrying local echoes across would mix languages.
    setPrevDemo(demo);
    setSurface('chat');
    setActiveAgentId(null);
    setLocalMessages({});
  }

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
      className="hero-demo-frame overflow-hidden rounded-[1.5rem] border border-white/70 bg-gradient-to-b from-[#fbe9f0] via-[#eef2fd] to-[#e9eefb] shadow-[0_24px_60px_-32px_rgba(15,23,42,0.45)] lg:rounded-[1.75rem]"
      data-demo-owns-scroll="true"
    >
      <div className="flex items-center gap-2 border-b border-white/60 bg-white/50 px-5 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-[#fca5a5]" aria-hidden="true" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#fcd34d]" aria-hidden="true" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#6ee7b7]" aria-hidden="true" />
        <span className="ml-2 text-sm font-semibold tracking-tight text-slate-700">{demo.windowTitle}</span>
      </div>

      <div className="px-3 pt-2 md:hidden">
        <DemoSurfaceSwitcher demo={demo} surface={surface} onSelect={setSurface} />
      </div>

      <div className="flex h-[560px] md:h-[650px] lg:h-[780px]">
        <div className="hidden md:flex">
          <DemoRail demo={demo} surface={surface} onSelect={setSurface} />
        </div>
        <div className="min-w-0 flex-1 p-2 lg:p-3">
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
  );
}
