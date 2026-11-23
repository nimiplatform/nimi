import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { EntityAvatar } from '../../components/entity-avatar.js';
import type { SourceDetailData } from './source-detail-model.js';
import { uniqueStrings } from './source-detail-world-character-labels.js';
import { relationKindLabel } from './source-detail-world-character-theme.js';
import { relationshipDetailCopy, sourceDetailDisplayText } from './source-detail-world-character-copy.js';
import { DOSSIER_BODY_TEXT_CLASS, DOSSIER_SECTION_HEADING_CLASS } from './source-detail-character-content.js';

type RelationshipClueItem = {
  id: string;
  type: string | null;
  targetId: string | null;
  title: string;
  titlePriority: number;
  summary: string | null;
  details: string[];
  group: RelationshipGroup;
};

type RelationshipGroup = 'people' | 'life' | 'works' | 'objects' | 'background';

// Entity kinds are author-defined (for example port-town or restaurant).
// Explicit place/occupation relations can still place those facts correctly;
// none of these labels are used to infer that an endpoint is a person.
const LIFE_RELATIONS = new Set([
  'status', 'entry', 'postedToOffice', 'postedAddress', 'biogAddress',
  'inhabits', 'inhabitant-of', 'dwells-in', 'dwells-near', 'dwells-on', 'dwells-upon',
  'residence', 'resident-of', 'resides-at', 'resides-in', 'home-resident', 'local-resident',
  'seasonal-resident', 'native-ground', 'native-habitat', 'based-in', 'anchors-at',
  'workplace', 'works-at', 'works-in', 'works-for', 'employed-at', 'former-workplace',
  'holds-office-at', 'serves-at', 'serves-in', 'organization-post', 'affiliated-with',
  'member-of', 'trades-at', 'trades-in', 'trading-ground', 'stall-site', 'operates-at',
  'operates-in', 'studies-at', 'teaches-at', 'enrolled-at', 'enrolled-in', 'apprentice-at',
  'duty-station', 'stationed-at', 'frequents', 'visits', 'travels-along', 'travel-route',
  'operates', 'operates-stall', 'shop-owner', 'business-owner', 'proprietor', 'stall-holder',
  'livelihood', 'livelihood-anchor', 'cultivates', 'harvests', 'mines',
  'commutes-via', 'regular-passenger', 'transports-along', 'navigates',
]);

// @nimi-authority: rule.nimi.desktop.product-surfaces.r033
function relationshipGroup(source: SourceDetailData, targetId: string | null, type: string | null): RelationshipGroup {
  const selfId = source.sourceRef.kind === 'worldCharacter' ? source.sourceRef.worldEntityRef.entityId : null;
  const target = targetId && targetId !== selfId ? source.relationshipTargets[targetId] : null;
  const kind = target?.kind;
  if (kind === 'person' || kind === 'human' || target?.isCharacter === true) return 'people';
  if (['creator-of', 'co-creator-of', 'paints', 'authoredText', 'text', 'director', 'stars-in', 'lead-actress'].includes(type ?? '')) return 'works';
  if (['place', 'location', 'organization', 'office', 'status'].includes(kind ?? '')
    || LIFE_RELATIONS.has(type ?? '')) return 'life';
  if (['work', 'text'].includes(kind ?? '')) return 'works';
  if (['item', 'object', 'artifact', 'plant'].includes(kind ?? '')) return 'objects';
  return 'background';
}

function explicitRelationshipType(value: string | null | undefined): string | null {
  const type = value?.trim();
  return type || null;
}

