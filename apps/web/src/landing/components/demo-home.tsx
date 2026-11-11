import { useState, type MouseEventHandler, type Ref } from 'react';
import { ArrowRight, ChevronRight, Cpu, Filter, Send } from 'lucide-react';
import { Button } from '@nimiplatform/kit/ui';
import type { HeroDemo, HeroDemoSurface } from '../content/landing-content.js';
import type { DemoHomeMessage } from '../content/home-demo-content.js';
import { AppArtworkIcon } from './demo-apps.js';
import { DemoPartnerAvatar, DemoSectionTitle, DemoServiceIcon, demoText } from './demo-home-ui.js';

export type DemoNavigate = (surface: HeroDemoSurface, target?: string) => void;
export type DemoMessageProps = {
  demo: HeroDemo;
  messages: DemoHomeMessage[];
  onNavigate: DemoNavigate;
  onRead: (id: string) => void;
  onHide: (id: string) => void;
};

// @nimi-authority: rule.nimi.desktop.product-surfaces.r015
export function DemoHomeSurface({
  demo,
  messages,
  onNavigate,
  onRead,
  onHide,
  onReply,
  onOpenChat,
  openChatRef,
}: DemoMessageProps & {
  onReply: (agentId: string, text: string) => void;
  onOpenChat: MouseEventHandler<HTMLButtonElement>;
  openChatRef?: Ref<HTMLButtonElement>;
}) {
  const c = demo.home;
  const t = demoText(demo);
  const [selectedId, setSelectedId] = useState(demo.chat.agents[0]!.id);
  const [draft, setDraft] = useState('');
  const [guide, setGuide] = useState(true);
  const partner = demo.chat.agents.find((agent) => agent.id === selectedId)!;
  return (
    <div className="demo-home" data-demo-home>
      <div className="demo-home-grid">
        <header className="demo-home-heading">
          <h1>{c.greeting}</h1>
          <span>{c.date}</span>
        </header>
        <section className="demo-recent demo-home-card">
          <DemoSectionTitle title={c.recent} action={c.allChats} onAction={() => onNavigate('chat')} />
          <div className="demo-partner-strip">
            {demo.chat.agents.map((agent, index) => (
              <button
                type="button"
                key={agent.id}
                aria-label={agent.name}
                aria-pressed={agent.id === selectedId}
                onClick={() => {
                  setSelectedId(agent.id);
                  setDraft('');
                }}
              >
                <DemoPartnerAvatar index={index} name={agent.name} src={agent.avatarUrl} />
                <span>{agent.name.split(' ')[0]}</span>
              </button>
            ))}
          </div>
          <div className="demo-mini-chat">
            <button type="button" onClick={() => onNavigate('chat', partner.id)}>
              <strong>
                {partner.name}
                <time>14:25</time>
              </strong>
              <span>{partner.messages.at(-1)?.text ?? t('开始一段对话', 'Start a conversation')}</span>
            </button>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                onReply(partner.id, draft.trim());
              }}
            >
              <input
                aria-label={t(`回复 ${partner.name}`, `Reply to ${partner.name}`)}
                placeholder={t(`回复 ${partner.name.split(' ')[0]}…`, `Reply to ${partner.name}…`)}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <button type="submit" aria-label={demo.chat.sendLabel}>
                <Send size={15} />
              </button>
            </form>
          </div>
        </section>
        <div className="demo-home-main">
          <section className="demo-home-card">
            <DemoSectionTitle title={c.myApps} action={c.allApps} onAction={() => onNavigate('apps')} />
            <div className="demo-home-apps">
              {demo.apps.items.slice(0, 6).map((app) => (
                <button type="button" key={app.id} onClick={() => onNavigate('apps', app.id)}>
                  <AppArtworkIcon item={app} size="lg" />
                  <span>{app.name}</span>
                </button>
              ))}
            </div>
          </section>
          <section className="demo-home-card">
            <DemoSectionTitle
              title={c.start}
              action={guide ? c.collapse : c.expand}
              onAction={() => setGuide(!guide)}
            />
            {guide && (
              <>
                <p className="demo-muted my-3">{c.startBody}</p>
                <div className="demo-actions">
                  <Button ref={openChatRef} className="demo-home-open-chat" tone="primary" size="sm" onClick={onOpenChat}>
                    {c.openChat}
                    <ArrowRight size={14} />
                  </Button>
                  <Button size="sm" tone="secondary" onClick={() => onNavigate('explore')}>
                    {c.explore}
                  </Button>
                  <Button size="sm" tone="ghost" onClick={() => onNavigate('runtime')}>
                    {c.localAI}
                  </Button>
                  <Button size="sm" tone="ghost" onClick={() => onNavigate('cloud')}>
                    {c.cloudAI}
                  </Button>
                </div>
              </>
            )}
          </section>
          <section className="demo-home-card">
            <DemoSectionTitle
              title={demo.nav.integrations}
              action={t('进入集成', 'Open integrations')}
              onAction={() => onNavigate('integrations')}
            />
            <div className="demo-home-services">
              {c.integrations.slice(0, 6).map((item) => (
                <button type="button" key={item.id} onClick={() => onNavigate('integrations', item.id)}>
                  <DemoServiceIcon id={item.id} large />
                  <strong>{item.name}</strong>
                  <small>
                    {item.connections
                      ? t(`${item.connections} 个连接`, `${item.connections} connection`)
                      : t('未连接', 'Not connected')}
                  </small>
                </button>
              ))}
            </div>
          </section>
        </div>
        <aside className="demo-home-messages">
          <DemoMessages
            demo={demo}
            messages={messages}
            onNavigate={onNavigate}
            onRead={onRead}
            onHide={onHide}
          />
        </aside>
      </div>
      <footer className="demo-home-status">
        <span>
          <i className="demo-status-dot" />
          {c.runtimeOK}
        </span>
        <button type="button" onClick={() => onNavigate('runtime')}>
          {c.capabilitiesReady}
          <ChevronRight size={13} />
        </button>
        <span className="demo-machine-metrics">
          <Cpu size={13} /> CPU 8% · {t('内存', 'Memory')} 42%
        </span>
        <button type="button" onClick={() => onNavigate('diagnostics')}>
          {c.diagnostics}
        </button>
      </footer>
    </div>
  );
}

