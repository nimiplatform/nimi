import { DemoHumanAvatar } from './demo-human-profile.js';
import type { ConversationCanonicalMessage } from '@nimiplatform/kit/features/chat/types';
import type { HeroDemoAgent } from '../content/landing-content.js';
import { useState } from 'react';
import { Button, SearchField } from '@nimiplatform/kit/ui';
import { ArrowLeft, MessageCircle, UserPlus, Inbox } from 'lucide-react';
import type { HeroDemo } from '../content/landing-content.js';
import { demoText } from './demo-home-ui.js';

export function DemoChatContacts({
  demo,
  onSelect,
  initialTab = 'friends',
  baseMessages,
  localMessages,
}: {
  demo: HeroDemo;
  initialTab?: 'friends' | 'conversations';
  baseMessages: DemoHumanMessages;
  localMessages: DemoHumanMessages;
  onSelect: (id: string) => void;
}) {
  const t = demoText(demo);
  const [tab, setTab] = useState<string>(initialTab);
  const [query, setQuery] = useState('');
  const [lookup, setLookup] = useState(false);
  const rows = demoHumanConversationRows(demo.chat.people, baseMessages, localMessages).filter(
    ({ person, latest }) =>
      (tab !== 'conversations' || latest) &&
      `${person.name} ${person.handle}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const time = new Intl.DateTimeFormat(demo.chat.dateLocale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return (
    <div className="demo-chat-contacts-scroll">
      <section className="demo-chat-contacts">
        <header>
          <h1>{tab === 'conversations' ? t('会话', 'Conversations') : t('联系人', 'Contacts')}</h1>
          <Button size="sm" tone="primary" onClick={() => setLookup(!lookup)}>
            <UserPlus size={16} />
            {t('添加好友', 'Add friend')}
          </Button>
        </header>
        {lookup ? (
          <div className="demo-chat-contact-lookup">
            <SearchField
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={t('用户名', 'Username')}
              placeholder="@lin.demo"
            />
            <p className="demo-muted">
              {t(
                '可搜索本页的演示联系人；不会向真实账号发送申请。',
                'Search this page’s demo contacts. No request is sent to a real account.',
              )}
            </p>
          </div>
        ) : null}
        <div className="demo-chat-contact-tabs">
          <div className="demo-tabs">
            {[
              ['conversations', t('会话', 'Conversations')],
              ['friends', t('好友', 'Friends')],
            ].map(([id, label]) => (
              <button type="button" key={id} aria-pressed={tab === id} onClick={() => setTab(id!)}>
                {label}
                {id === 'friends' ? ` ${demo.chat.people.length}` : ''}
              </button>
            ))}
          </div>
          <Button tone="ghost" size="sm" onClick={() => setTab('received')}>
            <Inbox size={15} />
            {t('好友申请', 'Requests')}
          </Button>
        </div>
        <div className="demo-chat-contact-body">
          {tab === 'received' ? (
            <>
              <Button tone="ghost" size="sm" onClick={() => setTab('friends')}>
                <ArrowLeft size={14} />
                {t('好友', 'Friends')}
              </Button>
              <p className="demo-empty">{t('暂无好友申请', 'No friend requests')}</p>
            </>
          ) : (
            <>
              {tab === 'friends' && (
                <SearchField
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('搜索好友', 'Search friends')}
                  aria-label={t('搜索好友', 'Search friends')}
                />
              )}
              {rows.map(({ person, latest }) => (
                <div key={person.id} className="demo-chat-contact-row">
                  <button type="button" onClick={() => onSelect(person.id)}>
                    <DemoHumanAvatar person={person} />
                    <span>
                      <strong>{person.name}</strong>
                      <small>
                        {tab === 'conversations'
                          ? t('打开后查看消息内容', 'Open to view messages')
                          : person.handle}
                      </small>
                    </span>
                  </button>
                  {tab === 'friends' ? (
                    <Button size="sm" tone="ghost" onClick={() => onSelect(person.id)}>
                      <MessageCircle size={16} />
                      {t('发消息', 'Message')}
                    </Button>
                  ) : (
                    <time className="demo-muted demo-contact-time" dateTime={latest?.createdAt}>
                      {latest ? time.format(new Date(latest.createdAt)) : ''}
                    </time>
                  )}
                </div>
              ))}
              {!rows.length && <p className="demo-empty">{t('没有匹配的好友', 'No matching friends')}</p>}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

type DemoHumanMessages = Readonly<Record<string, readonly ConversationCanonicalMessage[]>>;

export function demoHumanConversationRows(
  people: readonly HeroDemoAgent[],
  base: DemoHumanMessages,
  local: DemoHumanMessages,
) {
  return people
    .map((person) => ({ person, latest: local[person.id]?.at(-1) ?? base[person.id]?.at(-1) }))
    .sort(
      (a, b) =>
        (b.latest ? Date.parse(b.latest.createdAt) : 0) - (a.latest ? Date.parse(a.latest.createdAt) : 0),
    );
}
