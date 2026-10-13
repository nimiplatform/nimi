import type { PreviewTranslate } from '../i18n/preview-messages.js';
import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  FilePenLine,
  Globe2,
  PlusCircle,
  Search,
  Users,
} from 'lucide-react';
import type { RemainingPreviewMeta } from '../content/landing-content.remaining-apps.js';
import { PreviewButton } from './demo-third-party-shared.js';
import {
  PreviewHeading,
  PreviewNav,
  PreviewTabs,
  RemainingPreview,
} from './demo-remaining-shared.js';

type WorldDraft = {
  title: string;
  genre: string;
  description: string;
  image: string;
  character: string;
  setting: string;
};
const createSampleWorlds = (t: PreviewTranslate): WorldDraft[] => [
  {
    title: t('realmWorld.workspace.betweenTheTides'),
    genre: t('realmWorld.workspace.harborEverydayLifeGentleFantasy'),
    description: t('realmWorld.workspace.aSmallTownBreathingWithTheTides'),
    image: '/demo/storybook/harbor.jpg',
    character: t('realmWorld.workspace.lighthouseKeeper'),
    setting: t('realmWorld.workspace.lightsTheLighthouseEveryEveningAndListens'),
  },
  {
    title: t('realmWorld.workspace.glassGarden'),
    genre: t('realmWorld.workspace.natureGrowthComfort'),
    description: t('realmWorld.workspace.allFourSeasonsStayInOneGarden'),
    image: '/demo/storybook/garden.jpg',
    character: t('realmWorld.workspace.fourSeasonGardener'),
    setting: t('realmWorld.workspace.tendsEveryPathAndHelpsVisitorsDiscover'),
  },
];

