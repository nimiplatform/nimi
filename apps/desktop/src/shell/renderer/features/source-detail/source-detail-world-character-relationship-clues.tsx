import { useTranslation } from 'react-i18next';
import type { SourceDetailData } from './source-detail-model.js';
import { uniqueStrings } from './source-detail-world-character-labels.js';
import { relationKindLabel } from './source-detail-world-character-theme.js';
import { CharacterProfileText } from './source-detail-character-content.js';

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

export function WorldCharacterRelationshipCluesSection({ source }: { source: SourceDetailData }) {
  const { t } = useTranslation();
  const items = buildRelationshipClueItems(source, t).filter(item => item.group === 'people');
  return <RelationshipTextSection items={items} group="people" />;
}

export function WorldCharacterBackgroundSections({ source }: { source: SourceDetailData }) {
  const { t } = useTranslation();
  const items = buildRelationshipClueItems(source, t);
  return <>{(['life', 'objects'] as const).map(group => (
    <RelationshipTextSection key={group} group={group} items={items.filter(item => item.group === group)} />
  ))}</>;
}

function RelationshipTextSection({ items, group }: { items: RelationshipClueItem[]; group: 'people' | 'life' | 'objects' }) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  const titles = {
    people: t('SourceDetail.worldCharacter.relationshipTitle', { defaultValue: 'Character relationships' }),
    life: t('SourceDetail.worldCharacter.lifeContextTitle', { defaultValue: 'Life and work' }),
    objects: t('SourceDetail.worldCharacter.objectsTitle', { defaultValue: 'Related objects' }),
  };
  const testId = group === 'people' ? 'world-character-relationship' : `world-character-${group}`;

  return (
    <section
      data-testid={`${testId}-clues-section`}
      className="min-w-0 border-t border-[var(--nimi-border-subtle)] pt-5"
    >
      <h2 className="text-xl font-semibold text-[var(--nimi-text-primary)]">
        {titles[group]}
      </h2>
      <ul data-testid={`${testId}-list`} role="list" className={group === 'people' ? 'mt-3 divide-y divide-[var(--nimi-border-subtle)]' : 'mt-4 space-y-4'}>
        {items.map((item) => {
          const kind = item.type ? relationKindLabel(item.type, t) : null;
          const prose = item.summary ?? item.title;
          // Preserve explicit target/type metadata even when the prose does not
          // state it. Only exact whole-text duplicates are omitted; no relation
          // or person is inferred from a mention inside an authored sentence.
          const context = uniqueStrings([
            item.summary ? item.title : null,
            kind,
          ]).filter((text) => text !== prose);
          if (group === 'people') return <li key={item.id}
            data-testid={testId + '-clue-' + (item.type ?? 'untyped')}
            className="grid grid-cols-[minmax(64px,0.25fr)_minmax(0,1fr)] gap-4 py-3">
            <div className="min-w-0 break-words">
              <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">{item.title}</p>
              {kind && kind !== item.title ? <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">{kind}</p> : null}
            </div>
            <div className="min-w-0 space-y-1">
              {item.summary ? <CharacterProfileText text={item.summary} lines={2} /> : null}
              {item.details.map(detail => <CharacterProfileText key={detail} text={detail} lines={2} />)}
            </div>
          </li>;
          return (
            <li
              key={item.id}
              data-testid={testId + '-clue-' + (item.type ?? 'untyped')}
              className="whitespace-pre-wrap text-sm leading-7 text-[var(--nimi-text-secondary)] [overflow-wrap:anywhere]"
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
                <p className="mt-1 text-sm leading-7 text-[var(--nimi-text-secondary)]">{item.details.join(' · ')}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
