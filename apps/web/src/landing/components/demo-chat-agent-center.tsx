import { useEffect, useMemo, useState } from 'react';
import {
  AgentCenter,
  createAgentCenterI18n,
  type AgentCenterSectionId,
} from '@nimiplatform/kit/features/agent-center';
import type { HeroDemo, HeroDemoAgent, HeroDemoZhiyuPartner } from '../content/landing-content.js';
import {
  createDemoZhiyuAgentClient,
  createDemoZhiyuAgentCenterSession,
  type DemoZhiyuAgentCenterSession,
  type DemoZhiyuAgentClient,
} from './demo-zhiyu-agent-center.js';

/** Same public Kit owner as Home. The existing demo-only client holds all changes in memory. */
export function createChatAgentClient(agent: HeroDemoAgent, demo: HeroDemo) {
  const shared = demo.appPreview.zhiyu.partners.find((partner) => partner.id === agent.id);
  if (shared) return createDemoZhiyuAgentClient(shared, demo.appPreview.zhiyu);
  const template = demo.appPreview.zhiyu.partners[0]!;
  const partner: HeroDemoZhiyuPartner = {
    ...template,
    id: agent.id,
    name: agent.name,
    avatarUrl: agent.avatarUrl ?? null,
    messages: [],
    replies: [],
    memories: [],
    hostMoodLabel: null,
    hostActivityLabel: null,
    appearance: {
      backendKind: null,
      avatarAssetRef: null,
      backgroundAssetRef: null,
      defaultVoiceReference: null,
      avatarAutoplay: false,
    },
    autonomy: { ...template.autonomy, enabled: false, mode: 'off', usedTokensInWindow: 0 },
    aiConfig: [
      { capability: 'text.generate', route: 'local' },
      { capability: 'text.embed', route: 'local' },
    ],
    manager: {
      ...template.manager,
      currentEmotion: '',
      statusText: '',
      transcriptTurnCount: agent.messages.length,
      memoryItemCount: 0,
      lorebookItemCount: 0,
    },
  };
  return createDemoZhiyuAgentClient(partner, demo.appPreview.zhiyu);
}

export function DemoChatAgentCenter({
  agent,
  demo,
  client,
  section,
  onSection,
  onClose,
  onRuntime,
  onNotice,
}: {
  agent: HeroDemoAgent;
  demo: HeroDemo;
  client: DemoZhiyuAgentClient;
  section: AgentCenterSectionId;
  onSection: (section: AgentCenterSectionId) => void;
  onClose: () => void;
  onRuntime: () => void;
  onNotice: () => void;
}) {
  const [center, setCenter] = useState<DemoZhiyuAgentCenterSession | null>(null);
  useEffect(() => {
    const created = createDemoZhiyuAgentCenterSession(client);
    setCenter(created);
    return () => created.session.dispose();
  }, [client]);
  const i18n = useMemo(
    () => createAgentCenterI18n({ language: demo.appPreview.locale, t: (key) => key }),
    [demo.appPreview.locale],
  );
  return (
    <aside
      className="demo-chat-agent-center"
      aria-label={demo.appPreview.locale === 'zh' ? '伙伴中心' : 'Agent Center'}
    >
      {center && (
        <AgentCenter
          chrome="standalone"
          activeSection={section}
          onSectionChange={onSection}
          identity={{
            displayName: agent.name,
            avatarUrl: agent.avatarUrl ?? null,
            avatarFallback: agent.initial,
          }}
          i18n={i18n}
          session={center.session}
          showResourcePack={false}
          placementActions={{ close: onClose, openRuntimeSettings: onRuntime, launchAvatar: onNotice }}
        />
      )}
    </aside>
  );
}
