import { resolveDemoChatTarget } from '../content/demo-chat-model.js';
import { DemoHumanAvatar, DemoHumanProfileDetails } from './demo-human-profile.js';
import { DemoChatAvatarCard } from './demo-chat-avatar-card.js';
import { exploreCharacters } from '../content/explore-demo-data.js';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Lightbulb,
  ContactRound,
  Headphones,
  History,
  Mic,
  Plus,
  Rotate3d,
  Settings2,
  UserRound,
  X,
} from 'lucide-react';
import { Button } from '@nimiplatform/kit/ui';
import { CanonicalComposer } from '@nimiplatform/kit/features/chat/components/canonical-composer';
import { CanonicalTranscriptView } from '@nimiplatform/kit/features/chat/components/canonical-transcript-view';
import { AgentIntroduction, getMessageInteractionCopy } from '@nimiplatform/kit/features/chat/ui';
import type {
  ChatComposerAdapter,
  ConversationCanonicalMessage,
} from '@nimiplatform/kit/features/chat/types';
import type { AgentCenterSectionId } from '@nimiplatform/kit/features/agent-center';
import type { HeroDemo, HeroDemoAgent } from '../content/landing-content.js';
import type { DemoChatSubmission } from '../content/home-chat-content.js';
import type { DemoZhiyuAgentClient } from './demo-zhiyu-agent-center.js';
import { DemoChatAgentCenter, createChatAgentClient } from './demo-chat-agent-center.js';
import { DemoChatContacts } from './demo-chat-contacts.js';
import { DemoPartnerAvatar, demoText } from './demo-home-ui.js';
import type { DemoNavigate } from './demo-home.js';

