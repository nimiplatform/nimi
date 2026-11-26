import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import type { SourceDetailData } from './source-detail-model.js';
import { sourceDetailDisplayText } from './source-detail-world-character-copy.js';
import { uniqueStrings } from './source-detail-world-character-labels.js';
import { characterKnowledgeTopicText } from './source-detail-world-character-theme.js';

// Collapse rules for CharacterProfileText:
// 1. Minimum overflow lines: the toggle button sits on its own row (~1 line high),
//    so collapsing only triggers when rendered content overflows by at least 2 lines
//    (totalLines >= lines + 2), ensuring real vertical space is saved instead of
//    hiding a 1-line orphan tail behind a same-height button.
// 2. Minimum hidden content: when DOM Range geometry is available, the hidden
//    remainder must carry at least 24 visual character units (12 CJK or 24 ASCII
//    non-whitespace chars), preventing sparse newline tails from collapsing.
// 3. No orphan clamp: -webkit-line-clamp is applied only when the text actually
//    qualifies to collapse and is not expanded.
export const PROFILE_TEXT_MIN_OVERFLOW_LINES = 2;
export const PROFILE_TEXT_MIN_HIDDEN_UNITS = 24;

export function textVisualUnits(text: string): number {
  let units = 0;
  for (const ch of text) {
    if (/\s/u.test(ch)) continue;
    const code = ch.codePointAt(0) ?? 0;
    const isWide = (code >= 0x1100 && code <= 0x11FF)
      || (code >= 0x2E80 && code <= 0xA4CF)
      || (code >= 0xAC00 && code <= 0xD7AF)
      || (code >= 0xF900 && code <= 0xFAFF)
      || (code >= 0xFE10 && code <= 0xFE6F)
      || (code >= 0xFF01 && code <= 0xFF60)
      || (code >= 0xFFE0 && code <= 0xFFE6)
      || code >= 0x1F000;
    units += isWide ? 2 : 1;
  }
  return units;
}

export function shouldCollapseProfileText(metrics: {
  previewLines: number;
  contentHeight: number;
  lineHeight: number;
  hiddenText?: string | null;
}): boolean {
  const { previewLines, contentHeight, lineHeight, hiddenText } = metrics;
  if (previewLines <= 0 || contentHeight <= 0 || lineHeight <= 0) {
    return false;
  }
  const totalLines = Math.round(contentHeight / lineHeight);
  if (totalLines < previewLines + PROFILE_TEXT_MIN_OVERFLOW_LINES) {
    return false;
  }
  if (hiddenText != null && textVisualUnits(hiddenText) < PROFILE_TEXT_MIN_HIDDEN_UNITS) {
    return false;
  }
  return true;
}

function resolveProfileTextLineHeight(
  element: HTMLElement,
  computed: CSSStyleDeclaration | undefined,
  lines: number,
  clamped: boolean,
  verticalPadding: number,
): number {
  if (computed) {
    const parsed = Number.parseFloat(computed.lineHeight);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    const fontSize = Number.parseFloat(computed.fontSize);
    if (Number.isFinite(fontSize) && fontSize > 0) return fontSize * 1.5;
  }
  if (clamped && lines > 0) {
    const visibleHeight = element.clientHeight - verticalPadding;
    if (visibleHeight > 0) return visibleHeight / lines;
  }
  return 0;
}

function measureHiddenProfileText(
  element: HTMLElement,
  lines: number,
  lineHeight: number,
  paddingTop: number,
  borderTop: number,
): string | null {
  const textNode = element.firstChild;
  const textNodeType = element.ownerDocument?.defaultView?.Node?.TEXT_NODE ?? 3;
  if (!textNode || textNode.nodeType !== textNodeType) return null;
  const text = textNode.textContent ?? '';
  if (!text) return '';
  const doc = element.ownerDocument;
  if (!doc || typeof doc.createRange !== 'function') return null;

  const elementRect = element.getBoundingClientRect();
  if (elementRect.height <= 0) return null;

  const range = doc.createRange();
  const charMidY = (index: number): number | null => {
    let start = index;
    const code = text.charCodeAt(start);
    if (code >= 0xDC00 && code <= 0xDFFF && start > 0) {
      start -= 1;
    }
    const startCode = text.charCodeAt(start);
    const end = startCode >= 0xD800 && startCode <= 0xDBFF && start + 1 < text.length
      ? start + 2
      : start + 1;
    range.setStart(textNode, start);
    range.setEnd(textNode, end);
    const rect = range.getBoundingClientRect();
    if (rect.height <= 0 && rect.width <= 0) return null;
    return (rect.top + rect.bottom) / 2;
  };

  const lastY = charMidY(text.length - 1);
  if (lastY === null) return null;

  const cutoffY = elementRect.top + paddingTop + borderTop + lines * lineHeight;
  if (lastY < cutoffY) return '';

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const midY = charMidY(mid);
    if (midY === null) return null;
    if (midY >= cutoffY) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return text.slice(low);
}

