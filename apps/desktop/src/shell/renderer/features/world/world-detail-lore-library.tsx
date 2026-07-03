import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NimiText, Surface } from '@nimiplatform/kit/ui';
import {
  PAPER,
  PAPER_RADIUS,
  PAPER_SERIF,
  formatNum,
} from './world-detail-paper-model.js';
import { worldDetailPaperContentFrameStyle } from './world-detail-layout.js';
import {
  IconChevron,
  IconFile,
  IconLayers,
  IconShield,
  PaperTag,
} from './world-detail-paper-primitives.js';
import type { WorldDetailData, WorldSemanticData } from './world-detail-types.js';

export type WorldLoreKind = 'rule' | 'system' | 'taboo' | 'language';

export type WorldLoreEntry = {
  readonly id: string;
  readonly kind: WorldLoreKind;
  readonly title: string;
  readonly body: string;
  readonly details: readonly string[];
};

function normalizeLoreText(value: string | null | undefined): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function loreEntryId(kind: WorldLoreKind, value: string, index: number): string {
  const key = value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48);
  return `${kind}-${key || index + 1}`;
}

function uniqueDetails(values: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const details: string[] = [];
  for (const value of values) {
    const detail = normalizeLoreText(value);
    if (!detail || seen.has(detail)) {
      continue;
    }
    seen.add(detail);
    details.push(detail);
  }
  return details;
}

export function buildWorldLoreEntries(semantic: WorldSemanticData): WorldLoreEntry[] {
  const entries: WorldLoreEntry[] = [];
  semantic.operationRules.forEach((rule, index) => {
    const title = normalizeLoreText(rule.title) || normalizeLoreText(rule.value);
    const body = normalizeLoreText(rule.value) || title;
    if (!title || !body) {
      return;
    }
    entries.push({
      id: loreEntryId('rule', rule.key || title, index),
      kind: 'rule',
      title,
      body,
      details: [],
    });
  });

  semantic.powerSystems.forEach((system, index) => {
    const title = normalizeLoreText(system.name);
    const body = normalizeLoreText(system.description) || title;
    if (!title || !body) {
      return;
    }
    entries.push({
      id: loreEntryId('system', title, index),
      kind: 'system',
      title,
      body,
      details: uniqueDetails([
        ...system.rules,
        ...system.levels.map((level) => [
          normalizeLoreText(level.name),
          normalizeLoreText(level.description),
          normalizeLoreText(level.extra),
        ].filter(Boolean).join(' - ')),
      ]),
    });
  });

  semantic.taboos.forEach((taboo, index) => {
    const title = normalizeLoreText(taboo.name);
    const body = normalizeLoreText(taboo.description) || title;
    if (!title || !body) {
      return;
    }
    entries.push({
      id: loreEntryId('taboo', title, index),
      kind: 'taboo',
      title,
      body,
      details: uniqueDetails([taboo.severity]),
    });
  });

  semantic.languages.forEach((language, index) => {
    const title = normalizeLoreText(language.name);
    const body = normalizeLoreText(language.description)
      || normalizeLoreText(language.category)
      || title;
    if (!title || !body) {
      return;
    }
    entries.push({
      id: loreEntryId('language', title, index),
      kind: 'language',
      title,
      body,
      details: uniqueDetails([
        language.category,
        language.writingSample,
        language.spokenSample,
      ]),
    });
  });

  return entries;
}

function groupLoreEntries(entries: readonly WorldLoreEntry[]): Record<WorldLoreKind, WorldLoreEntry[]> {
  return {
    rule: entries.filter((entry) => entry.kind === 'rule'),
    system: entries.filter((entry) => entry.kind === 'system'),
    taboo: entries.filter((entry) => entry.kind === 'taboo'),
    language: entries.filter((entry) => entry.kind === 'language'),
  };
}

const LORE_KIND_ICON = {
  rule: <IconFile size={15} color={PAPER.green} strokeWidth={1.8} />,
  system: <IconLayers size={15} color={PAPER.green} strokeWidth={1.8} />,
  taboo: <IconShield size={15} color={PAPER.green} strokeWidth={1.8} />,
  language: <IconFile size={15} color={PAPER.green} strokeWidth={1.8} />,
} satisfies Record<WorldLoreKind, ReactNode>;

function WorldLoreEntryCard({ entry }: { entry: WorldLoreEntry }) {
  const { t } = useTranslation();
  return (
    <Surface
      tone="card"
      material="solid"
      elevation="base"
      padding="none"
      data-testid="world-detail-lore-entry"
      className="min-w-0 p-4"
      style={{
        background: PAPER.cardSoft,
        borderColor: PAPER.borderSoft,
        borderRadius: PAPER_RADIUS.md,
        boxShadow: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span
          aria-hidden="true"
          style={{
            display: 'inline-grid',
            placeItems: 'center',
            width: 30,
            height: 30,
            borderRadius: PAPER_RADIUS.md,
            background: PAPER.greenSoftBg,
          }}
        >
          {LORE_KIND_ICON[entry.kind]}
        </span>
        <PaperTag>{t(`WorldDetail.paper.loreLibrary.kind.${entry.kind}`)}</PaperTag>
      </div>
      <h3 style={{ margin: '0 0 7px', fontFamily: PAPER_SERIF, fontSize: 17, lineHeight: 1.3, fontWeight: 900, color: PAPER.inkStrong }}>
        {entry.title}
      </h3>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: PAPER.muted }}>
        {entry.body}
      </p>
      {entry.details.length > 0 ? (
        <div style={{ display: 'grid', gap: 7, marginTop: 13, paddingTop: 12, borderTop: `1px solid ${PAPER.borderInner}` }}>
          {entry.details.map((detail) => (
            <div key={detail} style={{ display: 'grid', gridTemplateColumns: '14px 1fr', gap: 7, alignItems: 'start', fontSize: 12.5, lineHeight: 1.55, color: PAPER.bodySoft }}>
              <span aria-hidden="true" style={{ width: 5, height: 5, marginTop: 7, borderRadius: '50%', background: PAPER.green }} />
              <span>{detail}</span>
            </div>
          ))}
        </div>
      ) : null}
    </Surface>
  );
}

