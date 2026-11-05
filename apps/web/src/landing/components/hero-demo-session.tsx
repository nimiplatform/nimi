import {
  useLayoutEffect,
  useEffect,
  useCallback,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from 'react';
import type { ConversationCanonicalMessage } from '@nimiplatform/kit/features/chat/types';
import { loadLandingContent, type HeroDemo, type HeroDemoSurface } from '../content/landing-content.js';
import type { DemoChatSubmission } from '../content/home-chat-content.js';
import type { ExploreCharacter } from '../content/explore-demo-data.js';
import { materializeChatMessages, resolveDemoChatTarget } from '../content/demo-chat-model.js';
import type { PreviewScreen } from '../content/demo-navigation.js';
import { reduceDemoNavigation } from '../content/demo-navigation.js';
import type { DemoPreferences } from './demo-settings.js';
import { DemoSessionContext } from './hero-demo-context.js';
import { getStoryCopy } from '../content/story-copy.js';
import { toLocalAgentDemoPartner } from '../content/local-agent-demo-data.js';
import type { HeroDemoAgent } from '../content/landing-content.js';
import { createDemoAgentClients } from '../content/demo-agent-clients.js';
import type { CloudExample } from '../content/demo-cloud-data.js';

function useDemoSession(sourceDemo: HeroDemo, initialSurface: HeroDemoSurface, section?: number) {
  const [demo, setDemo] = useState(sourceDemo);
  const [agentClients] = useState(createDemoAgentClients);
  const [cloud, setCloud] = useState<CloudExample | null>(null);
  const [navigation, dispatch] = useReducer(reduceDemoNavigation, {
    entries: [{ surface: initialSurface }],
    position: 0,
  });
  useLayoutEffect(() => {
    if (section !== undefined) dispatch({ type: 'enter-section', index: section });
  }, [section]);
  const { entries: history, position } = navigation;
  const [sidebar, setSidebar] = useState(true);
  const [localMessages, setLocalMessages] = useState<
    Readonly<Record<string, readonly ConversationCanonicalMessage[]>>
  >({});
  const [composerDrafts, setComposerDrafts] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState(demo.home.messagesSeed);
  const [preferences, setPreferences] = useState<DemoPreferences>({
    theme: 'light',
    reducedMotion: false,
    notifications: true,
    sound: false,
    developer: false,
    visibility: 'friends',
  });
  const [playing, setPlaying] = useState(() => typeof window !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pause = () => setPlaying(false);
    const onVisibility = () => { if (document.hidden) pause(); };
    media.addEventListener('change', pause);
    document.addEventListener('visibilitychange', onVisibility);
    return () => { media.removeEventListener('change', pause); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);
  const current = history[position]!;
  const guideStep = navigation.guide?.exploring ? undefined : navigation.guide?.step;
  const selectGuideStep = useCallback((step: number) => dispatch({ type: 'guide', step }), []);
  const explore = useCallback(() => dispatch({ type: 'explore' }), []);
  const openPreview = useCallback((appId: string, screen?: PreviewScreen, partnerId?: string) => dispatch({ type: 'open-preview', appId, screen, partnerId }), []);
  const closePreview = useCallback(() => dispatch({ type: 'close-preview' }), []);
  const appendPartnerMessage = useCallback((id: string, message: ConversationCanonicalMessage) => {
    setLocalMessages(previous => ({ ...previous, [id]: [...(previous[id] ?? []), message] }));
  }, []);
  const surface = current.surface;
  const selectedChatTargetId = surface === 'chat' ? (current.target ?? null) : null;
  const navigate = (next: HeroDemoSurface, target?: string) =>
    dispatch({ type: 'push', destination: { surface: next, target } });
  const goHistory = (delta: -1 | 1) => dispatch({ type: 'go', delta });
  const switchChatSide = (target: string | null) =>
    dispatch({ type: 'replace', destination: { surface: 'chat', target: target ?? undefined } });
  const readMessage = (id: string) =>
    setMessages((previous) => previous.map((item) => (item.id === id ? { ...item, unread: false } : item)));
  const hideMessage = (id: string) => setMessages((previous) => previous.filter((item) => item.id !== id));
  const changeLocale = async (locale: 'zh' | 'en') => {
    const next = (await loadLandingContent(locale)).hero.demo;
    setDemo(next);
    setMessages(next.home.messagesSeed);
    agentClients.clear();
    setLocalMessages({});
    setComposerDrafts({});
    // Locale changes replace the demo data, including visitor-created chats
    // and companions. Retire their history entries in the same update.
    dispatch({ type: 'reset', destination: { surface: 'settings' } });
  };

  const addExplorePartner = (character: ExploreCharacter) => {
    setDemo((previous) => {
      if (previous.chat.agents.some((agent) => agent.id === character.id)) return previous;
      const agent: HeroDemoAgent = {
        id: character.id, name: character.name, initial: character.name.slice(0, 1),
        avatarUrl: character.image, worldName: character.worldName, bio: character.bio,
        role: character.meta?.split(' | ').at(-1), messages: [],
        replies: [getStoryCopy(previous.appPreview.locale)['experience.reply']],
        introduction: { worldName: character.worldName, era: null, role: character.meta ?? null,
          greeting: character.bio, referenceImageUrl: character.image, voiceSampleUrl: null,
          voicePreviewUrl: null, voiceSampleContentHash: null, voiceSampleMimeType: null,
          voiceSampleDurationSec: null, questionTopics: [] },
      };
      return { ...previous, chat: { ...previous.chat, agents: [...previous.chat.agents, agent] },
        appPreview: { ...previous.appPreview, zhiyu: { ...previous.appPreview.zhiyu,
          partners: [...previous.appPreview.zhiyu.partners, toLocalAgentDemoPartner(agent, previous.appPreview.locale)] } } };
    });
  };

  const baseMessages = useMemo(() => materializeChatMessages(demo.chat), [demo]);

  const submitTo = useCallback(
    (requestedTarget: string | null, submission: DemoChatSubmission, exampleReply?: string) => {
      const { text, image, quote } = submission;
      const { targetId, target: agent, mode } = resolveDemoChatTarget(demo.chat, requestedTarget);
      if (!agent) return;
      const stamp = Date.now();
      const sessionId = `demo-${targetId}`;
      const echo: ConversationCanonicalMessage = {
        id: `local-${stamp}-user`,
        sessionId,
        targetId,
        source: mode,
        role: 'user',
        text,
        createdAt: new Date(stamp).toISOString(),
        status: 'complete',
        kind: 'text',
        senderName: demo.chat.userName,
        senderKind: 'human',
        metadata: {
          canonicalMessageCommitted: true,
          canonicalTurnStatus: 'completed',
          demoImage: image,
          demoQuote: quote,
        },
      };
      const reply: ConversationCanonicalMessage = {
        id: `local-${stamp}-agent`,
        sessionId,
        targetId,
        source: mode,
        role: 'assistant',
        text: exampleReply ?? (mode === 'agent' ? (agent.replies?.[0] ?? demo.chat.scriptedReply) : demo.chat.scriptedReply),
        createdAt: new Date(stamp + 1).toISOString(),
        status: 'complete',
        kind: 'text',
        senderName: mode === 'ai' ? 'Nimi' : agent.name,
        senderKind: mode,
        metadata: { canonicalMessageCommitted: true, canonicalTurnStatus: 'completed' },
      };
      setLocalMessages((prev) => ({
        ...prev,
        [targetId]: [...(prev[targetId] ?? []), echo, ...(mode === 'human' ? [] : [reply])],
      }));
      setComposerDrafts((previous) => ({ ...previous, [targetId]: '' }));
    },
    [demo],
  );

  const handleSubmit = useCallback((submission: DemoChatSubmission) => submitTo(selectedChatTargetId, submission), [selectedChatTargetId, submitTo]);

  const createThread = () => {
    const id = `ai:${crypto.randomUUID()}`;
    setDemo((previous) => ({
      ...previous,
      chat: {
        ...previous.chat,
        assistantThreads: [
          ...previous.chat.assistantThreads,
          {
            id,
            name: previous.appPreview.locale === 'zh' ? '新对话' : 'New conversation',
            initial: 'N',
            messages: [],
          },
        ],
      },
    }));
    navigate('chat', id);
  };
  return {
    agentClients,
    demo,
    cloud,
    setCloud,
    history,
    position,
    current,
    homeRevision: navigation.homeRevision ?? 0,
    section: navigation.section,
    guideStep,
    resumeStep: navigation.guide?.step ?? 0,
    preview: navigation.preview,
    openPreview,
    closePreview,
    playing,
    setPlaying,
    selectGuideStep,
    explore,
    appendPartnerMessage,
    surface,
    selectedChatTargetId,
    sidebar,
    setSidebar,
    preferences,
    setPreferences,
    composerDrafts,
    setComposerDrafts,
    localMessages,
    messages,
    baseMessages,
    navigate,
    goHistory,
    switchChatSide,
    readMessage,
    hideMessage,
    changeLocale,
    addExplorePartner,
    handleSubmit,
    submitTo,
    createThread,
  };
}

export type HeroDemoSession = ReturnType<typeof useDemoSession>;

/** Navigation, drafts and companion messages belong to the visitor's Home session. */
export function HeroDemoSessionProvider({
  demo,
  initialSurface = 'home',
  children,
  section,
}: {
  demo: HeroDemo;
  initialSurface?: HeroDemoSurface;
  children: ReactNode;
  section?: number;
}) {
  const session = useDemoSession(demo, initialSurface, section);
  return <DemoSessionContext.Provider value={session}>{children}</DemoSessionContext.Provider>;
}
