import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Compass,
  Grid2X2,
  Globe,
  House,
  Landmark,
  Leaf,
  Orbit,
  Sparkles,
  Users,
} from 'lucide-react';
import { Button, SearchField } from '@nimiplatform/kit/ui';
import type { HeroDemo } from '../content/landing-content.js';
import { exploreWorlds, exploreCharacters, type ExploreCharacter } from '../content/explore-demo-data.js';
import type { DemoNavigate } from './demo-home.js';
import { demoText } from './demo-home-ui.js';
import { DemoExplorePartners } from './demo-explore-partners.js';

export const exploreTopics = [
  { id: 'history', zh: '历史长卷', en: 'History', icon: Landmark },
  { id: 'everyday', zh: '市井日常', en: 'Everyday life', icon: House },
  { id: 'fantasy', zh: '奇幻异域', en: 'Fantasy', icon: Sparkles },
  { id: 'future', zh: '未来远方', en: 'Distant futures', icon: Orbit },
  { id: 'ecology', zh: '山海共生', en: 'Living worlds', icon: Leaf },
  { id: 'journey', zh: '远行与生存', en: 'Journeys & survival', icon: Compass },
];

export function filterExploreWorlds(query: string, topic: string, favorites: readonly string[]) {
  const text = query.trim().toLocaleLowerCase();
  return exploreWorlds.filter(
    (world) =>
      (!text || `${world.name} ${world.description} ${world.summary}`.toLocaleLowerCase().includes(text)) &&
      (!topic || (topic === 'favorites' ? favorites.includes(world.id) : world.topics.includes(topic))),
  );
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r002
// @nimi-authority: rule.nimi.desktop.product-surfaces.r003
export function DemoExploreSurface({
  demo,
  target,
  onNavigate,
  onAddPartner,
  onChat,
}: {
  demo: HeroDemo;
  target?: string;
  onNavigate: DemoNavigate;
  onAddPartner: (character: ExploreCharacter) => void;
  onChat: (character: ExploreCharacter) => void;
}) {
  const t = demoText(demo);
  const [query, setQuery] = useState('');
  const [characterQuery, setCharacterQuery] = useState('');
  const [topic, setTopic] = useState('');
  const [selected, setSelected] = useState(0);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const [peopleQuery, setPeopleQuery] = useState('');
  const featured = exploreWorlds.filter((world) => world.featured);
  const spotlight = featured[selected]!;
  const world = target?.startsWith('world:')
    ? exploreWorlds.find((world) => world.id === target.slice(6))
    : undefined;
  const character = target?.startsWith('character:')
    ? exploreCharacters.find((character) => character.id === target.slice(10))
    : undefined;
  const partners = target === 'partners' || target?.startsWith('partner:');
  const discovering = target === 'characters';
  const browse = !query.trim() && !topic;
  const results = filterExploreWorlds(query, topic, favorites).filter((world) => !browse || !world.featured);
  const openWorld = (id: string) => {
    setReading(false);
    setPeopleQuery('');
    onNavigate('explore', `world:${id}`);
  };
  const openCharacter = (id: string) => onNavigate('explore', `character:${id}`);
  const initialPartners = [exploreCharacters[1]!, exploreCharacters[2]!, exploreCharacters[9]!];
  const owned = exploreCharacters.filter(
    (character) =>
      initialPartners.some((item) => item.id === character.id) ||
      demo.chat.agents.some((agent) => agent.id === character.id),
  );
  const nav = (
    <nav className="demo-explore-tabs" aria-label={t('探索分区', 'Explore sections')}>
      <button type="button" role="tab" aria-selected={!partners} onClick={() => onNavigate('explore')}>
        <Globe size={16} />
        {t('世界', 'Worlds')}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={Boolean(partners)}
        onClick={() => onNavigate('explore', 'partners')}
      >
        <Users size={16} />
        {t('我的伙伴', 'My companions')}
      </button>
    </nav>
  );
  const back = (action: () => void) => (
    <Button tone="ghost" size="sm" onClick={action}>
      <ArrowLeft size={15} />
      {demo.home.back}
    </Button>
  );

  if (character)
    return (
      <div className="demo-explore-detail-scroll">
        {back(() => openWorld(character.worldId))}
        <div className="demo-explore-character-detail" data-tour-anchor="character">
          <img className="demo-explore-portrait" src={character.image} alt={character.name} />
          <section>
            <button
              type="button"
              className="demo-explore-world-link"
              onClick={() => openWorld(character.worldId)}
            >
              {t('所在世界', 'World')} · {character.worldName}
              <ArrowRight size={15} />
            </button>
            <h1>{character.name}</h1>
            <p className="demo-muted">{character.meta}</p>
            <Button
              tone="primary"
              onClick={() => {
                onAddPartner(character);
                onNavigate('explore', `partner:${character.id}`);
              }}
            >
              {owned.some((item) => item.id === character.id)
                ? t('查看伙伴', 'View companion')
                : t('添加为伙伴', 'Add as companion')}
            </Button>
            <h2>{t(`关于${character.name}`, `About ${character.name}`)}</h2>
            <p className="demo-explore-original-copy">{character.bio}</p>
            <p className="demo-simulation-note">
              {t(
                '角色资料来自 Nimi Home；添加与聊天仅在本页演示中生效。',
                'Character content comes from Nimi Home. Adding and chatting only affect this page’s demo.',
              )}
            </p>
          </section>
        </div>
      </div>
    );

  if (world)
    return (
      <div className="demo-explore-detail-scroll">
        {back(() => onNavigate('explore'))}
        <section className="demo-explore-world-overview">
          <div>
            <p className="demo-explore-overline">
              {world.topics
                .map((id) => {
                  const item = exploreTopics.find((item) => item.id === id)!;
                  return t(item.zh, item.en);
                })
                .join(' · ')}
            </p>
            <h1>{world.name}</h1>
            <p className="demo-explore-original-copy">{world.summary}</p>
          </div>
          <div className="demo-explore-detail-art" data-tour-anchor="world">
            <img src={world.image} alt={world.name} />
            <button
              type="button"
              className="demo-explore-bookmark"
              aria-label={t('收藏世界', 'Save world')}
              aria-pressed={favorites.includes(world.id)}
              onClick={() =>
                setFavorites((previous) =>
                  previous.includes(world.id)
                    ? previous.filter((id) => id !== world.id)
                    : [...previous, world.id],
                )
              }
            >
              <Bookmark size={19} fill={favorites.includes(world.id) ? 'currentColor' : 'none'} />
            </button>
          </div>
        </section>
        <section className="demo-explore-world-story">
          {world.illustration && (
            <img src={world.illustration} alt={t(`${world.name}的插画`, `${world.name} illustration`)} />
          )}
          <div>
            <p className="demo-explore-overline">{t('世界设定', 'World setting')}</p>
            <div className={`demo-explore-original-copy ${reading ? '' : 'demo-explore-excerpt'}`}>
              {world.story.split('\n\n').map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
            <button type="button" className="demo-explore-world-link" onClick={() => setReading(!reading)}>
              {reading ? t('收起', 'Show less') : t('阅读设定节选', 'Read setting excerpt')}
              <ArrowRight size={16} />
            </button>
          </div>
        </section>
        <section>
          <header className="demo-explore-people-heading">
            <h2>
              {t('这个世界的人物', 'People of this world')}{' '}
              <small>
                {t(`精选 ${world.people.length} 位人物`, `${world.people.length} selected characters`)}
              </small>
            </h2>
            <SearchField
              aria-label={t('搜索人物', 'Search people')}
              placeholder={t('搜索人物…', 'Search people…')}
              value={peopleQuery}
              onChange={(event) => setPeopleQuery(event.target.value)}
            />
          </header>
          <div className="demo-explore-people-grid">
            {world.people
              .filter((person) => `${person.name} ${person.bio}`.includes(peopleQuery.trim()))
              .map((person) => (
                <button key={person.id} type="button" onClick={() => openCharacter(person.id)}>
                  <img src={person.image} alt={person.name} />
                  <div>
                    <h3>
                      {person.name}
                      <ArrowRight size={17} />
                    </h3>
                    <small>{person.meta}</small>
                    <p>{person.bio}</p>
                  </div>
                </button>
              ))}
          </div>
        </section>
      </div>
    );

  if (partners)
    return (
      <div className="demo-explore-root">
        <header className="demo-explore-header">{nav}</header>
        <DemoExplorePartners
          demo={demo}
          characters={owned}
          selectedId={target?.startsWith('partner:') ? target.slice(8) : undefined}
          onSelect={(id) => onNavigate('explore', `partner:${id}`)}
          onBack={() => onNavigate('explore', 'partners')}
          onChat={onChat}
          onWorld={openWorld}
        />
      </div>
    );

  if (discovering) {
    const people = exploreCharacters.filter((person) =>
      `${person.name} ${person.worldName} ${person.bio}`
        .toLocaleLowerCase()
        .includes(characterQuery.trim().toLocaleLowerCase()),
    );
    return (
      <div className="demo-explore-root">
        <header className="demo-explore-header">{nav}</header>
        <div className="demo-explore-character-discovery">
          <header>
            <h1>{t('寻找角色', 'Find characters')}</h1>
            <SearchField
              aria-label={t('搜索角色', 'Search characters')}
              placeholder={t('搜索角色…', 'Search characters…')}
              value={characterQuery}
              onChange={(event) => setCharacterQuery(event.target.value)}
            />
          </header>
          <div className="demo-explore-character-results">
            {people.map((person) => (
              <button type="button" key={person.id} onClick={() => openCharacter(person.id)}>
                <img src={person.image} alt="" />
                <span>
                  <strong>{person.name}</strong>
                  <small>{person.worldName}</small>
                  <p>{person.bio}</p>
                </span>
              </button>
            ))}
          </div>
          {!people.length && <p className="demo-empty">{t('没有找到相关角色', 'No matching characters')}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="demo-world-atlas demo-explore-root">
      <header className="demo-world-atlas-header demo-world-atlas-header-combined">
        <div className="demo-world-atlas-title">
          {nav}
          <span className="demo-world-atlas-count">
            {t(`${exploreWorlds.length} 个世界`, `${exploreWorlds.length} worlds`)}
          </span>
        </div>
        <div className="demo-world-atlas-tools">
          <SearchField
            className="demo-world-atlas-search"
            aria-label={t('搜索世界', 'Search worlds')}
            placeholder={t('搜索世界…', 'Search worlds…')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery('')}
            clearLabel={t('清除', 'Clear')}
          />
          <Button tone="ghost" size="sm" onClick={() => onNavigate('explore', 'characters')}>
            <Users size={17} />
            {t('发现伙伴', 'Discover companions')}
          </Button>
        </div>
      </header>
      <div className="demo-explore-scroll">
        <div className="demo-world-atlas-body">
          {browse && (
            <section
              className="demo-world-atlas-hero"
              aria-label={t('世界一瞥', 'World spotlight')}
              aria-roledescription={t('轮播', 'Carousel')}
            >
              <div className="demo-world-atlas-hero-art">
                <button
                  type="button"
                  className="demo-world-atlas-hero-open"
                  aria-label={t(`查看${spotlight.name}`, `View ${spotlight.name}`)}
                  onClick={() => openWorld(spotlight.id)}
                >
                  <span className="demo-world-atlas-image">
                    <img src={spotlight.image} alt={spotlight.name} />
                  </span>
                </button>
                <div className="demo-world-atlas-hero-progress">
                  <span>
                    {String(selected + 1).padStart(2, '0')} / {String(featured.length).padStart(2, '0')}
                  </span>
                  <div className="demo-world-atlas-hero-dots">
                    {featured.map((item, index) => (
                      <button
                        type="button"
                        key={item.id}
                        aria-label={t(`展示${item.name}`, `Show ${item.name}`)}
                        aria-current={selected === index ? 'true' : undefined}
                        onClick={() => setSelected(index)}
                      >
                        <span />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="demo-world-atlas-hero-copy" aria-live="polite">
                <button
                  type="button"
                  className="demo-world-atlas-hero-copy-open"
                  onClick={() => openWorld(spotlight.id)}
                >
                  <h2>{spotlight.name}</h2>
                  <p className="demo-world-atlas-description">{spotlight.description}</p>
                </button>
                <div className="demo-world-atlas-hero-actions">
                  <div className="demo-world-atlas-arrows">
                    <button
                      type="button"
                      aria-label={t('上一个世界', 'Previous world')}
                      onClick={() => setSelected((selected + featured.length - 1) % featured.length)}
                    >
                      <ChevronLeft size={20} />
                    </button>
                    <button
                      type="button"
                      aria-label={t('下一个世界', 'Next world')}
                      onClick={() => setSelected((selected + 1) % featured.length)}
                    >
                      <ChevronRight size={20} />
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}
          <nav className="demo-world-atlas-filters" aria-label={t('世界分类', 'World categories')}>
            <button type="button" aria-pressed={topic === ''} onClick={() => setTopic('')}>
              <Grid2X2 size={17} />
              {t('全部世界', 'All worlds')}
            </button>
            <button type="button" aria-pressed={topic === 'favorites'} onClick={() => setTopic('favorites')}>
              <Bookmark size={17} />
              {t('我的收藏', 'Saved worlds')}
            </button>
            {exploreTopics.map((item) => (
              <button
                type="button"
                key={item.id}
                aria-pressed={topic === item.id}
                onClick={() => setTopic(item.id)}
              >
                <item.icon size={17} />
                {t(item.zh, item.en)}
              </button>
            ))}
          </nav>
          <section className={`demo-world-atlas-section ${browse ? 'demo-world-discovery-section' : ''}`}>
            <div className="demo-world-atlas-section-heading">
              <div>
                <h2>
                  {topic === 'favorites'
                    ? t('我的收藏', 'Saved worlds')
                    : query.trim()
                      ? t('搜索结果', 'Search results')
                      : topic
                        ? t(
                            exploreTopics.find((item) => item.id === topic)!.zh,
                            exploreTopics.find((item) => item.id === topic)!.en,
                          )
                        : t('探索更多世界', 'Explore more worlds')}
                </h2>
                {browse && (
                  <p>{t('更多精彩的世界，等待你去发现', 'More remarkable worlds await discovery')}</p>
                )}
              </div>
            </div>
            <div className={browse ? 'demo-world-discovery-grid' : 'demo-world-atlas-grid'}>
              {results.map((item) => (
                <article key={item.id}>
                  <button
                    type="button"
                    className={browse ? 'demo-world-discovery-link' : 'demo-world-album-link'}
                    aria-label={t(`探索${item.name}`, `Explore ${item.name}`)}
                    onClick={() => openWorld(item.id)}
                  >
                    <span className="demo-world-atlas-image">
                      <img src={item.image} alt="" loading="lazy" />
                    </span>
                    <div className={browse ? 'demo-world-discovery-caption' : 'demo-world-album-caption'}>
                      <div className="demo-world-discovery-copy">
                        <h3>{item.name}</h3>
                        {!browse && <p>{item.description ?? item.summary}</p>}
                      </div>
                      {browse && (
                        <span className="demo-world-discovery-arrow">
                          <ArrowRight size={18} />
                        </span>
                      )}
                    </div>
                  </button>
                </article>
              ))}
            </div>
            {results.length === 0 && (
              <p className="demo-empty">{t('没有符合条件的世界', 'No matching worlds')}</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
