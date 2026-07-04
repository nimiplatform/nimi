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
import type {
  WorldAssetExternalRef,
  WorldAssetIntent,
  WorldAssetResourceRef,
  WorldDetailData,
  WorldPublicAssetsData,
} from './world-detail-types.js';

export type WorldResourceReferenceKind = 'material' | 'intent';
export type WorldResourceReferenceStatus = 'ready' | 'external' | 'registered' | 'planned';
export type WorldResourceReferenceRole = 'icon' | 'banner' | 'hero' | 'highlight' | 'map' | 'other';

export type WorldResourceReferenceEntry = {
  readonly id: string;
  readonly kind: WorldResourceReferenceKind;
  readonly status: WorldResourceReferenceStatus;
  readonly role: WorldResourceReferenceRole;
  readonly roleIndex?: number;
  readonly title: string;
  readonly subtitle: string;
  readonly body: string;
  readonly purpose: string;
  readonly systemKind: string;
  readonly resourceRefId?: string | null;
  readonly externalRefId?: string | null;
  readonly externalUri?: string | null;
  readonly rawName?: string | null;
};

function normalizeReferenceText(value: string | null | undefined): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function joinParts(values: readonly (string | null | undefined)[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const value of values) {
    const text = normalizeReferenceText(value);
    const key = text.toLocaleLowerCase();
    if (!text || seen.has(key)) {
      continue;
    }
    seen.add(key);
    parts.push(text);
  }
  return parts.join(' / ');
}

function aliasKey(value: string | null | undefined): string {
  return normalizeReferenceText(value).toLocaleLowerCase();
}

function referenceAliases(ref: Pick<WorldAssetResourceRef, 'refId' | 'label'>): string[] {
  return [aliasKey(ref.refId), aliasKey(ref.label)].filter(Boolean);
}

function looksLikeTechnicalIdentifier(value: string): boolean {
  const text = normalizeReferenceText(value);
  if (!text) {
    return false;
  }
  if (/^https?:\/\//i.test(text) || /^file:\/\//i.test(text)) {
    return true;
  }
  if (/^(forge|world|asset|resource|res|intent)[-_]/i.test(text)) {
    return true;
  }
  const separatorCount = (text.match(/[-_:]/g) ?? []).length;
  if (separatorCount >= 2 && /^[a-z0-9._:-]+$/i.test(text)) {
    return true;
  }
  return text.length > 36 && !/[\u4e00-\u9fff]/.test(text);
}

function inferReferenceRole(values: readonly (string | null | undefined)[]): {
  readonly role: WorldResourceReferenceRole;
  readonly roleIndex?: number;
} {
  const source = values.map(normalizeReferenceText).join(' ').toLocaleLowerCase();
  const highlightMatch = source.match(/highlight[-_\s]*(\d+)?/);
  if (highlightMatch) {
    const parsed = Number.parseInt(highlightMatch[1] ?? '', 10);
    return Number.isFinite(parsed) ? { role: 'highlight', roleIndex: parsed } : { role: 'highlight' };
  }
  if (/\bicon\b|world-icon/.test(source)) {
    return { role: 'icon' };
  }
  if (/\bbanner\b|world-banner/.test(source)) {
    return { role: 'banner' };
  }
  if (/\bhero\b|world-hero/.test(source)) {
    return { role: 'hero' };
  }
  if (/\bmap\b|地图/.test(source)) {
    return { role: 'map' };
  }
  return { role: 'other' };
}

type MaterialDraft = {
  readonly id: string;
  resource?: WorldAssetResourceRef;
  external?: WorldAssetExternalRef;
};

function resolveMaterialTitle(resource?: WorldAssetResourceRef, external?: WorldAssetExternalRef): string {
  const labels = [resource?.label, external?.label].map(normalizeReferenceText).filter(Boolean);
  return labels.find((label) => !looksLikeTechnicalIdentifier(label)) ?? '';
}

