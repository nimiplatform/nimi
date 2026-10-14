import { useTranslation } from 'react-i18next';
import { UsersRound } from 'lucide-react';
import type { SourceDetailData } from './source-detail-model.js';
import { uniqueStrings } from './source-detail-world-character-labels.js';
import { relationKindLabel } from './source-detail-world-character-theme.js';

type RelationshipClueItem = {
  id: string;
  type: string | null;
  title: string;
  summary: string | null;
  details: string[];
};

function explicitRelationshipType(value: string | null | undefined): string | null {
  const type = value?.trim();
  return type || null;
}

// Builds text entries from explicit relationship fields only. The title is
// the explicit target label, then the explicit relation label, then the
// localized explicit type, then the summary. Names are never extracted from
// prose, and a value that equals a known source or entity id is treated as an
// identifier, not display text.
function buildRelationshipClueItems(
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
  const seen = new Set<string>();
  const items: RelationshipClueItem[] = [];
  const add = (item: RelationshipClueItem) => {
    const key = [item.type ?? '', item.title, item.summary ?? ''].join('\u0000');
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    items.push(item);
  };

  for (const clue of source.relationshipClues) {
    const ids = [clue.id, clue.targetEntityId];
    const label = clue.label === clue.type && clue.type
      ? relationKindLabel(clue.type, t)
      : displayText(clue.label, ids);
    const summary = displayText(clue.summary, ids);
    const title = displayText(clue.targetLabel, ids)
      ?? label
      ?? (clue.type ? relationKindLabel(clue.type, t) : null)
      ?? summary;
    if (!title) {
      continue;
    }
    add({
      id: clue.id,
      type: clue.type,
      title,
      summary: summary && summary !== title ? summary : null,
      details: uniqueStrings([label, ...clue.details]).filter((detail) => detail !== title && detail !== summary),
    });
  }

  for (const note of source.characterProfile.relationshipNotes) {
    const type = explicitRelationshipType(note.type);
    const ids = [note.id, note.targetRef];
    const summary = displayText(note.summary, ids);
    const targetLabel = note.targetRef && Object.hasOwn(source.relationshipTargetLabels, note.targetRef)
      ? source.relationshipTargetLabels[note.targetRef]
      : null;
    const title = displayText(targetLabel, ids)
      ?? (type ? relationKindLabel(type, t) : null)
      ?? summary;
    if (!title) {
      continue;
    }
    add({
      id: note.id,
      type,
      title,
      summary: summary && summary !== title ? summary : null,
      details: [],
    });
  }

  return items;
}

export function WorldCharacterRelationshipCluesSection({ source }: { source: SourceDetailData }) {
  const { t } = useTranslation();
  const items = buildRelationshipClueItems(source, t);
  if (items.length === 0) return null;

  return (
    <section
      data-testid="world-character-relationship-clues-section"
      className="rounded-[18px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-5 shadow-[var(--nimi-elevation-base)]"
    >
      <div className="flex items-center gap-2">
        <UsersRound aria-hidden className="h-5 w-5 text-[var(--nimi-action-primary-bg)]" />
        <h2 className="text-xl font-semibold text-[var(--nimi-text-primary)]">
          {t('SourceDetail.worldCharacter.relationshipTitle', { defaultValue: 'Relationship clues' })}
        </h2>
      </div>
      <ul data-testid="world-character-relationship-list" className="mt-3 space-y-2">
        {items.map((item) => {
          const kind = item.type ? relationKindLabel(item.type, t) : null;
          return (
            <li
              key={item.id}
              data-testid={'world-character-relationship-clue-' + (item.type ?? 'untyped')}
              className="text-sm leading-6 text-[var(--nimi-text-secondary)] [overflow-wrap:anywhere]"
            >
              <p>
                <span className="font-medium text-[var(--nimi-text-primary)]">
                  {item.title}{kind && kind !== item.title ? ' · ' + kind : ''}
                </span>
                {item.summary ? <>：{item.summary}</> : null}
              </p>
              {item.details.length > 0 ? (
                <p className="text-xs leading-5 text-[var(--nimi-text-muted)]">{item.details.join(' · ')}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
