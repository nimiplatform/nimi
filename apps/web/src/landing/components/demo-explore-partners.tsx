import { useState } from 'react';
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Ellipsis } from 'lucide-react';
import { Button, SearchField } from '@nimiplatform/kit/ui';
import type { HeroDemo } from '../content/landing-content.js';
import type { ExploreCharacter } from '../content/explore-demo-data.js';
import { demoText } from './demo-home-ui.js';

// @nimi-authority: rule.nimi.desktop.product-surfaces.partners
export function DemoExplorePartners({
  demo,
  characters,
  selectedId,
  onSelect,
  onBack,
  onChat,
  onWorld,
}: {
  demo: HeroDemo;
  characters: ExploreCharacter[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onBack: () => void;
  onChat: (character: ExploreCharacter) => void;
  onWorld: (id: string) => void;
}) {
  const t = demoText(demo);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('newest');
  const [menu, setMenu] = useState<string | null>(null);
  const selected = characters.find((person) => person.id === selectedId);
  const featured = characters[index % characters.length]!;
  const searched = characters.filter((person) =>
    person.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const visible = (
    filter === 'created'
      ? []
      : filter === 'recent'
        ? searched.filter((person) => demo.chat.agents.some((agent) => agent.id === person.id))
        : searched
  ).slice();
  if (sort === 'name') visible.sort((a, b) => a.name.localeCompare(b.name, demo.chat.dateLocale));
  if (sort === 'oldest') visible.reverse();
  const openMenu = (person: ExploreCharacter) => (
    <div className="demo-explore-partner-menu-wrap">
      <button
        type="button"
        className="demo-explore-partner-more"
        aria-label={t(`${person.name}的更多操作`, `More actions for ${person.name}`)}
        aria-expanded={menu === person.id}
        onClick={() => setMenu(menu === person.id ? null : person.id)}
      >
        <Ellipsis size={18} />
      </button>
      {menu === person.id && (
        <div className="demo-explore-partner-action-list">
          <button
            type="button"
            onClick={() => {
              setMenu(null);
              onSelect(person.id);
            }}
          >
            {t('查看详情', 'View details')}
          </button>
          <button type="button" onClick={() => onChat(person)}>
            {t('开始聊天', 'Start chatting')}
          </button>
          <button type="button" onClick={() => onWorld(person.worldId)}>
            {t('查看所在世界', 'View world')}
          </button>
        </div>
      )}
    </div>
  );
  return (
    <div className={`demo-explore-partner-directory ${selected ? 'has-selection' : ''}`}>
      <aside className="demo-explore-partner-sidebar">
        <header>
          <h2>{t('我的伙伴', 'My companions')}</h2>
          <SearchField
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('找一位伙伴', 'Find a companion')}
            aria-label={t('找一位伙伴', 'Find a companion')}
          />
        </header>
        <div className="demo-explore-scroll">
          {searched.map((person) => (
            <button
              type="button"
              key={person.id}
              className="demo-explore-partner-directory-row"
              aria-current={selectedId === person.id ? 'true' : undefined}
              onClick={() => onSelect(person.id)}
            >
              <img src={person.image} alt="" />
              <span>
                <strong>{person.name}</strong>
                <small>{person.bio}</small>
              </span>
            </button>
          ))}
          {!searched.length && <p className="demo-empty">{t('没有匹配的伙伴', 'No matching companions')}</p>}
        </div>
      </aside>
      {selected ? (
        <div className="demo-explore-partner-detail demo-explore-scroll">
          <Button tone="ghost" size="sm" onClick={onBack}>
            <ArrowLeft size={15} />
            {t('返回伙伴列表', 'Back to companions')}
          </Button>
          <div className="demo-explore-character-detail">
            <img className="demo-explore-portrait" src={selected.image} alt={selected.name} />
            <section>
              <h1>{selected.name}</h1>
              <button
                type="button"
                className="demo-explore-world-link"
                onClick={() => onWorld(selected.worldId)}
              >
                {t('来自', 'From')} {selected.worldName}
                <ArrowRight size={14} />
              </button>
              <p className="demo-muted">{selected.meta}</p>
              <p className="demo-explore-original-copy">{selected.bio}</p>
              <Button tone="primary" onClick={() => onChat(selected)}>
                {t('开始聊天', 'Start chatting')}
                <ArrowRight size={16} />
              </Button>
              <p className="demo-simulation-note">{demo.home.badge}</p>
            </section>
          </div>
        </div>
      ) : (
        <div className="demo-explore-scroll demo-explore-partner-gallery-wrap">
          <div className="demo-explore-partner-gallery">
            {!query && filter === 'all' && (
              <section className="demo-explore-partner-hero">
                <button
                  type="button"
                  className="demo-explore-partner-hero-image"
                  onClick={() => onSelect(featured.id)}
                >
                  <img className="demo-explore-partner-artwork" src={featured.image} alt={featured.name} />
                </button>
                <div className="demo-explore-partner-hero-copy">
                  <span className="demo-explore-partner-hero-kicker">
                    {t('最近的伙伴', 'Recent companions')}
                  </span>
                  <h2>
                    <button type="button" onClick={() => onSelect(featured.id)}>
                      {featured.name}
                    </button>
                  </h2>
                  <p className="demo-explore-partner-hero-world">
                    {t('来自', 'From')} {featured.worldName}
                  </p>
                  <p className="demo-explore-partner-hero-description">{featured.bio}</p>
                  <div className="demo-explore-partner-hero-actions">
                    <Button
                      tone="primary"
                      className="demo-explore-partner-chat-button"
                      onClick={() => onChat(featured)}
                    >
                      {t('开始聊天', 'Start chatting')}
                      <ArrowRight size={17} />
                    </Button>
                    {openMenu(featured)}
                  </div>
                </div>
                <div className="demo-explore-partner-hero-dots">
                  {characters.map((person, i) => (
                    <button
                      type="button"
                      key={person.id}
                      aria-label={t(`展示${person.name}`, `Show ${person.name}`)}
                      aria-current={index === i ? 'true' : undefined}
                      onClick={() => setIndex(i)}
                    >
                      <span />
                    </button>
                  ))}
                </div>
                <div className="demo-explore-partner-hero-arrows">
                  <button
                    type="button"
                    aria-label={t('上一位伙伴', 'Previous companion')}
                    onClick={() => setIndex((index + characters.length - 1) % characters.length)}
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    type="button"
                    aria-label={t('下一位伙伴', 'Next companion')}
                    onClick={() => setIndex((index + 1) % characters.length)}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </section>
            )}
            <section className="demo-explore-partner-collection">
              <div className="demo-explore-partner-collection-toolbar">
                <h2>{t('我的伙伴', 'My companions')}</h2>
                <div className="demo-explore-partner-gallery-filters">
                  {[
                    ['all', t('全部', 'All')],
                    ['world', t('来自世界', 'From worlds')],
                    ['recent', t('最近聊天', 'Recent chats')],
                    ['created', t('我创建的', 'Created by me')],
                  ].map(([id, label]) => (
                    <button
                      type="button"
                      key={id}
                      aria-pressed={filter === id}
                      onClick={() => setFilter(id!)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <select
                  aria-label={t('排序', 'Sort')}
                  value={sort}
                  onChange={(event) => setSort(event.target.value)}
                >
                  <option value="newest">{t('最近创建', 'Newest first')}</option>
                  <option value="oldest">{t('最早创建', 'Oldest first')}</option>
                  <option value="name">{t('按名称', 'By name')}</option>
                </select>
              </div>
              <div className="demo-explore-partner-gallery-grid">
                {visible.map((person) => (
                  <article key={person.id} className="demo-explore-partner-card">
                    <button
                      type="button"
                      className="demo-explore-partner-card-open"
                      onClick={() => onSelect(person.id)}
                    >
                      <span className="demo-explore-partner-card-image">
                        <img className="demo-explore-partner-artwork" src={person.image} alt={person.name} />
                      </span>
                      <span className="demo-explore-partner-card-copy">
                        <strong className="demo-explore-partner-card-name">{person.name}</strong>
                        <span className="demo-explore-partner-card-world">
                          {t('来自', 'From')} {person.worldName}
                        </span>
                      </span>
                    </button>
                    <div className="demo-explore-partner-card-actions">{openMenu(person)}</div>
                  </article>
                ))}
              </div>
              {!visible.length && (
                <p className="demo-empty">{t('暂无符合条件的伙伴', 'No companions match this filter')}</p>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