function buildMaterialEntry(draft: MaterialDraft): WorldResourceReferenceEntry {
  const resource = draft.resource;
  const external = draft.external;
  const { role, roleIndex } = inferReferenceRole([
    resource?.label,
    resource?.refId,
    resource?.kind,
    resource?.purpose,
    external?.label,
    external?.refId,
    external?.kind,
    external?.purpose,
  ]);
  const title = resolveMaterialTitle(resource, external);
  const subtitle = joinParts([resource?.purpose, external?.purpose, resource?.kind, external?.kind]);
  const rawName = joinParts([resource?.label, external?.label]);
  const status: WorldResourceReferenceStatus = external?.uri
    ? resource
      ? 'ready'
      : 'external'
    : 'registered';
  return {
    id: draft.id,
    kind: 'material',
    status,
    role,
    roleIndex,
    title,
    subtitle,
    body: external?.uri ?? resource?.refId ?? '',
    purpose: subtitle,
    systemKind: joinParts([resource?.kind, external?.kind]),
    resourceRefId: resource?.refId ?? null,
    externalRefId: external?.refId ?? null,
    externalUri: external?.uri ?? null,
    rawName: rawName || null,
  };
}

function buildIntentEntry(intent: WorldAssetIntent): WorldResourceReferenceEntry {
  const { role, roleIndex } = inferReferenceRole([intent.intentId, intent.kind, intent.summary]);
  const summary = normalizeReferenceText(intent.summary);
  const title = looksLikeTechnicalIdentifier(intent.intentId) ? '' : intent.intentId;
  return {
    id: `intent-${intent.intentId}`,
    kind: 'intent',
    status: 'planned',
    role,
    roleIndex,
    title,
    subtitle: normalizeReferenceText(intent.kind),
    body: summary || intent.kind,
    purpose: normalizeReferenceText(intent.kind),
    systemKind: normalizeReferenceText(intent.kind),
    resourceRefId: null,
    externalRefId: null,
    externalUri: null,
    rawName: intent.intentId,
  };
}

export function buildWorldResourceReferenceEntries(publicAssets: WorldPublicAssetsData): WorldResourceReferenceEntry[] {
  const materialDrafts = new Map<string, MaterialDraft>();
  const aliases = new Map<string, string>();

  const rememberAliases = (id: string, ref: Pick<WorldAssetResourceRef, 'refId' | 'label'>) => {
    for (const alias of referenceAliases(ref)) {
      if (!aliases.has(alias)) {
        aliases.set(alias, id);
      }
    }
  };

  for (const resource of publicAssets.resourceRefs) {
    const id = `material-${resource.refId}`;
    materialDrafts.set(id, { id, resource });
    rememberAliases(id, resource);
  }

  for (const external of publicAssets.externalRefs) {
    const matchedId = referenceAliases(external)
      .map((alias) => aliases.get(alias))
      .find((id): id is string => Boolean(id));
    const id = matchedId ?? `material-${external.refId}`;
    const existing = materialDrafts.get(id);
    materialDrafts.set(id, { id, resource: existing?.resource, external });
    rememberAliases(id, external);
  }

  const materials = [...materialDrafts.values()].map(buildMaterialEntry);
  const intents = publicAssets.intents.map(buildIntentEntry);

  return [...materials, ...intents];
}

function groupResourceReferences(
  entries: readonly WorldResourceReferenceEntry[],
): Record<WorldResourceReferenceKind, WorldResourceReferenceEntry[]> {
  return {
    material: entries.filter((entry) => entry.kind === 'material'),
    intent: entries.filter((entry) => entry.kind === 'intent'),
  };
}

const RESOURCE_REFERENCE_ICON = {
  ready: <IconLayers size={15} color={PAPER.green} strokeWidth={1.8} />,
  external: <IconFile size={15} color={PAPER.green} strokeWidth={1.8} />,
  registered: <IconLayers size={15} color={PAPER.green} strokeWidth={1.8} />,
  planned: <IconShield size={15} color={PAPER.green} strokeWidth={1.8} />,
} satisfies Record<WorldResourceReferenceStatus, ReactNode>;

function referenceRoleTitle(entry: WorldResourceReferenceEntry, t: ReturnType<typeof useTranslation>['t']): string {
  if (entry.title) {
    return entry.title;
  }
  return t(`WorldDetail.paper.resourceReferences.role.${entry.role}`, {
    index: entry.roleIndex,
    defaultValue: entry.role === 'highlight' && entry.roleIndex
      ? `Highlight ${entry.roleIndex}`
      : 'Asset',
  });
}

function ReferenceMetaRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) {
    return null;
  }
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '86px minmax(0,1fr)',
        gap: 10,
        alignItems: 'baseline',
        fontSize: 12.5,
        lineHeight: 1.55,
      }}
    >
      <span style={{ color: PAPER.faint }}>{label}</span>
      <span style={{ minWidth: 0, color: PAPER.ink, overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  );
}

