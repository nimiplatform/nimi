import type { PreviewTranslate } from '../i18n/preview-messages.js';
import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  LayoutTemplate,
  Play,
  Plus,
  Presentation,
  SlidersHorizontal,
} from 'lucide-react';
import type { RemainingPreviewMeta } from '../content/landing-content.remaining-apps.js';
import { PreviewButton } from './demo-third-party-shared.js';
import { RemainingPreview } from './demo-remaining-shared.js';

type SampleSlide = { title: string; body: string; image?: string; notes?: string };
const createSampleSlides = (t: PreviewTranslate): SampleSlide[] => [
  {
    title: t('presenton.workspace.aLittleMoreRoomForEverydayLife'),
    body: t('presenton.workspace.designingCalmerMoreWelcomingPlacesAnIllustrative'),
    image: '/demo/remaining/inscape-landscape.webp',
  },
  {
    title: t('presenton.workspace.startWithTheJourney'),
    body: t('presenton.workspace.connectThePlacesPeopleAlreadyVisitMake'),
  },
  {
    title: t('presenton.workspace.smallChangesSharedPossibilities'),
    body: t('presenton.workspace.aShadedBenchASaferCrossingA'),
    image: '/demo/storybook/garden.jpg',
  },
];

/** Presenton's slide strip, editable canvas, template settings and presentation mode. */
export function DemoPresentonPreview({ content }: { content: RemainingPreviewMeta }) {
  const { t } = useAppPreviewLocale();
  const [slides, setSlides] = useState(() => createSampleSlides(t));
  const [selected, setSelected] = useState(0);
  const [title, setTitle] = useState(() => t('presenton.workspace.aMoreWelcomingCity'));
  const themes = [
    { value: 'Fern', label: t('presenton.settings.fern') },
    { value: 'Slate', label: t('presenton.settings.slate') },
    { value: 'Paper', label: t('presenton.settings.paper') },
  ];
  const [theme, setTheme] = useState('Fern');
  const [presenting, setPresenting] = useState(false);
  const [settings, setSettings] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const slide = slides[selected]!;
  const update = (field: 'title' | 'body' | 'notes', value: string) => {
    setSlides((v) => v.map((s, i) => (i === selected ? { ...s, [field]: value } : s)));
    setSaved(false);
  };
  return (
    <RemainingPreview content={content} kind="presenton">
      {!presenting && (
        <>
          <header className="pn-header">
            <div>
              <img src={content.icon} alt={''} />
              <strong>{t('presenton.header.presenton')}</strong>
              <input
                aria-label={t('presenton.header.presentationTitle')}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setSaved(false);
                }}
              />
            </div>
            <div>
              <PreviewButton onClick={() => setSaved(true)}>
                <Check size={14} />
                {saved ? t('presenton.header.keptInPreview') : t('presenton.header.saveExample')}
              </PreviewButton>
              <PreviewButton onClick={() => setExportOpen(!exportOpen)}>
                {t('presenton.header.exportOptions')}
              </PreviewButton>
              <PreviewButton primary onClick={() => setPresenting(true)}>
                <Play size={15} />
                {t('presenton.header.present')}
              </PreviewButton>
            </div>
          </header>
          {exportOpen && (
            <section className="pn-export" role="status">
              <strong>{t('presenton.export.exportInTheInstalledApp')}</strong>
              <span>{t('presenton.export.powerPointPptxPdfPdf')}</span>
              <p>{t('presenton.export.thisStaticPreviewDoesNotCreateAn')}</p>
            </section>
          )}
          <div className={`pn-workspace${settings ? '' : ' pn-workspace--wide'}`}>
            <aside className="pn-slides">
              <div>
                <h2>{t('presenton.slides.slides')}</h2>
                <button
                  type="button"
                  aria-label={t('presenton.slides.addSampleSlide')}
                  onClick={() => {
                    setSlides((v) => [
                      ...v,
                      {
                        title: t('presenton.slides.aNewIdea'),
                        body: t('presenton.slides.writeAFewLinesToDevelopIt'),
                      },
                    ]);
                    setSelected(slides.length);
                    setSaved(false);
                  }}
                >
                  <Plus size={17} />
                </button>
              </div>
              {slides.map((s, i) => (
                <button
                  type="button"
                  key={i}
                  aria-label={t('presenton.slides.slide', {
                    number: i + 1,
                    title: s.title.replace('\n', ' '),
                  })}
                  aria-pressed={selected === i}
                  onClick={() => setSelected(i)}
                >
                  <span>{i + 1}</span>
                  <div className={`pn-mini pn-theme-${theme.toLowerCase()}`}>
                    <strong>{s.title}</strong>
                    <small>{s.body.split('\n')[0]}</small>
                  </div>
                </button>
              ))}
            </aside>
            <main className="pn-main">
              <div className="pn-toolbar">
                <span>
                  {t('presenton.main.slide')}
                  {selected + 1} {' / '}
                  {slides.length}
                </span>
                <PreviewButton onClick={() => setSettings(!settings)}>
                  <SlidersHorizontal size={15} />
                  {settings ? t('presenton.main.hideSettings') : t('presenton.main.slideSettings')}
                </PreviewButton>
              </div>
              <section
                className={`pn-canvas pn-theme-${theme.toLowerCase()}${slide.image ? ' pn-canvas--image' : ''}`}
                aria-label={t('presenton.main.slideCanvas')}
              >
                <div>
                  <textarea
                    aria-label={t('presenton.main.slideTitle')}
                    rows={3}
                    value={slide.title}
                    onChange={(e) => {
                      update('title', e.target.value);
                    }}
                  />
                  <textarea
                    aria-label={t('presenton.main.slideContent')}
                    rows={4}
                    value={slide.body}
                    onChange={(e) => {
                      update('body', e.target.value);
                    }}
                  />
                  <span>{t('presenton.main.presentonSampleDeck')}</span>
                </div>
                {slide.image && (
                  <img src={slide.image} alt={t('presenton.main.sampleSlideIllustration')} />
                )}
              </section>
              <p className="pn-edit-hint">{t('presenton.main.clickTheTitleOrBodyToEdit')}</p>
              <label className="pn-speaker-notes">
                {t('presenton.main.speakerNotes')}
                <textarea
                  aria-label={t('presenton.main.speakerNotes')}
                  rows={2}
                  placeholder={t('presenton.main.addANoteForThisSlide')}
                  value={slide.notes ?? ''}
                  onChange={(e) => {
                    update('notes', e.target.value);
                  }}
                />
              </label>
            </main>
            {settings && (
              <aside className="pn-settings">
                <h2>
                  <LayoutTemplate size={17} />
                  {t('presenton.settings.slideSettings')}
                </h2>
                <label>
                  {t('presenton.settings.theme')}
                  <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                    {themes.map(({ value: x, label }) => (
                      <option value={x} key={x}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="pn-theme-swatches">
                  {themes.map(({ value: x, label }) => (
                    <button
                      type="button"
                      key={x}
                      aria-label={t('presenton.settings.useTheme', {
                        theme: label,
                      })}
                      aria-pressed={theme === x}
                      className={`pn-theme-${x.toLowerCase()}`}
                      onClick={() => setTheme(x)}
                    >
                      <span>{t('presenton.settings.aa')}</span>
                      {label}
                    </button>
                  ))}
                </div>
                <h3>{t('presenton.settings.layout')}</h3>
                <p>
                  {slide.image
                    ? t('presenton.settings.textWithImage')
                    : t('presenton.settings.textSlide')}{' '}
                  {t('presenton.settings.illustrativeTemplate')}
                </p>
                <PreviewButton
                  onClick={() => {
                    setSlides((v) =>
                      v.map((s, i) =>
                        i === selected
                          ? { ...s, image: s.image ? undefined : '/demo/storybook/garden.jpg' }
                          : s,
                      ),
                    );
                    setSaved(false);
                  }}
                >
                  {t('presenton.settings.toggleSampleImage')}
                </PreviewButton>
              </aside>
            )}
          </div>
        </>
      )}
      {presenting && (
        <section
          className="pn-presentation"
          aria-label={t('presenton.presentation.presentationMode')}
        >
          <header>
            <strong>{title}</strong>
            <PreviewButton onClick={() => setPresenting(false)}>
              {t('presenton.presentation.exitPresentation')}
            </PreviewButton>
          </header>
          <div
            className={`pn-canvas pn-theme-${theme.toLowerCase()}${slide.image ? ' pn-canvas--image' : ''}`}
          >
            <div>
              <h1>{slide.title}</h1>
              <p>{slide.body}</p>
              <span>{t('presenton.presentation.presentonSampleDeck')}</span>
            </div>
            {slide.image && (
              <img src={slide.image} alt={t('presenton.presentation.sampleSlideIllustration')} />
            )}
          </div>
          <footer>
            <PreviewButton
              aria-label={t('presenton.presentation.previousSlide')}
              disabled={selected === 0}
              onClick={() => setSelected(selected - 1)}
            >
              <ArrowLeft size={18} />
            </PreviewButton>
            <span>
              {selected + 1} {' / '}
              {slides.length}
            </span>
            <PreviewButton
              aria-label={t('presenton.presentation.nextSlide')}
              disabled={selected === slides.length - 1}
              onClick={() => setSelected(selected + 1)}
            >
              <ArrowRight size={18} />
            </PreviewButton>
          </footer>
        </section>
      )}
    </RemainingPreview>
  );
}
