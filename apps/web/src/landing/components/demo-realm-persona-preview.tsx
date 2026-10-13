import type { PreviewTranslate } from '../i18n/preview-messages.js';
import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import { useState } from 'react';
import {
  ArrowLeft,
  FilePenLine,
  Image,
  Plus,
  Search,
  Settings2,
  UserRound,
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

type PersonaDraft = {
  name: string;
  role: string;
  description: string;
  image: string;
  post: string;
};
const createSamplePersonas = (t: PreviewTranslate): PersonaDraft[] => [
  {
    name: t('realmPersona.workspace.wanxing'),
    role: t('realmPersona.workspace.aTravelerRecordingTheCity'),
    description: t('realmPersona.workspace.enjoysEveningWalksAndWritingAboutSmall'),
    image: '/demo/zhiyu/wanxing-avatar.svg',
    post: t('realmPersona.workspace.iTookAnUnfamiliarAlleyTodayAnd'),
  },
  {
    name: t('realmPersona.workspace.chao'),
    role: t('realmPersona.workspace.aCollectorOfSeasideStories'),
    description: t('realmPersona.workspace.grewUpByTheSeaAndLoves'),
    image: '/demo/zhiyu/chao-avatar.svg',
    post: t('realmPersona.workspace.theSeaBreezeWasGentleTodayAnother'),
  },
];

/** Realm Persona Studio's portfolio and owner-facing profile/draft editor. */
export function DemoRealmPersonaPreview({ content }: { content: RemainingPreviewMeta }) {
  const { t } = useAppPreviewLocale();
  const [view, setView] = useState('portfolio');
  const [tab, setTab] = useState('角色资料');
  const [query, setQuery] = useState(() => '');
  const [items, setItems] = useState(() => createSamplePersonas(t));
  const [selected, setSelected] = useState<number | null>(null);
  const [idea, setIdea] = useState(() =>
    t('realmPersona.workspace.aTravelerWhoCollectsCitySoundsAnd'),
  );
  const [saved, setSaved] = useState(false);
  const nav = [
    { id: 'portfolio', label: t('realmPersona.workspace.myPersonas'), Icon: Users },
    { id: 'drafts', label: t('realmPersona.workspace.creativeDrafts'), Icon: FilePenLine },
    { id: 'assets', label: t('realmPersona.workspace.assetLibrary'), Icon: Image },
    { id: 'settings', label: t('realmPersona.workspace.aiConfiguration'), Icon: Settings2 },
  ];
  const create = () => {
    setItems((v) => [
      ...v,
      {
        name: t('realmPersona.workspace.newPersonaDraft'),
        role: t('realmPersona.workspace.waitingForYourSetting'),
        description: idea,
        image: '/demo/zhiyu/qingzhao-avatar.svg',
        post: '',
      },
    ]);
    setSelected(items.length);
    setSaved(false);
    setView('portfolio');
  };
  const update = (field: keyof PersonaDraft, value: string) => {
    setItems((v) => v.map((item, i) => (i === selected ? { ...item, [field]: value } : item)));
    setSaved(false);
  };
  return (
    <RemainingPreview content={content} kind="persona">
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
              <UserRound size={20} />
              <span>{t('realmPersona.workspace.sampleCreatorWorkspace')}</span>
            </>
          }
        />
        <main className="rp-main rp-page">
          {selected !== null ? (
            <>
              <PreviewButton onClick={() => setSelected(null)}>
                <ArrowLeft size={15} />
                {t('realmPersona.main.backToPersonaLibrary')}
              </PreviewButton>
              <div className="ps-profile-header">
                <img
                  src={items[selected]!.image}
                  alt={t('realmPersona.main.samplePersonaAvatar')}
                />
                <div>
                  <h1>{items[selected]!.name}</h1>
                  <p>{items[selected]!.role}</p>
                  <span className="rp-badge">{t('realmPersona.main.sampleDraft')}</span>
                </div>
                <PreviewButton primary onClick={() => setSaved(true)}>
                  {saved
                    ? t('realmPersona.main.sampleDraftKept')
                    : t('realmPersona.main.saveSampleDraft')}
                </PreviewButton>
              </div>
              <PreviewTabs
                items={[
                  { value: '角色资料', label: t('realmPersona.tabs.personaProfile') },
                  { value: '视觉形象', label: t('realmPersona.tabs.visualAppearance') },
                  { value: '动态草稿', label: t('realmPersona.main.postDraft') },
                ]}
                value={tab}
                onChange={setTab}
                label={t('realmPersona.main.personaEditingArea')}
              />
              {tab === '角色资料' ? (
                <div className="ps-profile-form">
                  <label>
                    {t('realmPersona.main.displayName')}
                    <input
                      value={items[selected]!.name}
                      onChange={(e) => {
                        update('name', e.target.value);
                      }}
                    />
                  </label>
                  <label>
                    {t('realmPersona.main.oneLineIntroduction')}
                    <input
                      value={items[selected]!.role}
                      onChange={(e) => {
                        update('role', e.target.value);
                      }}
                    />
                  </label>
                  <label>
                    {t('realmPersona.main.personaSetting')}
                    <textarea
                      value={items[selected]!.description}
                      rows={6}
                      onChange={(e) => {
                        update('description', e.target.value);
                      }}
                    />
                  </label>
                  <p>{t('realmPersona.main.reviewTheDraftFirstThisPreviewDoes')}</p>
                </div>
              ) : tab === '视觉形象' ? (
                <section className="ps-visual">
                  <img
                    src={items[selected]!.image}
                    alt={t('realmPersona.visual.currentSampleAppearance')}
                  />
                  <div>
                    <h2>{t('realmPersona.visual.appearanceCandidates')}</h2>
                    <p>{t('realmPersona.visual.theFullAppLetsYouReviewAppearance')}</p>
                    <PreviewButton
                      onClick={() =>
                        update(
                          'image',
                          items[selected]!.image.includes('qingzhao')
                            ? '/demo/zhiyu/wanxing-avatar.svg'
                            : '/demo/zhiyu/qingzhao-avatar.svg',
                        )
                      }
                    >
                      {t('realmPersona.visual.switchSampleAppearance')}
                    </PreviewButton>
                  </div>
                </section>
              ) : (
                <section className="ps-profile-form">
                  <h2>{t('realmPersona.profileForm.letThePersonaShareAnObservation')}</h2>
                  <label>
                    {t('realmPersona.profileForm.postDraft')}
                    <textarea
                      rows={7}
                      value={items[selected]!.post}
                      onChange={(e) => {
                        update('post', e.target.value);
                      }}
                    />
                  </label>
                  <PreviewButton
                    disabled={!items[selected]!.post.trim()}
                    onClick={() => setSaved(true)}
                  >
                    {saved
                      ? t('realmPersona.profileForm.samplePostKept')
                      : t('realmPersona.profileForm.keepSamplePostDraft')}
                  </PreviewButton>
                </section>
              )}
            </>
          ) : view === 'assets' ? (
            <>
              <PreviewHeading
                title={t('realmPersona.main.assetLibrary')}
                description={t('realmPersona.main.seeThePersonaAppearancesUsedInThis')}
              />
              <div className="ps-asset-grid">
                {items.map((p, i) => (
                  <button
                    type="button"
                    key={i}
                    onClick={() => {
                      setView('portfolio');
                      setSelected(i);
                      setTab('视觉形象');
                    }}
                  >
                    <img src={p.image} alt={p.name} />
                    <span>{p.name}</span>
                  </button>
                ))}
              </div>
            </>
          ) : view === 'settings' ? (
            <>
              <PreviewHeading
                title={t('realmPersona.main.aiConfiguration')}
                description={t('realmPersona.main.theFullAppUsesNimiSTextAnd')}
              />
              <section className="rp-soft-panel">
                <h2>{t('realmPersona.softPanel.personaContentAndAppearance')}</h2>
                <p>{t('realmPersona.softPanel.chooseModelsInNimiSAppAiSettings')}</p>
              </section>
            </>
          ) : (
            <>
              <PreviewHeading
                title={
                  view === 'drafts'
                    ? t('realmPersona.main.creativeDrafts')
                    : t('realmPersona.main.myRealmPersonas')
                }
                description={t('realmPersona.main.startWithAnIdeaAndLetA')}
              >
                <PreviewButton primary onClick={create}>
                  <Plus size={16} />
                  {t('realmPersona.main.newPersonaDraft')}
                </PreviewButton>
              </PreviewHeading>
              {view === 'portfolio' && (
                <section className="ps-idea">
                  <h2>{t('realmPersona.idea.whatKindOfPersonaWouldYouLike')}</h2>
                  <p>{t('realmPersona.idea.aSingleIdeaCanBeTheBeginning')}</p>
                  <textarea
                    aria-label={t('realmPersona.idea.personaIdea')}
                    rows={3}
                    value={idea}
                    onChange={(e) => {
                      setIdea(e.target.value);
                    }}
                  />
                  <PreviewButton primary disabled={!idea.trim()} onClick={create}>
                    {t('realmPersona.idea.organizeIntoASampleDraft')}
                  </PreviewButton>
                </section>
              )}
              <div className="rp-collection-tools">
                <h2>
                  {view === 'drafts'
                    ? t('realmPersona.main.draftsInThisPreview')
                    : t('realmPersona.main.personaPortfolio')}
                </h2>
                <label className="rp-search">
                  <Search size={15} />
                  <input
                    aria-label={t('realmPersona.main.searchPersonas')}
                    placeholder={t('realmPersona.main.searchPersonas2')}
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                    }}
                  />
                </label>
              </div>
              <div className="ps-personas">
                {items.map(
                  (p, i) =>
                    (!query || p.name.toLowerCase().includes(query.toLowerCase())) && (
                      <button
                        type="button"
                        key={i}
                        onClick={() => {
                          setSelected(i);
                          setSaved(false);
                          setTab('角色资料');
                        }}
                      >
                        <div className="ps-persona-art">
                          <img src={p.image} alt={''} />
                        </div>
                        <div>
                          <span className="rp-badge">{t('realmPersona.main.sampleDraft')}</span>
                          <h3>{p.name}</h3>
                          <p>{p.role}</p>
                        </div>
                      </button>
                    ),
                )}
              </div>
              {!items.some((p) => p.name.toLowerCase().includes(query.toLowerCase())) && (
                <p className="rp-empty">{t('realmPersona.main.noMatchingSamplePersonas')}</p>
              )}
            </>
          )}
        </main>
      </div>
    </RemainingPreview>
  );
}