function WorldResourceReferenceCard({ entry }: { entry: WorldResourceReferenceEntry }) {
  const { t } = useTranslation();
  const title = referenceRoleTitle(entry, t);
  const statusCopy = t(`WorldDetail.paper.resourceReferences.status.${entry.status}`);
  const description = t(`WorldDetail.paper.resourceReferences.description.${entry.status}`);
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
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
          {RESOURCE_REFERENCE_ICON[entry.status]}
        </span>
        <PaperTag>{statusCopy}</PaperTag>
      </div>
      <h3 style={{ margin: '0 0 8px', fontFamily: PAPER_SERIF, fontSize: 18, lineHeight: 1.28, fontWeight: 900, color: PAPER.inkStrong }}>
        {title}
      </h3>
      <p style={{ margin: '0 0 14px', fontSize: 13, lineHeight: 1.65, color: PAPER.muted }}>
        {entry.kind === 'intent' && entry.body ? entry.body : description}
      </p>
      <div style={{ display: 'grid', gap: 7, paddingTop: 12, borderTop: `1px solid ${PAPER.borderInner}` }}>
        <ReferenceMetaRow
          label={t('WorldDetail.paper.resourceReferences.field.usage')}
          value={t(`WorldDetail.paper.resourceReferences.role.${entry.role}`, {
            index: entry.roleIndex,
            defaultValue: entry.purpose,
          })}
        />
        <ReferenceMetaRow
          label={t('WorldDetail.paper.resourceReferences.field.resourceId')}
          value={entry.resourceRefId}
        />
        <ReferenceMetaRow
          label={t('WorldDetail.paper.resourceReferences.field.sourceLink')}
          value={entry.externalUri}
        />
        <ReferenceMetaRow
          label={t('WorldDetail.paper.resourceReferences.field.sourceId')}
          value={entry.externalRefId && entry.externalRefId !== entry.resourceRefId ? entry.externalRefId : null}
        />
        <ReferenceMetaRow
          label={t('WorldDetail.paper.resourceReferences.field.planType')}
          value={entry.kind === 'intent' ? entry.systemKind : null}
        />
        {entry.rawName && entry.rawName !== title ? (
          <ReferenceMetaRow
            label={t('WorldDetail.paper.resourceReferences.field.rawName')}
            value={entry.rawName}
          />
        ) : null}
      </div>
      {entry.externalUri ? (
        <a
          href={entry.externalUri}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 12,
            fontSize: 12.5,
            fontWeight: 800,
            color: PAPER.green,
            textDecoration: 'none',
            overflowWrap: 'anywhere',
          }}
        >
          {t('WorldDetail.paper.resourceReferences.action.openAsset')}
          <IconChevron size={12} color={PAPER.green} />
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
  const summary = useMemo(() => ({
    usable: entries.filter((entry) => Boolean(entry.externalUri)).length,
    registered: entries.filter((entry) => Boolean(entry.resourceRefId)).length,
    planned: groups.intent.length,
  }), [entries, groups.intent.length]);

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
              <p style={{ margin: '8px 0 0', maxWidth: 760, fontSize: 12.5, lineHeight: 1.65, color: PAPER.faint }}>
                {t('WorldDetail.paper.resourceReferences.readerHint')}
              </p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(104px,1fr))', gap: 8, width: 'min(100%, 380px)', minWidth: 0 }}>
              {(['usable', 'registered', 'planned'] as const).map((key) => (
                <div key={key} style={{ border: `1px solid ${PAPER.borderSoft}`, borderRadius: PAPER_RADIUS.md, background: 'rgba(255,253,248,.68)', padding: '11px 12px' }}>
                  <div style={{ fontFamily: PAPER_SERIF, fontSize: 22, lineHeight: 1, fontWeight: 900, color: PAPER.inkStrong }}>{formatNum(summary[key])}</div>
                  <div style={{ marginTop: 6, fontSize: 11.5, color: PAPER.faint }}>{t(`WorldDetail.paper.resourceReferences.summary.${key}`)}</div>
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
            <WorldResourceReferenceGroup kind="material" entries={groups.material} />
            <WorldResourceReferenceGroup kind="intent" entries={groups.intent} />
            <p style={{ margin: '-4px 0 0', fontSize: 12, lineHeight: 1.65, color: PAPER.faint }}>
              {t('WorldDetail.paper.resourceReferences.ownershipNote')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