type Panel = 'history' | 'settings' | 'identity' | 'agent-center' | null;
function Tool({
  label,
  children,
  active,
  onClick,
}: {
  label: string;
  children: ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="demo-chat-tool"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// @nimi-authority: rule.nimi.desktop.shell-ui.chat-sides
export function DemoChatSurface({
  demo,
  selectedTargetId,
  draft,
  onDraftChange,
  baseMessages,
  localMessages,
  onSelectTarget,
  onSwitchSide,
  onSubmit,
  onCreateThread,
  onNavigate,
}: {
  demo: HeroDemo;
  selectedTargetId: string | null;
  draft: string;
  onDraftChange: (text: string) => void;
  baseMessages: Record<string, ConversationCanonicalMessage[]>;
  localMessages: Readonly<Record<string, readonly ConversationCanonicalMessage[]>>;
  onSelectTarget: (id: string | null) => void;
  onSwitchSide: (id: string | null) => void;
  onSubmit: (submission: DemoChatSubmission) => void;
  onCreateThread: () => void;
  onNavigate: DemoNavigate;
}) {
  const { chat } = demo;
  const t = demoText(demo);
  const { target, mode, targetId } = resolveDemoChatTarget(chat, selectedTargetId);
  const [panel, setPanel] = useState<Panel>(null);
  const [profilePerson, setProfilePerson] = useState<HeroDemoAgent | null>(null);
  const profileTarget = profilePerson ?? target;
  const [section, setSection] = useState<AgentCenterSectionId>('overview');
  const [contexts, setContexts] = useState<Record<string, Pick<DemoChatSubmission, 'image' | 'quote'>>>({});
  const quote = contexts[targetId]?.quote;
  const image = contexts[targetId]?.image;
  const setQuote = (value: DemoChatSubmission['quote']) =>
    setContexts((previous) => ({ ...previous, [targetId]: { ...previous[targetId], quote: value } }));
  const setImage = (value: string | undefined) =>
    setContexts((previous) => ({ ...previous, [targetId]: { ...previous[targetId], image: value } }));
  const [notice, setNotice] = useState('');
  const [thinking, setThinking] = useState<Record<string, boolean>>({});
  const requestedCenter = useRef<string | null>(null);
  const [lastTarget, setLastTarget] = useState(targetId);
  if (lastTarget !== targetId) {
    setLastTarget(targetId);
    setPanel((previous) =>
      requestedCenter.current === targetId
        ? 'agent-center'
        : previous === 'history' && mode === 'ai'
          ? previous
          : null,
    );
    requestedCenter.current = null;
    setNotice('');
  }
  const clients = useRef(new Map<string, DemoZhiyuAgentClient>());
  const root = useRef<HTMLDivElement>(null);
  const client = useMemo(() => {
    if (mode !== 'agent' || !target) return null;
    let result = clients.current.get(target.id);
    if (!result) {
      result = createChatAgentClient(target, demo);
      clients.current.set(target.id, result);
    }
    return result;
  }, [mode, target, demo]);
  const messages = [...(baseMessages[targetId] ?? []), ...(localMessages[targetId] ?? [])];
  const copy = useMemo(() => ({ ...getMessageInteractionCopy(chat.dateLocale), ...chat.copy }), [chat]);
  const adapter = useMemo<ChatComposerAdapter<string>>(
    () => ({
      submit: ({ text }) => {
        onSubmit({ text, image, quote });
        setImage(undefined);
        setQuote(undefined);
      },
    }),
    [onSubmit, image, quote],
  );
  const formatDateLabel = useMemo(() => {
    const dateFormatter = new Intl.DateTimeFormat(chat.dateLocale, { month: 'long', day: 'numeric' });
    return ({ date, diffDays }: { date: Date; diffDays: number }) =>
      diffDays === 0
        ? chat.dateLabels.today
        : diffDays === 1
          ? chat.dateLabels.yesterday
          : dateFormatter.format(date);
  }, [chat]);
  const human = mode === 'human';
  const peers = human ? chat.people : chat.agents;
  const center = mode === 'ai' && messages.length === 0;
  const togglePanel = (next: Panel) => setPanel((current) => (current === next ? null : next));
  const simulatedDeviceNotice = () =>
    setNotice(
      t(
        '此处展示操作入口。语音、Avatar 和实际模型调用需在 Nimi Home 中使用。',
        'This previews the controls. Use Nimi Home for voice, Avatar, and live model calls.',
      ),
    );
  const openCenter = (next: AgentCenterSectionId) => {
    setSection(next);
    setPanel('agent-center');
  };
  const avatar = (person: HeroDemoAgent, size = '') =>
    person.id.startsWith('human:') ? (
      <DemoHumanAvatar person={person} className={size} />
    ) : (
      <DemoPartnerAvatar
        index={Math.max(0, chat.agents.indexOf(person))}
        name={person.name}
        src={person.avatarUrl}
      />
    );
  const peerCard = (
    person: HeroDemoAgent,
    placement: 'rail' | 'composer' | 'message',
    children: React.ReactElement,
  ) => {
    const character = exploreCharacters.find((item) => item.id === person.id);
    const isHuman = person.id.startsWith('human:');
    return (
      <DemoChatAvatarCard
        person={person}
        locale={demo.appPreview.locale}
        placement={placement}
        onSelect={() => onSelectTarget(targetId === person.id && !isHuman ? null : person.id)}
        onProfile={() =>
          isHuman
            ? (setProfilePerson(person), setPanel('identity'))
            : onNavigate('explore', `partner:${person.id}`)
        }
        onMemory={
          isHuman
            ? undefined
            : () => {
                requestedCenter.current = targetId === person.id ? null : person.id;
                onSelectTarget(person.id);
                openCenter('cognition');
              }
        }
        onWorld={character ? () => onNavigate('explore', `world:${character.worldId}`) : undefined}
      >
        {children}
      </DemoChatAvatarCard>
    );
  };
  const identity =
    target && mode !== 'ai'
      ? peerCard(
          target,
          'composer',
          <button
            type="button"
            className="demo-chat-composer-identity"
            aria-label={t(
              `查看${target.name}的${human ? '资料' : '伙伴资料'}`,
              `View ${target.name}'s profile`,
            )}
          >
            {avatar(target)}
            {human && <span>{target.name}</span>}
          </button>,
        )
      : null;
  const introduction =
    target && mode === 'agent' ? (
      <AgentIntroduction
        displayName={target.name}
        avatarUrl={target.avatarUrl}
        locale={chat.dateLocale}
        questionsEnabled
        onPrefill={(text) => onDraftChange(draft.trim() && draft !== text ? `${draft}\n${text}` : text)}
        imageMaxSize="clamp(160px, 30cqh, 320px)"
        introduction={target.introduction ?? {
          worldName: target.worldName ?? null,
          era: null,
          role: target.role ?? null,
          greeting: target.greeting ?? target.bio ?? null,
          referenceImageUrl: target.referenceImageUrl ?? target.avatarUrl ?? null,
          voiceSampleUrl: target.voiceUrl ?? null,
          voicePreviewUrl: target.voiceUrl ?? null,
          voiceSampleContentHash: null,
          voiceSampleMimeType: target.voiceUrl ? 'audio/mpeg' : null,
          voiceSampleDurationSec: target.voiceDuration ?? null,
          questionTopics: target.role
            ? [
                { kind: 'role', text: target.role },
                ...(target.name === '唐龙' ? [{ kind: 'topic' as const, text: '尚书' }] : []),
              ]
            : [],
        }}
      />
    ) : undefined;
  const composer = (
    <CanonicalComposer
      adapter={adapter}
      text={draft}
      onTextChange={onDraftChange}
      layout="stacked"
      copy={copy}
      disableFocusBorder
      placeholder={
        mode === 'ai'
          ? chat.inputPlaceholder
          : mode === 'agent'
            ? t('和这位伙伴聊点什么...', 'Chat with this companion...')
            : t('输入消息...', 'Type a message...')
      }
      sendLabel={chat.sendLabel}
      widthClassName={center ? 'w-full max-w-[560px]' : 'w-full max-w-[720px]'}
      className={center ? 'px-0 pb-0' : undefined}
      leadingSlot={identity}
      toolbarSlot={
        mode === 'agent' ? (
          <>
            <Tool label={t('录制语音消息', 'Record a voice message')} onClick={simulatedDeviceNotice}>
              <Mic size={16} />
            </Tool>
            <Tool
              label={t('设置伙伴形象', 'Set companion appearance')}
              onClick={() => openCenter('appearance')}
            >
              <UserRound size={16} />
            </Tool>
            <span className="demo-chat-tool-divider" />
            <Tool label={t('开始实时语音', 'Start realtime voice')} onClick={simulatedDeviceNotice}>
              <Headphones size={16} />
            </Tool>
            <Tool
              label={t('思考', 'Thinking')}
              active={Boolean(thinking[targetId])}
              onClick={() => setThinking((previous) => ({ ...previous, [targetId]: !previous[targetId] }))}
            >
              <Lightbulb size={16} />
            </Tool>
          </>
        ) : undefined
      }
      trailingSlot={
        mode === 'agent' ? (
          <Tool
            label={t('伙伴中心', 'Agent Center')}
            active={panel === 'agent-center'}
            onClick={() => (panel === 'agent-center' ? setPanel(null) : openCenter('overview'))}
          >
            <Settings2 size={16} />
          </Tool>
        ) : undefined
      }
      attachments={image ? [image] : []}
      onAttachmentsChange={(images) => setImage(images[0])}
      attachmentsSlot={() => null}
      attachmentAdapter={
        mode !== 'ai' ? { openPicker: async () => ['/demo/explore/thinink-plains-cover.webp'] } : undefined
      }
      attachLabel={human ? t('添加图片或视频', 'Add image or video') : t('添加图片', 'Attach image')}
      quoteSlot={
        quote || image ? (
          <div className="demo-chat-composer-context">
            {quote && (
              <blockquote>
                <strong>{quote.name}</strong>
                <p>{quote.text}</p>
                <button
                  type="button"
                  aria-label={t('取消引用', 'Remove quote')}
                  onClick={() => setQuote(undefined)}
                >
                  <X size={14} />
                </button>
              </blockquote>
            )}
            {image && (
              <div className="demo-chat-attachment">
                <img src={image} alt={t('演示图片', 'Sample image')} />
                <span>{t('演示图片 · 仅保留在本页', 'Sample image · This page only')}</span>
                <button
                  type="button"
                  aria-label={t('移除图片', 'Remove image')}
                  onClick={() => setImage(undefined)}
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>
        ) : undefined
      }
    />
  );

  return (
    <div
      ref={root}
      className="demo-chat-root"
      data-demo-chat-mode={mode}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setPanel(null);
          setNotice('');
        }
      }}
    >
      <main className={`demo-chat-main ${panel ? 'has-panel' : ''}`}>
        {human && !target ? (
          <DemoChatContacts
            key={targetId}
            demo={demo}
            baseMessages={baseMessages}
            localMessages={localMessages}
            initialTab={targetId === 'human:conversations' ? 'conversations' : 'friends'}
            onSelect={onSelectTarget}
          />
        ) : (
          <>
            <CanonicalTranscriptView
              key={targetId}
              messages={messages}
              activeConversationId={targetId}
              copy={copy}
              agentName={mode === 'ai' ? 'Nimi' : profileTarget?.name}
              agentAvatarUrl={target?.avatarUrl}
              emptyEyebrow=""
              emptyTitle={center ? chat.greeting : ''}
              emptyDescription=""
              emptyStateContent={center ? composer : introduction}
              formatDateLabel={formatDateLabel}
              widthClassName="w-full max-w-[720px]"
              widthPositionClassName="mx-auto"
              contentPaddingBottomClassName={center ? 'pb-6' : 'pb-[190px]'}
              renderMessageAvatar={
                human
                  ? (message, context) => (
                      <button
                        type="button"
                        aria-label={message.senderName ?? ''}
                        onClick={() => {
                          setProfilePerson(context.isCurrentUser ? chat.self : (target ?? null));
                          setPanel('identity');
                        }}
                      >
                        <DemoHumanAvatar
                          person={context.isCurrentUser ? chat.self : target!}
                          className="message-size"
                        />
                      </button>
                    )
                  : undefined
              }
              renderMessageContent={(message) => {
                const attachment = message.metadata?.demoImage as string | undefined;
                const quoted = message.metadata?.demoQuote as DemoChatSubmission['quote'];
                return attachment || quoted ? (
                  <div>
                    {quoted && (
                      <blockquote className="demo-chat-message-quote">
                        <strong>{quoted.name}</strong>
                        <p>{quoted.text}</p>
                      </blockquote>
                    )}
                    {attachment && (
                      <img
                        className="demo-chat-message-image"
                        src={attachment}
                        alt={t('演示图片', 'Sample image')}
                      />
                    )}
                    {message.text && <p className="whitespace-pre-wrap">{message.text}</p>}
                  </div>
                ) : undefined;
              }}
              messageActions={{
                scopeKey: targetId,
                onQuote: (message, selection) => {
                  setQuote({
                    id: message.id,
                    name: message.senderName ?? target?.name ?? 'Nimi',
                    text: selection?.text || message.text,
                  });
                  root.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
                },
                onReturnToComposer: () =>
                  root.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus(),
              }}
            />
            {!center && <div className="demo-chat-composer-dock">{composer}</div>}
          </>
        )}
        {notice && (
          <div className="demo-chat-notice" role="status">
            {notice}
            <button type="button" aria-label={t('关闭提示', 'Dismiss notice')} onClick={() => setNotice('')}>
              <X size={14} />
            </button>
          </div>
        )}
        <p className="demo-chat-footnote">
          {t(
            '演示对话 · 不发送给真实用户，不调用模型',
            'Demo conversation · No messages to real users or model calls',
          )}
        </p>
      </main>
      {panel === 'agent-center' && target && client ? (
        <DemoChatAgentCenter
          key={targetId}
          demo={demo}
          agent={target}
          client={client}
          section={section}
          onSection={setSection}
          onClose={() => setPanel(null)}
          onRuntime={() => onNavigate('runtime')}
          onNotice={() => {
            setPanel(null);
            simulatedDeviceNotice();
          }}
        />
      ) : panel ? (
        <aside className="demo-chat-sheet" data-demo-chat-panel={panel}>
          <header>
            <div>
              <h2>
                {panel === 'history'
                  ? 'Nimi'
                  : panel === 'settings'
                    ? t('AI 模型', 'AI model')
                    : profileTarget?.name}
              </h2>
              <small>
                {panel === 'history'
                  ? t(
                      `${chat.assistantThreads.length} 个对话`,
                      `${chat.assistantThreads.length} conversations`,
                    )
                  : panel === 'identity'
                    ? (profileTarget?.worldName ?? profileTarget?.handle)
                    : t('Nimi Chat 的专属配置', 'Configuration for Nimi Chat')}
              </small>
            </div>
            <Tool label={t('关闭面板', 'Close panel')} onClick={() => setPanel(null)}>
              <X size={17} />
            </Tool>
          </header>
          <div className="demo-chat-sheet-body">
            {panel === 'history' ? (
              chat.assistantThreads.map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  className="demo-chat-history-row"
                  aria-pressed={targetId === thread.id}
                  onClick={() => {
                    onSelectTarget(thread.id);
                    setPanel('history');
                  }}
                >
                  <strong>{thread.name}</strong>
                  <small>{t('今天', 'Today')}</small>
                </button>
              ))
            ) : panel === 'identity' && profileTarget ? (
              <div className="demo-chat-profile">
                {avatar(profileTarget)}
                <h2>{profileTarget.name}</h2>
                <p>{profileTarget.bio}</p>
                <DemoHumanProfileDetails person={profileTarget} locale={demo.appPreview.locale} />
                {mode === 'agent' ? (
                  <Button tone="primary" size="sm" onClick={() => openCenter('overview')}>
                    {t('伙伴中心', 'Agent Center')}
                  </Button>
                ) : (
                  <span className="demo-success">
                    {profileTarget.id === chat.self.id
                      ? t('当前演示账号', 'Current demo account')
                      : t('好友 · 演示联系人', 'Friend · Demo contact')}
                  </span>
                )}
              </div>
            ) : (
              <>
                <div className="demo-management-card">
                  <h3>{t('文本生成', 'Text generation')}</h3>
                  <div className="demo-setting-row">
                    <span>{t('当前模型', 'Current model')}</span>
                    <strong>Gemma 4</strong>
                  </div>
                  <p className="demo-muted">
                    {t('使用本机已准备的配置。', 'Uses the prepared local configuration.')}
                  </p>
                  <Button tone="secondary" size="sm" className="mt-4" onClick={() => onNavigate('runtime')}>
                    {t('查看本机配置', 'View local configuration')}
                  </Button>
                </div>
                <Button tone="ghost" size="sm" className="mt-4" onClick={() => onNavigate('cloud')}>
                  {t('配置云服务', 'Configure cloud services')}
                </Button>
              </>
            )}
          </div>
          {panel === 'history' && (
            <footer>
              <Button tone="primary" fullWidth onClick={onCreateThread}>
                <Plus size={15} />
                {t('新对话', 'New conversation')}
              </Button>
            </footer>
          )}
        </aside>
      ) : null}
      <aside className="demo-chat-relationship-rail" aria-label={t('聊天对象', 'Conversation targets')}>
        <div className="demo-chat-side-toggle">
          <Tool
            label={
              human ? t('切换到 AI 伙伴', 'Switch to AI companions') : t('切换到好友', 'Switch to friends')
            }
            onClick={() => onSwitchSide(human ? null : 'human:conversations')}
          >
            <Rotate3d size={29} strokeWidth={1.55} />
          </Tool>
          <span>{human ? t('好友', 'Friends') : t('AI 伙伴', 'AI companions')}</span>
        </div>
        <div className="demo-chat-peer-list">
          {peers.map((person) => (
            <div key={person.id}>
              {peerCard(
                person,
                'rail',
                <button
                  type="button"
                  className="demo-chat-peer"
                  aria-label={person.name}
                  aria-pressed={targetId === person.id}
                >
                  {avatar(person)}
                </button>,
              )}
            </div>
          ))}
        </div>
        {(human || mode === 'ai') && (
          <footer>
            {human ? (
              <>
                <Tool
                  label={t('联系人', 'Contacts')}
                  active={!target}
                  onClick={() => onSelectTarget('human:contacts')}
                >
                  <ContactRound size={21} />
                </Tool>
                <span>{t('联系人', 'Contacts')}</span>
              </>
            ) : (
              <>
                <Tool
                  label={t('对话历史', 'Conversation history')}
                  active={panel === 'history'}
                  onClick={() => togglePanel('history')}
                >
                  <History size={19} />
                </Tool>
                <Tool
                  label={t('聊天设置', 'Chat settings')}
                  active={panel === 'settings'}
                  onClick={() => togglePanel('settings')}
                >
                  <Settings2 size={19} />
                </Tool>
              </>
            )}
          </footer>
        )}
      </aside>
    </div>
  );
}