// Builds text entries from explicit relationship fields only. The title is
// the explicit target label, then the explicit relation label, then the
// localized explicit type, then the summary. Names are never extracted from
// prose, and a value that equals a known source or entity id is treated as an
// identifier, not display text.
export function buildRelationshipClueItems(
  source: SourceDetailData,
  t: ReturnType<typeof useTranslation>['t'],
): RelationshipClueItem[] {
  const sourceIds = [source.id, source.sourceId, source.worldId, source.entity?.id, source.runtimeSourceRef];
  const displayText = (value: string | null | undefined, ids: readonly (string | null | undefined)[]): string | null => {
    const text = value?.trim();
    if (!text || [...sourceIds, ...ids].some((id) => id && id.trim() === text)) {
      return null;
    }
    return text;
  };
  const byRelationship = new Map<string, RelationshipClueItem>();
  const items: RelationshipClueItem[] = [];
  const add = (item: RelationshipClueItem) => {
    // A type alone (or a shared display name) cannot identify a relationship.
    // Without both type and target, only merge identical displayed entries.
    const key = item.type && item.targetId
      ? JSON.stringify([item.type, item.targetId])
      : JSON.stringify([item.type, item.targetId, item.title, item.summary]);
    const existing = byRelationship.get(key);
    if (existing) {
      const titles = [existing, item]
        .filter((entry) => entry.titlePriority >= 2)
        .map((entry) => entry.title);
      if (item.titlePriority > existing.titlePriority) {
        existing.title = item.title;
        existing.titlePriority = item.titlePriority;
      }
      const summaries = uniqueStrings([existing.summary, item.summary])
        .filter((summary) => summary !== existing.title);
      existing.summary = summaries.shift() ?? null;
      existing.details = uniqueStrings([
        ...existing.details, ...summaries, ...item.details, ...titles,
      ]).filter((detail) => detail !== existing.title && detail !== existing.summary);
      return;
    }
    byRelationship.set(key, item);
    items.push(item);
  };

  for (const clue of source.relationshipClues) {
    const ids = [clue.id, clue.targetEntityId];
    const label = clue.label === clue.type && clue.type
      ? relationKindLabel(clue.type, t)
      : displayText(clue.label, ids);
    const summary = displayText(clue.summary, ids);
    const targetLabel = displayText(clue.targetLabel, ids);
    const resolvedLabel = clue.targetEntityId ? source.relationshipTargets[clue.targetEntityId]?.name : null;
    const title = displayText(resolvedLabel, ids) ?? targetLabel
      ?? label
      ?? (clue.type ? relationKindLabel(clue.type, t) : null)
      ?? summary;
    if (!title) {
      continue;
    }
    add({
      id: clue.id,
      type: clue.type,
      targetId: clue.targetEntityId?.trim() || null,
      title,
      titlePriority: resolvedLabel || targetLabel ? 3 : label && clue.label !== clue.type ? 2 : clue.type ? 1 : 0,
      summary: summary && summary !== title ? summary : null,
      details: uniqueStrings([label, ...clue.details]).filter((detail) => detail !== title && detail !== summary),
      group: relationshipGroup(source, clue.targetEntityId, clue.type),
    });
  }

  for (const note of source.characterProfile.relationshipNotes) {
    const type = explicitRelationshipType(note.type);
    const ids = [note.id, note.targetRef];
    const summary = displayText(note.summary, ids);
    const targetLabel = note.targetRef
      ? source.relationshipTargets[note.targetRef]?.name ?? source.relationshipTargetLabels[note.targetRef] ?? null
      : null;
    const targetTitle = displayText(targetLabel, ids);
    const title = targetTitle
      ?? (type ? relationKindLabel(type, t) : null)
      ?? summary;
    if (!title) {
      continue;
    }
    add({
      id: note.id,
      type,
      targetId: note.targetRef?.trim() || null,
      title,
      titlePriority: targetTitle ? 3 : type ? 1 : 0,
      summary: summary && summary !== title ? summary : null,
      details: [],
      group: relationshipGroup(source, note.targetRef, type),
    });
  }

  return items;
}