function shouldCollapseProfileTextElement(
  element: HTMLElement,
  lines: number,
  clamped: boolean,
): boolean {
  const computed = element.ownerDocument?.defaultView?.getComputedStyle(element);
  const paddingTop = computed ? (Number.parseFloat(computed.paddingTop) || 0) : 0;
  const paddingBottom = computed ? (Number.parseFloat(computed.paddingBottom) || 0) : 0;
  const borderTop = computed ? (Number.parseFloat(computed.borderTopWidth) || 0) : 0;
  const verticalPadding = paddingTop + paddingBottom;
  const lineHeight = resolveProfileTextLineHeight(element, computed, lines, clamped, verticalPadding);
  const contentHeight = Math.max(0, element.scrollHeight - verticalPadding);
  if (!shouldCollapseProfileText({ previewLines: lines, contentHeight, lineHeight })) {
    return false;
  }
  const hiddenText = measureHiddenProfileText(element, lines, lineHeight, paddingTop, borderTop);
  return shouldCollapseProfileText({ previewLines: lines, contentHeight, lineHeight, hiddenText });
}

// Shared right-column (dossier) typographic scale:
// - Section headings: 14px / semibold / primary (step down from left column's 18px / 16px)
// - Sub-labels & inline disclosure triggers: 12px / medium / muted
// - Body copy: 13px / 1.7 / secondary
// Note: text-[14px] is asserted by source-detail-world-character-profile-contract.test.ts.
export const DOSSIER_SECTION_HEADING_CLASS = 'text-[14px] font-semibold tracking-[0.01em] text-[var(--nimi-text-primary)]';
export const DOSSIER_FIELD_LABEL_CLASS = 'text-xs font-medium text-[var(--nimi-text-muted)]';
export const DOSSIER_BODY_TEXT_CLASS = 'text-[0.8125rem] leading-[1.7] text-[var(--nimi-text-secondary)]';