export function DemoMessages({
  demo,
  messages,
  onNavigate,
  onRead,
  onHide,
  full = false,
}: DemoMessageProps & { full?: boolean }) {
  const c = demo.home;
  const [filter, setFilter] = useState('all');
  const [source, setSource] = useState('all');
  const [showFilters, setShowFilters] = useState(full);
  const pending = messages.filter((item) => item.pending).length;
  const visible = messages.filter(
    (item) =>
      (filter === 'all' || (filter === 'unread' ? item.unread : item.pending)) &&
      (source === 'all' || item.source === source),
  );
  return (
    <div className={full ? 'demo-message-center' : 'demo-message-column'}>
      <header className="demo-section-title">
        <h2>{full ? demo.nav.messages : c.messages}</h2>
        {pending > 0 && (
          <span className="demo-pending">
            {c.pending} {pending}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {!full && (
            <Button size="sm" tone="ghost" onClick={() => onNavigate('messages')}>
              {c.more}
            </Button>
          )}
          <button
            type="button"
            className="demo-icon-button"
            aria-label={c.sources}
            aria-expanded={showFilters}
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter size={16} />
          </button>
        </div>
      </header>
      {showFilters && (
        <div className="demo-message-filters">
          <div className="demo-tabs">
            {(['all', 'unread', 'pending'] as const).map((id) => (
              <button type="button" key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>
                {c[id]}
              </button>
            ))}
          </div>
          <select aria-label={c.sources} value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="all">{c.sources}</option>
            {[...new Set(messages.map((item) => item.source))].map((label) => (
              <option key={label}>{label}</option>
            ))}
          </select>
        </div>
      )}
      <div className="demo-message-list">
        {visible.map((item) => {
          const app = demo.apps.items.find((app) => app.id === item.appId);
          return (
            <article key={item.id} className="demo-message-card">
              <div className="demo-message-art">
                {app ? <AppArtworkIcon item={app} size="xs" /> : <Cpu size={22} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="demo-muted">
                  {item.unread && <i className="demo-unread-dot" />}
                  {item.source}
                </p>
                <div className="flex items-baseline justify-between gap-2">
                  <h3>{item.title}</h3>
                  <time>{item.time}</time>
                </div>
                <p className="demo-muted mt-1">{item.detail}</p>
                {item.pending && <span className="demo-pending">{c.pending}</span>}
                <div className="demo-message-actions">
                  {item.unread && (
                    <button type="button" onClick={() => onRead(item.id)}>
                      {c.read}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      onRead(item.id);
                      onNavigate(item.destination, item.appId ?? undefined);
                    }}
                  >
                    {c.open}
                  </button>
                  {full && (
                    <button type="button" onClick={() => onHide(item.id)}>
                      {c.hide}
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
        {visible.length === 0 && <p className="demo-empty">{c.empty}</p>}
      </div>
      {full && (
        <Button tone="ghost" size="sm" onClick={() => onNavigate('settings', 'notifications')}>
          {c.messageSettings}
        </Button>
      )}
    </div>
  );
}