/** Realm World Studio's blue world library, idea entry and world/character setting editor. */
export function DemoRealmWorldPreview({ content }: { content: RemainingPreviewMeta }) {
  const { t } = useAppPreviewLocale();
  const [view, setView] = useState('library');
  const [worlds, setWorlds] = useState(() => createSampleWorlds(t));
  const [selected, setSelected] = useState<number | null>(null);
  const [tab, setTab] = useState('世界设定');
  const [idea, setIdea] = useState(() =>
    t('realmWorld.workspace.aSeasideTownWhereEveryResidentKeeps'),
  );
  const [query, setQuery] = useState(() => '');
  const [saved, setSaved] = useState(false);
  const nav = [
    { id: 'library', label: t('realmWorld.workspace.worldLibrary'), Icon: BookOpen },
    { id: 'drafts', label: t('realmWorld.navigation.drafts'), Icon: FilePenLine },
    { id: 'new', label: t('realmWorld.workspace.newWorld'), Icon: PlusCircle },
  ];
  const create = () => {
    setWorlds((v) => [
      ...v,
      {
        title: t('realmWorld.workspace.newWorldDraft'),
        genre: t('realmWorld.workspace.waitingForDetails'),
        description: idea,
        image: '/demo/storybook/train.jpg',
        character: '',
        setting: '',
      },
    ]);
    setSelected(worlds.length);
    setTab('世界设定');
    setView('library');
    setSaved(false);
  };
  const update = (field: keyof WorldDraft, value: string) => {
    setWorlds((v) => v.map((w, i) => (i === selected ? { ...w, [field]: value } : w)));
    setSaved(false);
  };
  return (
    <RemainingPreview content={content} kind="world">
      <div className="rp-shell">
        <PreviewNav
          content={content}
          items={nav}
          active={view}
          onSelect={(id) => {
            setView(id);
            setSelected(null);
          }}
          footer={
            <>
              <Globe2 size={21} />
              <span>{t('realmWorld.workspace.sampleCreatorSpace')}</span>
            </>
          }
        />
        <main className="rp-main rp-page">
          {selected !== null ? (
            <>
              <PreviewButton onClick={() => setSelected(null)}>
                <ArrowLeft size={15} />
                {t('realmWorld.main.backToWorldLibrary')}
              </PreviewButton>
              <div className="ws-world-heading">
                <img src={worlds[selected]!.image} alt={t('realmWorld.main.sampleWorldCover')} />
                <div>
                  <span className="rp-badge">{t('realmWorld.main.sampleDraft')}</span>
                  <h1>{worlds[selected]!.title}</h1>
                  <p>{worlds[selected]!.genre}</p>
                </div>
                <PreviewButton primary onClick={() => setSaved(true)}>
                  {saved
                    ? t('realmWorld.main.sampleDraftKept')
                    : t('realmWorld.main.saveSampleDraft')}
                </PreviewButton>
              </div>
              <PreviewTabs
                items={[
                  { value: '世界设定', label: t('realmWorld.tabs.worldSetting') },
                  { value: '角色', label: t('realmWorld.tabs.character') },
                  { value: '地点与关系', label: t('realmWorld.main.placesAndRelationships') },
                ]}
                value={tab}
                onChange={setTab}
                label={t('realmWorld.main.worldEditingArea')}
              />
              {tab === '世界设定' ? (
                <div className="ws-form">
                  <label>
                    {t('realmWorld.main.worldName')}
                    <input
                      value={worlds[selected]!.title}
                      onChange={(e) => {
                        update('title', e.target.value);
                      }}
                    />
                  </label>
                  <label>
                    {t('realmWorld.main.genreAndThemes')}
                    <input
                      value={worlds[selected]!.genre}
                      onChange={(e) => {
                        update('genre', e.target.value);
                      }}
                    />
                  </label>
                  <label>
                    {t('realmWorld.main.worldOverview')}
                    <textarea
                      rows={6}
                      value={worlds[selected]!.description}
                      onChange={(e) => {
                        update('description', e.target.value);
                      }}
                    />
                  </label>
                  <details>
                    <summary>{t('realmWorld.main.sampleWorldRules')}</summary>
                    <p>{t('realmWorld.main.theTownSBellsChangeWithTheTides')}</p>
                  </details>
                </div>
              ) : tab === '角色' ? (
                <section className="ws-character">
                  <div className="ws-character-avatar">
                    <Users size={37} />
                  </div>
                  <div>
                    <h2>{t('realmWorld.character.maintainCharacterSettings')}</h2>
                    <label>
                      {t('realmWorld.character.characterName')}
                      <input
                        value={worlds[selected]!.character}
                        onChange={(e) => {
                          update('character', e.target.value);
                        }}
                      />
                    </label>
                    <label>
                      {t('realmWorld.character.characterRoleAndStory')}
                      <textarea
                        value={worlds[selected]!.setting}
                        onChange={(e) => {
                          update('setting', e.target.value);
                        }}
                        rows={5}
                      />
                    </label>
                    <p>{t('realmWorld.character.theseAreCharacterSettingsWithinASample')}</p>
                  </div>
                </section>
              ) : (
                <section className="ws-locations">
                  <article>
                    <h2>{t('realmWorld.locations.lighthouse')}</h2>
                    <p>
                      {worlds[selected]!.character || t('realmWorld.locations.sampleCharacter')}
                      {t('realmWorld.locations.worksHereWhereTheTownSConnection')}
                    </p>
                  </article>
                  <article>
                    <h2>{t('realmWorld.locations.dock')}</h2>
                    <p>{t('realmWorld.locations.ferriesBringNewStoriesResidentsMeetAgain')}</p>
                  </article>
                  <div>
                    {t('realmWorld.locations.lighthouseKeeper')}
                    <ArrowRight size={17} />
                    {t('realmWorld.locations.looksAfter')}
                    <ArrowRight size={17} />
                    {t('realmWorld.locations.oldHarborLighthouse')}
                  </div>
                </section>
              )}
            </>
          ) : (
            <>
              <PreviewHeading
                title={
                  view === 'new'
                    ? t('realmWorld.main.startWithAnIdea')
                    : view === 'drafts'
                      ? t('realmWorld.main.creativeDrafts')
                      : t('realmWorld.main.yourWorldUnfoldingYourWay')
                }
                description={t('realmWorld.main.buildSettingsAndCharactersAndOrganizeImagination')}
              />
              <section className="ws-idea">
                <h2>{t('realmWorld.idea.whatKindOfWorldWouldYouLike')}</h2>
                <textarea
                  aria-label={t('realmWorld.idea.worldIdea')}
                  value={idea}
                  rows={3}
                  onChange={(e) => {
                    setIdea(e.target.value);
                  }}
                />
                <div>
                  <span>{t('realmWorld.idea.startWithAnIdeaSampleDraft')}</span>
                  <PreviewButton primary disabled={!idea.trim()} onClick={create}>
                    {t('realmWorld.idea.exploreThisIdea')}
                    <ArrowRight size={15} />
                  </PreviewButton>
                </div>
              </section>
              <div className="rp-collection-tools">
                <PreviewTabs
                  items={[
                    { value: '世界库', label: t('realmWorld.main.worldLibrary') },
                    { value: '草稿', label: t('realmWorld.tabs.drafts') },
                  ]}
                  value={view === 'drafts' ? '草稿' : '世界库'}
                  onChange={(x) => setView(x === '草稿' ? 'drafts' : 'library')}
                  label={t('realmWorld.main.worldCollection')}
                />
                <label className="rp-search">
                  <Search size={15} />
                  <input
                    aria-label={t('realmWorld.main.searchWorlds')}
                    placeholder={t('realmWorld.main.searchWorlds2')}
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                    }}
                  />
                </label>
              </div>
              <div className="ws-worlds">
                {worlds.map(
                  (w, i) =>
                    (!query || w.title.toLowerCase().includes(query.toLowerCase())) && (
                      <button
                        type="button"
                        key={i}
                        onClick={() => {
                          setSelected(i);
                          setSaved(false);
                          setTab('世界设定');
                        }}
                      >
                        <img src={w.image} alt={''} />
                        <div>
                          <span className="rp-badge">{t('realmWorld.main.sampleDraft')}</span>
                          <h2>{w.title}</h2>
                          <p>{w.genre}</p>
                        </div>
                      </button>
                    ),
                )}
              </div>
              {!worlds.some((w) => w.title.toLowerCase().includes(query.toLowerCase())) && (
                <p className="rp-empty">{t('realmWorld.main.noMatchingSampleWorlds')}</p>
              )}
            </>
          )}
        </main>
      </div>
    </RemainingPreview>
  );
}