// Clamp only the reading preview; the complete authored text remains available.
export function CharacterProfileText({
  text,
  lines = 4,
  testId,
  className = '',
  textClassName = 'text-[0.9375rem] leading-[1.82] text-[var(--nimi-text-secondary)]',
}: {
  text: string;
  lines?: number;
  testId?: string;
  className?: string;
  textClassName?: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  const ref = useRef<HTMLParagraphElement>(null);
  const displayText = text.trim();
  const [expanded, setExpanded] = useState(false);
  const [collapsible, setCollapsible] = useState(false);
  const clamped = collapsible && !expanded;
  const clampedRef = useRef(clamped);
  clampedRef.current = clamped;

  useLayoutEffect(() => {
    setExpanded(false);
    setCollapsible(false);
    const element = ref.current;
    if (!element) return;
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      if (element.clientWidth <= 0 || element.scrollHeight <= 0) return;
      const nextCollapsible = shouldCollapseProfileTextElement(element, lines, clampedRef.current);
      setCollapsible(nextCollapsible);
      if (!nextCollapsible) {
        setExpanded(false);
      }
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    const fonts = element.ownerDocument?.fonts;
    if (fonts?.ready) {
      void fonts.ready.then(measure);
    }
    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [displayText, lines]);

  return <div className="min-w-0">
    <p ref={ref} id={id} data-testid={testId}
      className={`whitespace-pre-wrap break-words ${textClassName} ${className}`.trim()}
      style={clamped ? { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: lines, overflow: 'hidden' } : undefined}>
      {displayText}
    </p>
    {collapsible ? <button type="button" aria-expanded={expanded} aria-controls={id}
      onClick={() => setExpanded(value => !value)}
      className="mt-1.5 rounded text-xs font-medium tracking-[0.02em] text-[var(--nimi-action-primary-bg)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]">
      {expanded ? t('SourceDetail.worldCharacter.readLess') : t('SourceDetail.worldCharacter.readMore')}
    </button> : null}
  </div>;
}

export function characterAboutParagraphs(source: SourceDetailData) {
  // Narrative and public card summary are different authored fields. A full
  // narrative takes precedence over the short discovery card introduction.
  const intro = source.characterProfile.narrativeSummary?.trim()
    || source.entity?.summary?.trim() || source.bio?.trim();
  const headerLine = source.characterProfile.role?.trim() || source.characterProfile.profileLine?.trim();
  const disposition = source.characterProfile.disposition?.trim();
  return [
    { id: 'character-introduction', text: intro === headerLine ? null : intro },
    { id: 'character-disposition', text: disposition === intro ? null : disposition },
  ].filter((item): item is { id: string; text: string } => Boolean(item.text));
}

export function characterIdentitySpecs(source: SourceDetailData) {
  const profile = source.characterProfile;
  const age = profile.ageDescription?.trim() || null;
  const species = profile.speciesDescription?.trim() || null;
  const items: Array<{ key: 'age' | 'species'; text: string }> = [];
  if (age) items.push({ key: 'age', text: age });
  if (species && species !== age) items.push({ key: 'species', text: species });
  return items;
}

export function characterAppearanceDetails(source: SourceDetailData) {
  return uniqueStrings([
    source.characterProfile.bodyDescription,
    source.characterProfile.lifeStageDescription !== source.characterProfile.ageDescription
      ? source.characterProfile.lifeStageDescription : null,
    source.characterProfile.interaction?.tone,
    source.characterProfile.interaction?.cadence,
  ]);
}

export function hasCharacterGuidanceContent(source: SourceDetailData): boolean {
  const profile = source.characterProfile;
  return Boolean(
    uniqueStrings(profile.drives ?? []).length
    || uniqueStrings(profile.knowledgeTopics).length
    || uniqueStrings(profile.boundaries ?? []).length
    || uniqueStrings(profile.knowledgeConstraints).length,
  );
}

export function hasCharacterProfileSpecs(source: SourceDetailData): boolean {
  return Boolean(characterIdentitySpecs(source).length || characterAppearanceDetails(source).length);
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r033
export function CharacterAboutSection({ source }: { source: SourceDetailData }) {
  const { t } = useTranslation();
  const paragraphs = characterAboutParagraphs(source);
  if (!paragraphs.length) return null;
  const intro = paragraphs.find((item) => item.id === 'character-introduction');
  const disposition = paragraphs.find((item) => item.id === 'character-disposition');

  return (
    <section data-testid="world-character-about-section" className="min-w-0 max-w-[58ch]">
      <h2 className="text-lg font-semibold tracking-[-0.01em] text-[var(--nimi-text-primary)]">
        {t('SourceDetail.worldCharacter.aboutTitle', { name: source.displayName })}
      </h2>
      <div className="mt-4 grid gap-5">
        {intro ? <CharacterProfileText testId={intro.id} text={intro.text} lines={5} /> : null}
        {disposition ? (
          <div className={intro ? 'border-t border-[var(--nimi-border-subtle)]/75 pt-4' : ''}>
            <span className="block text-xs font-medium text-[var(--nimi-text-muted)]">
              {t('SourceDetail.worldCharacter.dispositionLabel', { defaultValue: 'Personality' })}
            </span>
            <CharacterProfileText
              testId={disposition.id}
              text={disposition.text}
              lines={4}
              className="mt-1.5"
              textClassName="text-[0.9375rem] leading-[1.8] text-[var(--nimi-text-primary)]"
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function CharacterLifeEventsSection({ lifeEvents }: {
  lifeEvents: SourceDetailData['characterProfile']['milestones'];
}) {
  const { t, i18n } = useTranslation();
  const display = (text: string) => sourceDetailDisplayText(text, i18n.resolvedLanguage ?? i18n.language);
  if (!lifeEvents.length) return null;

  return (
    <section data-testid="character-life-events" className="min-w-0 max-w-[58ch]">
      <h2 className="text-lg font-semibold tracking-[-0.01em] text-[var(--nimi-text-primary)]">
        {t('SourceDetail.worldCharacter.lifeEventsTitle')}
      </h2>
      <ol role="list" className="relative mt-5 space-y-6 before:absolute before:bottom-2 before:left-[3px] before:top-2.5 before:w-px before:bg-[var(--nimi-border-subtle)]">
        {lifeEvents.map((event) => {
          const title = display(event.title);
          const summary = event.summary ? display(event.summary) : null;
          return (
            <li key={event.id} className="relative min-w-0 pl-6">
              <span
                aria-hidden="true"
                className="absolute left-0 top-[8px] h-[7px] w-[7px] rounded-full bg-[color-mix(in_srgb,var(--nimi-text-muted)_65%,transparent)] ring-4 ring-[var(--nimi-surface-card)]"
              />
              <div className="min-w-0">
                {event.timeLabel ? (
                  <p className="mb-0.5 text-xs font-medium tabular-nums text-[var(--nimi-text-muted)]">
                    {display(event.timeLabel)}
                  </p>
                ) : null}
                <p className="break-words text-[0.9375rem] font-semibold leading-snug text-[var(--nimi-text-primary)]">{title}</p>
              </div>
              {summary && summary !== title ? (
                <CharacterProfileText
                  text={summary}
                  lines={4}
                  className="mt-1.5"
                  textClassName="text-[0.90625rem] leading-[1.78] text-[var(--nimi-text-secondary)]"
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r033
export function CharacterGuidanceCard({ source }: { source: SourceDetailData }) {
  const { t } = useTranslation();
  const profile = source.characterProfile;
  const drives = uniqueStrings(profile.drives ?? []);
  const topics = uniqueStrings(profile.knowledgeTopics);
  const boundaries = uniqueStrings(profile.boundaries ?? []);
  const constraints = uniqueStrings(profile.knowledgeConstraints).filter((item) => !boundaries.includes(item));

  if (!drives.length && !topics.length && !boundaries.length && !constraints.length) {
    return null;
  }

  const localizedTopics = topics.map((topic) => ({
    raw: topic,
    label: characterKnowledgeTopicText(topic, t),
  }));
  const compactTopicChips = localizedTopics.length > 0
    && localizedTopics.every((item) => item.label.length <= 14 && !/[:：]/u.test(item.label));

  return (
    <div data-testid="world-character-guidance-card" className="char-folio-section grid min-w-0 gap-6">
      {drives.length ? (
        <section data-testid="world-character-drives-section" className="min-w-0">
          <h2 className={DOSSIER_SECTION_HEADING_CLASS}>
            {t('SourceDetail.worldCharacter.drivesTitle')}
          </h2>
          <ul role="list" className="mt-2.5 space-y-2.5">
            {drives.map((text) => (
              <li key={text}>
                <CharacterProfileText text={text} lines={3} textClassName={DOSSIER_BODY_TEXT_CLASS} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {topics.length || boundaries.length || constraints.length ? (
        <section
          data-testid="world-character-knowledge-section"
          className={`min-w-0 ${drives.length ? 'border-t border-[color-mix(in_srgb,var(--nimi-border-subtle)_75%,transparent)] pt-5' : ''}`}
        >
          {topics.length ? (
            <>
              <h2 className={DOSSIER_SECTION_HEADING_CLASS}>
                {t('SourceDetail.worldCharacter.knowledgeTitle')}
              </h2>
              {compactTopicChips ? (
                <ul role="list" className="mt-2.5 flex flex-wrap gap-1.5">
                  {localizedTopics.map((item) => (
                    <li
                      key={item.raw}
                      className="rounded-[6px] bg-[var(--nimi-surface-card)] px-2.5 py-1 text-xs font-medium text-[var(--nimi-text-secondary)]"
                    >
                      {item.label}
                    </li>
                  ))}
                </ul>
              ) : (
                <ul role="list" className={`mt-2.5 space-y-2 ${DOSSIER_BODY_TEXT_CLASS}`}>
                  {localizedTopics.map((item) => (
                    <li key={item.raw} className="min-w-0 break-words">
                      {item.label}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}

          {boundaries.length || constraints.length ? (
            <div data-testid="world-character-guidance" className={`${topics.length ? 'mt-5 border-t border-[color-mix(in_srgb,var(--nimi-border-subtle)_75%,transparent)] pt-5' : ''} grid gap-5`}>
              {boundaries.length ? (
                <aside data-testid="world-character-boundaries" className="min-w-0">
                  <h3 className={DOSSIER_SECTION_HEADING_CLASS}>
                    {t('SourceDetail.worldCharacter.boundariesTitle', { defaultValue: 'Boundaries' })}
                  </h3>
                  <ul role="list" className="mt-2.5 space-y-2">
                    {boundaries.map((text) => (
                      <li key={text}>
                        <CharacterProfileText text={text} lines={3} textClassName={DOSSIER_BODY_TEXT_CLASS} />
                      </li>
                    ))}
                  </ul>
                </aside>
              ) : null}

              {constraints.length ? (
                <aside
                  data-testid="world-character-constraints"
                  className={`min-w-0 ${boundaries.length ? 'border-t border-[color-mix(in_srgb,var(--nimi-border-subtle)_75%,transparent)] pt-5' : ''}`}
                >
                  <h3 className={DOSSIER_SECTION_HEADING_CLASS}>
                    {t('SourceDetail.worldCharacter.constraintsTitle', { defaultValue: 'Knowledge & access limits' })}
                  </h3>
                  <ul role="list" className="mt-2.5 space-y-2">
                    {constraints.map((text) => (
                      <li key={text}>
                        <CharacterProfileText text={text} lines={3} textClassName={DOSSIER_BODY_TEXT_CLASS} />
                      </li>
                    ))}
                  </ul>
                </aside>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export function CharacterProfileSpecsCard({ source }: { source: SourceDetailData }) {
  const { t } = useTranslation();
  const identitySpecs = characterIdentitySpecs(source);
  const appearanceDetails = characterAppearanceDetails(source);

  if (!identitySpecs.length && !appearanceDetails.length) {
    return null;
  }

  return (
    <section
      data-testid="world-character-profile-specs"
      className="char-folio-section min-w-0"
    >
      <h2 className={DOSSIER_SECTION_HEADING_CLASS}>
        {t('SourceDetail.worldCharacter.profileDetailsTitle', { defaultValue: 'Appearance & profile' })}
      </h2>

      {identitySpecs.length ? (
        <dl className="mt-3 grid gap-3.5">
          {identitySpecs.map((item) => (
            <div key={item.key} className="min-w-0">
              <dt className={DOSSIER_FIELD_LABEL_CLASS}>
                {item.key === 'age'
                  ? t('SourceDetail.worldCharacter.profileIdentityField', { defaultValue: 'Age & form' })
                  : t('SourceDetail.worldCharacter.profileSpeciesField', { defaultValue: 'Species & traits' })}
              </dt>
              <dd className="mt-1">
                <CharacterProfileText text={item.text} lines={3} textClassName={DOSSIER_BODY_TEXT_CLASS} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {appearanceDetails.length ? (
        <div className={identitySpecs.length ? 'mt-4 border-t border-[color-mix(in_srgb,var(--nimi-border-subtle)_70%,transparent)] pt-3.5' : 'mt-3'}>
          <CharacterAppearanceDisclosure source={source} />
        </div>
      ) : null}
    </section>
  );
}

export function CharacterAppearanceDisclosure({ source }: { source: SourceDetailData }) {
  const { t } = useTranslation();
  const details = characterAppearanceDetails(source);
  if (!details.length) return null;
  return <details data-testid="world-character-appearance-disclosure" className="group text-[var(--nimi-text-secondary)]">
    <summary className={`flex w-full cursor-pointer list-none items-center justify-between gap-2 rounded-md py-0.5 ${DOSSIER_FIELD_LABEL_CLASS} transition-colors hover:text-[var(--nimi-text-primary)] group-open:text-[var(--nimi-text-secondary)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] [&::-webkit-details-marker]:hidden`}>
      <span>{t('SourceDetail.worldCharacter.appearanceVoiceTitle')}</span>
      <ChevronDown aria-hidden className="h-3.5 w-3.5 shrink-0 text-[var(--nimi-text-muted)] transition-transform group-open:rotate-180 motion-reduce:transition-none" />
    </summary>
    <div className="mt-2 grid gap-2">
      {details.map(text => <CharacterProfileText key={text} text={text} lines={4} textClassName={DOSSIER_BODY_TEXT_CLASS} />)}
    </div>
  </details>;
}