function mergePeopleByTarget(items: readonly RelationshipClueItem[], t: ReturnType<typeof useTranslation>['t']) {
  const groups = new Map<string | RelationshipClueItem, RelationshipClueItem[]>();
  for (const item of items) {
    const key = item.targetId ?? item;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return Array.from(groups.values(), group => {
    const primary = group.reduce((best, item) => item.titlePriority > best.titlePriority ? item : best);
    const labelsFor = (rows: readonly RelationshipClueItem[]) =>
      uniqueStrings(rows.map(item => item.type && relationKindLabel(item.type, t)));
    const kindLabels = labelsFor(group);
    const summaries = uniqueStrings(group.map(item => item.summary)).filter(summary => summary !== primary.title);
    const details = uniqueStrings(group.flatMap(item => item.details))
      .filter(detail => detail !== primary.title && !kindLabels.includes(detail) && !summaries.includes(detail));
    const descriptions = summaries.map(summary => {
      if (summaries.length === 1 || kindLabels.length < 2) return summary;
      const labels = labelsFor(group.filter(item => item.summary === summary));
      return [...labels, summary].join(' · ');
    });
    return { ...primary, kindLabels, summary: descriptions[0], details: [...descriptions.slice(1), ...details] };
  });
}

export function WorldCharacterRelationshipCluesSection({ source }: { source: SourceDetailData }) {
  const { t } = useTranslation();
  const items = mergePeopleByTarget(
    buildRelationshipClueItems(source, t).filter(item => item.group === 'people'),
    t,
  );
  return <CharacterRelationships key={source.id} items={items} targets={source.relationshipTargets} />;
}

function CharacterRelationships({
  items,
  targets,
}: {
  items: ReturnType<typeof mergePeopleByTarget>;
  targets: SourceDetailData['relationshipTargets'];
}) {
  const { t } = useTranslation();
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  if (!items.length) return null;
  const visibleItems = expanded ? items : items.slice(0, 4);
  return <section data-testid="world-character-relationship-clues-section" className="char-folio-section min-w-0">
    <h2 className={DOSSIER_SECTION_HEADING_CLASS}>
      {t('SourceDetail.worldCharacter.relationshipTitle')}
    </h2>
    <ul id={listId} data-testid="world-character-relationship-list" role="list" className="mt-2.5 divide-y divide-[color-mix(in_srgb,var(--nimi-border-subtle)_65%,transparent)]">
      {visibleItems.map(item => {
        const target = item.targetId ? targets[item.targetId] : null;
        const visibleKinds = item.kindLabels.filter(kind => kind !== item.title);
        const expandable = item.details.length > 0 || (item.summary ? item.summary.length > 48 : false);
        const rowBody = (
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            {item.title.trim() ? (
              <EntityAvatar
                imageUrl={target?.avatarUrl}
                media={target?.avatarMedia}
                name={item.title}
                kind="human"
                shape="circle"
                sizeClassName="mt-0.5 h-7 w-7 shrink-0"
                radiusClassName="rounded-full"
                className="ring-1 ring-[color-mix(in_srgb,var(--nimi-border-subtle)_80%,transparent)]"
                fallbackClassName="bg-[var(--nimi-surface-card)] text-[var(--nimi-text-secondary)]"
                textClassName="text-xs font-semibold"
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="break-words text-[13px] font-semibold text-[var(--nimi-text-primary)]">{item.title}</p>
                {visibleKinds.map(kind => <p key={kind} className="rounded bg-[color-mix(in_srgb,var(--nimi-text-primary)_6%,transparent)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--nimi-text-muted)]">{kind}</p>)}
              </div>
              {item.summary ? (
                <p className={`mt-1 whitespace-pre-wrap break-words ${DOSSIER_BODY_TEXT_CLASS} ${expandable ? 'line-clamp-2 group-open:line-clamp-none' : ''}`}>
                  {item.summary}
                </p>
              ) : null}
            </div>
          </div>
        );

        return <li key={item.id} data-testid={`world-character-relationship-clue-${item.type ?? 'untyped'}`}>
          {expandable ? (
            <details className="group">
              <summary className="-mx-2 flex cursor-pointer list-none items-start gap-2 rounded-[10px] px-2 py-3 transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_80%,transparent)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] [&::-webkit-details-marker]:hidden">
                {rowBody}
                <ChevronDown aria-hidden className="mt-1.5 h-4 w-4 shrink-0 text-[var(--nimi-text-muted)] transition-transform group-open:rotate-180 motion-reduce:transition-none" />
              </summary>
              {item.details.length ? <div className="mb-3 ml-9.5 space-y-1.5">
                {item.details.map(detail => <p key={detail} className={`whitespace-pre-wrap break-words ${DOSSIER_BODY_TEXT_CLASS}`}>{detail}</p>)}
              </div> : null}
            </details>
          ) : (
            <div className="flex items-start gap-2 py-3">
              {rowBody}
            </div>
          )}
        </li>;
      })}
    </ul>
    {items.length > 4 ? <button type="button" aria-expanded={expanded} aria-controls={listId}
      onClick={() => setExpanded(value => !value)}
      className="mt-2 rounded py-1 text-xs font-medium text-[var(--nimi-action-primary-bg)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]">
      {expanded ? t('SourceDetail.worldCharacter.relationshipsShowLess') : t('SourceDetail.worldCharacter.relationshipsShowAll', { count: items.length })}
    </button> : null}
  </section>;
}

export function WorldCharacterBackgroundSections({ source }: { source: SourceDetailData }) {
  const { t } = useTranslation();
  const items = buildRelationshipClueItems(source, t);
  return <>{(['life', 'objects'] as const).map(group => (
    <RelationshipTextSection key={group} group={group} sourceName={source.displayName} items={items.filter(item => item.group === group)} />
  ))}</>;
}

// Historical relation types supply the categories, never a person's name or
// words inside a summary. Other authored settings keep their own descriptions.
const LIFE_COPY_GROUPS = ['entry', 'postedToOffice', 'postedAddress', 'biogAddress', 'status'] as const;

function LifeContextGroups({ items, sourceName }: { items: RelationshipClueItem[]; sourceName: string }) {
  const { t, i18n } = useTranslation();
  const display = (text: string) => sourceDetailDisplayText(text, i18n.resolvedLanguage ?? i18n.language);
  return <>{LIFE_COPY_GROUPS.map(type => {
    const members = items.filter(item => item.type === type);
    if (members.length === 0) return null;
    const compact: RelationshipClueItem[] = [];
    const descriptions: { item: RelationshipClueItem; summary: string }[] = [];
    for (const item of members) {
      // Only replace relation-only prose when a real endpoint label is known.
      const summary = item.titlePriority >= 2
        ? relationshipDetailCopy(item.summary, sourceName, item.title, item.type)
        : item.summary;
      if (summary) descriptions.push({ item, summary });
      else compact.push(item);
    }
    return <li key={type} data-testid={`world-character-life-clue-${type}`} className={`${DOSSIER_BODY_TEXT_CLASS} [overflow-wrap:anywhere]`}>
      <h3 className="text-xs font-semibold text-[var(--nimi-text-primary)]">{t(`SourceDetail.worldCharacter.lifeGroups.${type}`)}</h3>
      {descriptions.map(({ item, summary }) => {
        const prose = display(summary);
        const title = display(item.title);
        const context = uniqueStrings([prose.includes(title) ? null : title, ...item.details.map(display)]);
        return <div key={item.id} className="mt-1 whitespace-pre-wrap">
          <p>{prose}</p>
          {context.length > 0 ? <p className="text-xs text-[var(--nimi-text-muted)]">{context.join(' · ')}</p> : null}
        </div>;
      })}
      {compact.length > 0 ? <p className="mt-1">{compact.map((item, index) => <span key={item.id}>
        {index > 0 ? t('SourceDetail.worldCharacter.listSeparator') : null}
        {display(item.title)}{item.details.length > 0 ? t('SourceDetail.worldCharacter.relationshipContext', { context: item.details.map(display).join(' · ') }) : null}
      </span>)}</p> : null}
    </li>;
  })}</>;
}

function RelationshipTextSection({ items, group, sourceName }: { items: RelationshipClueItem[]; group: 'life' | 'objects'; sourceName: string }) {
  const { t, i18n } = useTranslation();
  const display = (text: string) => group === 'life'
    ? sourceDetailDisplayText(text, i18n.resolvedLanguage ?? i18n.language) : text;
  if (items.length === 0) return null;
  const titles = {
    life: t('SourceDetail.worldCharacter.lifeContextTitle', { defaultValue: 'Life and work' }),
    objects: t('SourceDetail.worldCharacter.objectsTitle', { defaultValue: 'Related objects' }),
  };
  const testId = `world-character-${group}`;

  return (
    <section
      data-testid={`${testId}-clues-section`}
      className="char-folio-section min-w-0"
    >
      <h2 className={DOSSIER_SECTION_HEADING_CLASS}>
        {titles[group]}
      </h2>
      <ul data-testid={`${testId}-list`} role="list" className="mt-3 space-y-3.5">
        {group === 'life' ? <LifeContextGroups items={items} sourceName={sourceName} /> : null}
        {items.filter(item => group !== 'life' || !LIFE_COPY_GROUPS.some(type => type === item.type)).map((item) => {
          const kind = item.type ? relationKindLabel(item.type, t) : null;
          const prose = display(item.summary ?? item.title);
          // Preserve explicit target/type metadata even when the prose does not
          // state it. Only exact whole-text duplicates are omitted; no relation
          // or person is inferred from a mention inside an authored sentence.
          const context = uniqueStrings([
            item.summary ? display(item.title) : null,
            kind,
          ]).filter((text) => text !== prose);
          return (
            <li
              key={item.id}
              data-testid={testId + '-clue-' + (item.type ?? 'untyped')}
              className={`whitespace-pre-wrap ${DOSSIER_BODY_TEXT_CLASS} [overflow-wrap:anywhere]`}
            >
              <p>
                {prose}
                {context.length > 0 ? (
                  <span className="text-xs text-[var(--nimi-text-muted)]">
                    {' '}{t('SourceDetail.worldCharacter.relationshipContext', {
                      context: context.join(' · '),
                      defaultValue: '({{context}})',
                    })}
                  </span>
                ) : null}
              </p>
              {item.details.length > 0 ? (
                <p className={`mt-1 ${DOSSIER_BODY_TEXT_CLASS}`}>{item.details.map(display).join(' · ')}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
