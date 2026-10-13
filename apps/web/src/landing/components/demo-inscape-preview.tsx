import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import { useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Compass,
  Fingerprint,
  Leaf,
  LockKeyhole,
  MessagesSquare,
  Users,
} from 'lucide-react';
import type { RemainingPreviewMeta } from '../content/landing-content.remaining-apps.js';
import { PreviewButton } from './demo-third-party-shared.js';
import { PreviewHeading, PreviewNav, RemainingPreview } from './demo-remaining-shared.js';

/** Inscape's sage-paper Today / Relationships / Self shell and inner-landscape artwork. */
export function DemoInscapePreview({ content }: { content: RemainingPreviewMeta }) {
  const { t } = useAppPreviewLocale();
  const [view, setView] = useState('today');
  const moodLabels: Record<string, string> = {
    calm: t('inscape.mood.calm'),
    bright: t('inscape.mood.bright'),
    tangled: t('inscape.mood.tangled'),
    low: t('inscape.mood.low'),
    restless: t('inscape.mood.restless'),
  };
  const [mood, setMood] = useState('calm');
  const [exploring, setExploring] = useState(false);
  const [draft, setDraft] = useState(() => t('inscape.workspace.iWantToTrySomethingNewBut'));
  const [entries, setEntries] = useState(() => [
    t('inscape.workspace.afterSlowingDownINoticedIWas'),
  ]);
  const [card, setCard] = useState(0);
  const nav = [
    { id: 'today', label: t('inscape.workspace.today'), Icon: Compass },
    { id: 'relationship', label: t('inscape.workspace.betweenUs'), Icon: Users },
    { id: 'self', label: t('inscape.workspace.aboutMe'), Icon: Fingerprint },
    { id: 'archive', label: t('inscape.workspace.fieldNotes'), Icon: BookOpen },
  ];
  return (
    <RemainingPreview content={content} kind="inscape">
      <div className="rp-shell">
        <PreviewNav
          content={content}
          items={nav}
          active={view}
          onSelect={(id) => {
            setView(id);
            setExploring(false);
          }}
          footer={
            <>
              <Leaf size={23} />
              <p>{t('inscape.workspace.gettingToKnowYourselfIsAnAdventure')}</p>
              <small>{t('inscape.workspace.sampleSpace18')}</small>
            </>
          }
        />
        <main className="rp-main">
          <div className="is-breadcrumb">
            {t('inscape.main.mySpace')}
            {nav.find((x) => x.id === view)?.label}
            <span>
              <LockKeyhole size={13} />
              {t('inscape.main.privateLocalFirst')}
            </span>
          </div>
          <div className="rp-page">
            {view === 'today' && !exploring ? (
              <>
                <PreviewHeading
                  title={t('inscape.main.aLittleCloserToYourself')}
                  description={t('inscape.main.beginWithASmallMomentAFeeling')}
                />
                <section className="is-hero">
                  <h2>
                    {t('inscape.hero.everyFeelingHas')}
                    <br />
                    {t('inscape.hero.aStoryBehindIt')}
                  </h2>
                  <p>
                    {t('inscape.hero.putThatThoughtYouVeBeenCirclingHere')}
                    <br />
                    {t('inscape.hero.considerAPossibilityBeyondYourUsualHabits')}
                  </p>
                  <PreviewButton primary onClick={() => setExploring(true)}>
                    {t('inscape.hero.startWithASmallMoment')}
                    <ArrowUpRight size={16} />
                  </PreviewButton>
                </section>
                <section className="is-mood">
                  <h3>{t('inscape.mood.whatIsYourInnerWeather')}</h3>
                  <div>
                    {[
                      { value: 'calm', label: t('inscape.mood.calm') },
                      { value: 'bright', label: t('inscape.mood.bright') },
                      { value: 'tangled', label: t('inscape.mood.tangled') },
                      { value: 'low', label: t('inscape.mood.low') },
                      { value: 'restless', label: t('inscape.mood.restless') },
                    ].map(({ value: x, label }) => (
                      <button
                        type="button"
                        key={x}
                        aria-pressed={mood === x}
                        onClick={() => setMood(x)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </section>
                <h2 className="rp-section-title">{t('inscape.main.whereShallWeWander')}</h2>
                <div className="is-paths">
                  {[
                    {
                      name: t('inscape.main.innerRoundtable'),
                      text: t('inscape.main.whenYouReTornLetDifferentPerspectivesSit'),
                      Icon: MessagesSquare,
                    },
                    {
                      name: t('inscape.main.behindTheFeeling'),
                      text: t('inscape.main.startWithASmallMomentAndNotice'),
                      Icon: Leaf,
                    },
                    {
                      name: '靠近彼此',
                      text: t('inscape.main.whyCanTheSameWordsSoundSo'),
                      Icon: Users,
                    },
                  ].map(({ name, text, Icon }) => (
                    <button
                      type="button"
                      key={name}
                      onClick={() =>
                        name === '靠近彼此' ? setView('relationship') : setExploring(true)
                      }
                    >
                      <Icon size={25} />
                      <h3>{name === '靠近彼此' ? t('inscape.relationships.title') : name}</h3>
                      <p>{text}</p>
                      <ArrowUpRight size={16} />
                    </button>
                  ))}
                </div>
                <section className="is-reflection-card">
                  <p>
                    {
                      [
                        t('inscape.reflectionCard.whichRecentSmallDecisionFeltMostLike'),
                        t('inscape.reflectionCard.withoutAnyShouldsHowWouldYouSpend'),
                      ][card]
                    }
                  </p>
                  <PreviewButton onClick={() => setCard(1 - card)}>
                    {t('inscape.reflectionCard.drawAnotherCard')}
                  </PreviewButton>
                </section>
              </>
            ) : exploring ? (
              <>
                <PreviewButton onClick={() => setExploring(false)}>
                  <ArrowLeft size={15} />
                  {t('inscape.main.backToYourSpace')}
                </PreviewButton>
                <PreviewHeading
                  title={t('inscape.main.startWithThisSmallMoment')}
                  description={t('inscape.main.feelingNowSampleReflection', {
                    mood: moodLabels[mood]!,
                  })}
                />
                <label>
                  {t('inscape.main.whatHappened')}
                  <textarea
                    rows={6}
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value);
                    }}
                  />
                </label>
                <section className="is-reading">
                  <h2>{t('inscape.reading.lookFromAnotherAngle')}</h2>
                  <p>{t('inscape.reading.thisSavedExampleInvitesYouToNotice')}</p>
                  <p>{t('inscape.reading.askYourselfIsThereAVerySmall')}</p>
                </section>
                <PreviewButton
                  primary
                  disabled={!draft.trim()}
                  onClick={() => {
                    setEntries((v) => [draft, ...v]);
                    setView('archive');
                    setExploring(false);
                  }}
                >
                  {t('inscape.main.addToSampleJournal')}
                </PreviewButton>
              </>
            ) : view === 'archive' ? (
              <>
                <PreviewHeading
                  title={t('inscape.main.fieldNotes')}
                  description={t('inscape.main.keepDiscoveriesFromYourJourneyHereEdits')}
                />
                {entries.map((entry, i) => (
                  <article className="is-journal" key={i}>
                    <span>
                      {t('inscape.main.entry')}
                      {entries.length - i} {t('inscape.main.sample')}
                    </span>
                    <p>{entry}</p>
                  </article>
                ))}
              </>
            ) : view === 'self' ? (
              <>
                <PreviewHeading
                  title={t('inscape.main.aboutMe')}
                  description={t('inscape.main.takeYourTimeGettingToKnowDifferent')}
                />
                <section className="is-reading">
                  <h2>{t('inscape.reading.aSelfPortraitStillGrowing')}</h2>
                  <p>{t('inscape.reading.cognitiveFunctionsOfferOnePerspectiveOnUnderstanding')}</p>
                </section>
                <div className="is-functions">
                  {[
                    [t('inscape.main.introvertedIntuitionNi'), 72],
                    [t('inscape.main.extravertedFeelingFe'), 61],
                    [t('inscape.main.introvertedThinkingTi'), 54],
                    [t('inscape.main.extravertedSensingSe'), 43],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <meter
                        min={0}
                        max={100}
                        value={Number(value)}
                        aria-label={t('inscape.main.sampleTendency', { label: label ?? '' })}
                      />
                      <small>{t('inscape.main.sample2')}</small>
                    </div>
                  ))}
                </div>
                <PreviewButton onClick={() => setView('archive')}>
                  {t('inscape.main.viewReflectionJournal')}
                </PreviewButton>
              </>
            ) : (
              <>
                <PreviewHeading
                  title={t('inscape.main.betweenUs')}
                  description={t('inscape.main.lookThroughAnotherWindowIntoEachOtherS')}
                />
                <section className="is-reading">
                  <h2>{t('inscape.reading.twoRhythmsOfCommunication')}</h2>
                  <p>{t('inscape.reading.somePeopleThinkAloudOthersOrganizeThoughts')}</p>
                  <label>
                    {t('inscape.reading.somethingYouWantToSay')}
                    <textarea
                      value={draft}
                      rows={4}
                      onChange={(e) => {
                        setDraft(e.target.value);
                      }}
                    />
                  </label>
                  <details>
                    <summary>{t('inscape.reading.viewAPerspectiveTakingExample')}</summary>
                    <p>{t('inscape.reading.thisMattersToMeIDLikeTo')}</p>
                  </details>
                </section>
              </>
            )}
            <p className="is-disclaimer">
              {t('inscape.main.inscapeHelpsYouExploreNotDefineYourself')}
            </p>
          </div>
        </main>
      </div>
    </RemainingPreview>
  );
}