function WorldLoreGroup({
  kind,
  entries,
}: {
  kind: WorldLoreKind;
  entries: readonly WorldLoreEntry[];
}) {
  const { t } = useTranslation();
  if (entries.length === 0) {
    return null;
  }
  return (
    <section data-testid={`world-detail-lore-group-${kind}`} style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: PAPER_SERIF, fontSize: 20, fontWeight: 900, color: PAPER.inkStrong }}>
            {t(`WorldDetail.paper.loreLibrary.group.${kind}.title`)}
          </h2>
          <p style={{ margin: '5px 0 0', fontSize: 12.5, lineHeight: 1.6, color: PAPER.faint }}>
            {t(`WorldDetail.paper.loreLibrary.group.${kind}.subtitle`)}
          </p>
        </div>
        <span style={{ fontSize: 12, fontWeight: 800, color: PAPER.green }}>
          {formatNum(entries.length)} {t('WorldDetail.paper.loreLibrary.records')}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 12 }}>
        {entries.map((entry) => (
          <WorldLoreEntryCard key={entry.id} entry={entry} />
        ))}
      </div>
    </section>
  );
}

export function WorldLoreLibraryPage({
  world,
  semantic,
  onBack,
}: {
  world: WorldDetailData;
  semantic: WorldSemanticData;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const entries = useMemo(() => buildWorldLoreEntries(semantic), [semantic]);
  const groups = useMemo(() => groupLoreEntries(entries), [entries]);

  return (
    <div
      data-testid="world-detail-lore-library-page"
      style={{ position: 'relative', minHeight: '100%', fontFamily: 'var(--nimi-font-sans)' }}
    >
      <div style={worldDetailPaperContentFrameStyle()}>
        <button
          type="button"
          onClick={onBack}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginBottom: 14, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, color: PAPER.green, border: `1px solid ${PAPER.borderSoft}`, borderRadius: 999, background: PAPER.card, padding: '8px 13px', cursor: 'pointer', boxShadow: PAPER.cardShadow }}
        >
          <span style={{ transform: 'rotate(180deg)', display: 'inline-flex' }}>
            <IconChevron size={13} color={PAPER.green} />
          </span>
          {t('WorldDetail.paper.gallery.backToWorld')}
        </button>

        <Surface
          as="section"
          tone="card"
          material="solid"
          elevation="base"
          padding="none"
          className="mb-4 min-w-0 p-6"
          style={{
            background: PAPER.card,
            borderColor: PAPER.border,
            borderRadius: PAPER_RADIUS.xl,
            boxShadow: PAPER.cardShadowStrong,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0, flex: '1 1 520px' }}>
              <NimiText as="div" role="caption" className="mb-2 font-semibold" style={{ color: PAPER.green }}>
                {world.name}
              </NimiText>
              <h1 style={{ margin: 0, fontFamily: PAPER_SERIF, fontSize: 34, lineHeight: 1.12, fontWeight: 950, color: PAPER.inkStrong }}>
                {t('WorldDetail.paper.loreLibrary.title')}
              </h1>
              <p style={{ margin: '12px 0 0', maxWidth: 760, fontSize: 13.5, lineHeight: 1.75, color: PAPER.muted }}>
                {t('WorldDetail.paper.loreLibrary.subtitle')}
              </p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(82px,1fr))', gap: 8, minWidth: 188 }}>
              {(['rule', 'system', 'taboo', 'language'] as const).map((kind) => (
                <div key={kind} style={{ border: `1px solid ${PAPER.borderSoft}`, borderRadius: PAPER_RADIUS.md, background: 'rgba(255,253,248,.68)', padding: '11px 12px' }}>
                  <div style={{ fontFamily: PAPER_SERIF, fontSize: 22, lineHeight: 1, fontWeight: 900, color: PAPER.inkStrong }}>{formatNum(groups[kind].length)}</div>
                  <div style={{ marginTop: 6, fontSize: 11.5, color: PAPER.faint }}>{t(`WorldDetail.paper.loreLibrary.kind.${kind}`)}</div>
                </div>
              ))}
            </div>
          </div>
        </Surface>

        {entries.length === 0 ? (
          <Surface
            tone="card"
            material="solid"
            elevation="base"
            padding="none"
            className="p-5"
            style={{
              background: PAPER.card,
              borderColor: PAPER.border,
              borderRadius: PAPER_RADIUS.lg,
              boxShadow: PAPER.cardShadow,
            }}
          >
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.65, color: PAPER.faint }}>
              {t('WorldDetail.paper.loreLibrary.empty')}
            </p>
          </Surface>
        ) : (
          <div style={{ display: 'grid', gap: 22 }}>
            <WorldLoreGroup kind="rule" entries={groups.rule} />
            <WorldLoreGroup kind="system" entries={groups.system} />
            <WorldLoreGroup kind="taboo" entries={groups.taboo} />
            <WorldLoreGroup kind="language" entries={groups.language} />
          </div>
        )}
      </div>
    </div>
  );
}
