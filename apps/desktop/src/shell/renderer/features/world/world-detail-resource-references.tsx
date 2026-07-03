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
import type { WorldDetailData, WorldPublicAssetsData } from './world-detail-types.js';

export type WorldResourceReferenceKind = 'resource' | 'external' | 'intent';

export type WorldResourceReferenceEntry = {
  readonly id: string;
  readonly kind: WorldResourceReferenceKind;
  readonly title: string;
  readonly subtitle: string;
  readonly body: string;
  readonly uri?: string | null;
};

function normalizeReferenceText(value: string | null | undefined): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function joinParts(values: readonly (string | null | undefined)[]): string {
  return values.map(normalizeReferenceText).filter(Boolean).join(' / ');
}

export function buildWorldResourceReferenceEntries(publicAssets: WorldPublicAssetsData): WorldResourceReferenceEntry[] {
  const resources = publicAssets.resourceRefs.map((resource) => {
    const title = normalizeReferenceText(resource.label) || resource.refId;
    const subtitle = joinParts([resource.kind, resource.purpose]);
    return {
      id: `resource-${resource.refId}`,
      kind: 'resource',
      title,
      subtitle,
      body: resource.refId,
      uri: null,
    } satisfies WorldResourceReferenceEntry;
  });

  const externalRefs = publicAssets.externalRefs.map((ref) => {
    const title = normalizeReferenceText(ref.label) || ref.refId;
    const subtitle = joinParts([ref.kind, ref.purpose]);
    return {
      id: `external-${ref.refId}`,
      kind: 'external',
      title,
      subtitle,
      body: ref.uri,
      uri: ref.uri,
    } satisfies WorldResourceReferenceEntry;
  });

  const intents = publicAssets.intents.map((intent) => ({
    id: `intent-${intent.intentId}`,
    kind: 'intent',
    title: intent.intentId,
    subtitle: normalizeReferenceText(intent.kind),
    body: normalizeReferenceText(intent.summary) || intent.kind,
    uri: null,
  } satisfies WorldResourceReferenceEntry));

  return [...resources, ...externalRefs, ...intents];
}

function groupResourceReferences(
  entries: readonly WorldResourceReferenceEntry[],
): Record<WorldResourceReferenceKind, WorldResourceReferenceEntry[]> {
  return {
    resource: entries.filter((entry) => entry.kind === 'resource'),
    external: entries.filter((entry) => entry.kind === 'external'),
    intent: entries.filter((entry) => entry.kind === 'intent'),
  };
}

const RESOURCE_REFERENCE_ICON = {
  resource: <IconLayers size={15} color={PAPER.green} strokeWidth={1.8} />,
  external: <IconFile size={15} color={PAPER.green} strokeWidth={1.8} />,
  intent: <IconShield size={15} color={PAPER.green} strokeWidth={1.8} />,
} satisfies Record<WorldResourceReferenceKind, ReactNode>;

function WorldResourceReferenceCard({ entry }: { entry: WorldResourceReferenceEntry }) {
  const { t } = useTranslation();
  return (
    <Surface
      tone="card"
      material="solid"
      elevation="base"
      padding="none"
      data-testid="world-detail-resource-reference-entry"
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
          {RESOURCE_REFERENCE_ICON[entry.kind]}
        </span>
        <PaperTag>{t(`WorldDetail.paper.resourceReferences.kind.${entry.kind}`)}</PaperTag>
      </div>
      <h3 style={{ margin: '0 0 7px', fontFamily: PAPER_SERIF, fontSize: 17, lineHeight: 1.3, fontWeight: 900, color: PAPER.inkStrong }}>
        {entry.title}
      </h3>
      {entry.subtitle ? (
        <p style={{ margin: '0 0 9px', fontSize: 12.5, lineHeight: 1.55, color: PAPER.faint }}>
          {entry.subtitle}
        </p>
      ) : null}
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: PAPER.muted, overflowWrap: 'anywhere' }}>
        {entry.body}
      </p>
      {entry.uri ? (
        <a
          href={entry.uri}
          style={{
            display: 'inline-flex',
            marginTop: 12,
            fontSize: 12.5,
            fontWeight: 800,
            color: PAPER.green,
            textDecoration: 'none',
            overflowWrap: 'anywhere',
          }}
        >
          {entry.uri}
        </a>
      ) : null}
    </Surface>
  );
}

function WorldResourceReferenceGroup({
  kind,
  entries,
}: {
  kind: WorldResourceReferenceKind;
  entries: readonly WorldResourceReferenceEntry[];
}) {
  const { t } = useTranslation();
  if (entries.length === 0) {
    return null;
  }
  return (
    <section data-testid={`world-detail-resource-reference-group-${kind}`} style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: PAPER_SERIF, fontSize: 20, fontWeight: 900, color: PAPER.inkStrong }}>
            {t(`WorldDetail.paper.resourceReferences.group.${kind}.title`)}
          </h2>
          <p style={{ margin: '5px 0 0', fontSize: 12.5, lineHeight: 1.6, color: PAPER.faint }}>
            {t(`WorldDetail.paper.resourceReferences.group.${kind}.subtitle`)}
          </p>
        </div>
        <span style={{ fontSize: 12, fontWeight: 800, color: PAPER.green }}>
          {formatNum(entries.length)} {t('WorldDetail.paper.resourceReferences.records')}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 12 }}>
        {entries.map((entry) => (
          <WorldResourceReferenceCard key={entry.id} entry={entry} />
        ))}
      </div>
    </section>
  );
}

export function WorldResourceReferencesPage({
  world,
  publicAssets,
  onBack,
}: {
  world: WorldDetailData;
  publicAssets: WorldPublicAssetsData;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const entries = useMemo(() => buildWorldResourceReferenceEntries(publicAssets), [publicAssets]);
  const groups = useMemo(() => groupResourceReferences(entries), [entries]);

  return (
    <div
      data-testid="world-detail-resource-references-page"
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
                {t('WorldDetail.paper.resourceReferences.title')}
              </h1>
              <p style={{ margin: '12px 0 0', maxWidth: 760, fontSize: 13.5, lineHeight: 1.75, color: PAPER.muted }}>
                {t('WorldDetail.paper.resourceReferences.subtitle')}
              </p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(82px,1fr))', gap: 8, minWidth: 272 }}>
              {(['resource', 'external', 'intent'] as const).map((kind) => (
                <div key={kind} style={{ border: `1px solid ${PAPER.borderSoft}`, borderRadius: PAPER_RADIUS.md, background: 'rgba(255,253,248,.68)', padding: '11px 12px' }}>
                  <div style={{ fontFamily: PAPER_SERIF, fontSize: 22, lineHeight: 1, fontWeight: 900, color: PAPER.inkStrong }}>{formatNum(groups[kind].length)}</div>
                  <div style={{ marginTop: 6, fontSize: 11.5, color: PAPER.faint }}>{t(`WorldDetail.paper.resourceReferences.kind.${kind}`)}</div>
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
              {t('WorldDetail.paper.resourceReferences.empty')}
            </p>
          </Surface>
        ) : (
          <div style={{ display: 'grid', gap: 22 }}>
            <WorldResourceReferenceGroup kind="resource" entries={groups.resource} />
            <WorldResourceReferenceGroup kind="external" entries={groups.external} />
            <WorldResourceReferenceGroup kind="intent" entries={groups.intent} />
          </div>
        )}
      </div>
    </div>
  );
}
