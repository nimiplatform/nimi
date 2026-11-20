import type {
  HabitatDaypart,
  HabitatPlaceArchetype,
  HabitatThemeTag,
  NimiUtopiaResident,
  NimiUtopiaSharedActivity,
  NimiUtopiaSnapshot,
} from '@nimiplatform/sdk/app';
import { HandDrawnChibiMedallion } from '../components/HandDrawnChibi.js';
import {
  ArchetypeIcon,
  ChatBubbleIcon,
  CompassRoseIcon,
  LinkDuoIcon,
  LockClosedIcon,
  SceneryGlyph,
} from '../components/UtopiaIcons.js';
import { resolveResidentPresence } from '../domain/agent-profiles.js';
import { resolveChibiAppearance, type ChibiWardrobeMap } from '../domain/chibi-wardrobe.js';
import { WeatherParticleCanvas } from './WeatherParticleCanvas.js';

export type PlaceSharedPair = Readonly<{
  readonly activity: NimiUtopiaSharedActivity;
  readonly initiator: NimiUtopiaResident;
  readonly recipient: NimiUtopiaResident;
}>;

export type PlaceOccupancyBreakdown = Readonly<{
  readonly sharedPairs: readonly PlaceSharedPair[];
  readonly independentResidents: readonly NimiUtopiaResident[];
  readonly privateResidents: readonly NimiUtopiaResident[];
}>;

// @nimi-authority: rule.nimi.platform.app-ecosystem.utopia-operations
export function buildPlaceOccupancyBreakdown(
  placeId: string,
  snapshot: NimiUtopiaSnapshot,
): PlaceOccupancyBreakdown {
  const residentByHandle = new Map<string, NimiUtopiaResident>(
    snapshot.residents.map((r) => [r.agentHandle, r]),
  );
  const occEntry = snapshot.occupancy.find((o) => o.placeId === placeId);
  const handlesAtPlace = new Set<string>(occEntry?.agentHandles ?? []);

  for (const r of snapshot.residents) {
    if (placeId === 'personal-quarter' && !r.current?.interaction && r.current?.placeId === placeId) {
      handlesAtPlace.add(r.agentHandle);
    }
  }

  const pairedHandles = new Set<string>();
  const sharedPairs: PlaceSharedPair[] = [];

  if (placeId !== 'personal-quarter') {
    for (const shared of snapshot.sharedActivities) {
      if (shared.state !== 'active' || shared.placeId !== placeId) continue;
      const initiator = residentByHandle.get(shared.initiatorHandle);
      const recipient = residentByHandle.get(shared.recipientHandle);
      if (initiator && recipient) {
        pairedHandles.add(initiator.agentHandle);
        pairedHandles.add(recipient.agentHandle);
        sharedPairs.push({ activity: shared, initiator, recipient });
      }
    }
  }

  const independentResidents: NimiUtopiaResident[] = [];
  for (const handle of handlesAtPlace) {
    if (pairedHandles.has(handle)) continue;
    const res = residentByHandle.get(handle);
    if (res && !res.current?.interaction) {
      independentResidents.push(res);
    }
  }

  // Account-visible private location is an individual display fact. It never
  // adds to Runtime's public occupancy or creates a co-presence relationship.
  const privateResidents = placeId === 'personal-quarter' ? [] : snapshot.residents.filter((resident) =>
    !resident.current?.interaction && resident.current?.placeId === placeId
    && !handlesAtPlace.has(resident.agentHandle) && !pairedHandles.has(resident.agentHandle));
  return Object.freeze({ sharedPairs, independentResidents, privateResidents });
}

export function buildPlaceAriaLabel(input: {
  readonly placeName: string;
  readonly isPrivateQuarter: boolean;
  readonly indoor: boolean;
  readonly isOpen: boolean;
  readonly breakdown: PlaceOccupancyBreakdown;
}): string {
  const kindText = input.isPrivateQuarter ? '各自独立私舍' : (input.indoor ? '室内场所' : '露天场所');
  const openText = input.isOpen ? '当前开放' : '当前暂停开放';
  const parts: string[] = [];
  for (const pair of input.breakdown.sharedPairs) {
    parts.push(`${pair.initiator.displayName}与${pair.recipient.displayName}正结伴${pair.activity.activityLabel}`);
  }
  for (const r of input.breakdown.independentResidents) {
    const raw = r.current?.title;
    const act = (!raw || raw === 'Activity') ? '日常小憩' : raw;
    parts.push(`${r.displayName}（${r.solitary ? '独处中·' : ''}${act}）`);
  }
  for (const r of input.breakdown.privateResidents) {
    const raw = r.current?.title;
    const act = (!raw || raw === 'Activity') ? '日常小憩' : raw;
    parts.push(`${r.displayName}（个人活动·${act}）`);
  }
  const occText = parts.length > 0 ? `驻留伙伴：${parts.join('，')}` : '当前无人驻留';
  return `${input.placeName}，${kindText}，${openText}，${occText}`;
}

export function PlaceResidentBadges(props: {
  readonly placeId: string;
  readonly breakdown: PlaceOccupancyBreakdown;
  readonly maxVisibleAvatars: number;
  readonly selectedHandle: string | null;
  readonly chibiWardrobe?: ChibiWardrobeMap;
  readonly bindingsByHandle?: Readonly<Record<string, string>>;
  readonly onSelectResident: (resident: NimiUtopiaResident) => void;
}) {
  const {
    breakdown,
    placeId,
    maxVisibleAvatars,
    selectedHandle,
    chibiWardrobe,
    bindingsByHandle,
    onSelectResident,
  } = props;
  const isPrivateQuarter = placeId === 'personal-quarter';
  const coPresentMultiple =
    !isPrivateQuarter && (breakdown.sharedPairs.length + breakdown.independentResidents.length >= 2);

  const publicHandles = new Set(breakdown.independentResidents.map((r) => r.agentHandle));
  const allIndividualResidents = [...breakdown.independentResidents, ...breakdown.privateResidents];
  const visibleIndependent = allIndividualResidents.slice(0, maxVisibleAvatars);
  const overflowCount = Math.max(0, allIndividualResidents.length - visibleIndependent.length);

  if (breakdown.sharedPairs.length === 0 && visibleIndependent.length === 0) {
    return null;
  }

  return (
    <div className="utopia-badge-cluster" role="group" aria-label="驻留伙伴">
      {breakdown.sharedPairs.map((pair) => (
        <div
          key={pair.activity.activityRef}
          className="utopia-shared-capsule"
          title={`${pair.initiator.displayName} 与 ${pair.recipient.displayName} 正相伴「${pair.activity.activityLabel}」`}
        >
          <span className="utopia-shared-link" aria-hidden="true">
            <LinkDuoIcon size={12} />
          </span>
          <button
            type="button"
            className={`utopia-mini-resident-btn ${selectedHandle === pair.initiator.agentHandle ? 'is-selected' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onSelectResident(pair.initiator);
            }}
          >
            <HandDrawnChibiMedallion
              appearance={resolveChibiAppearance(pair.initiator.agentHandle, chibiWardrobe, bindingsByHandle)}
              size="xs"
            />
            <span>{pair.initiator.displayName}</span>
          </button>
          <span className="utopia-shared-sep" aria-hidden="true">&amp;</span>
          <button
            type="button"
            className={`utopia-mini-resident-btn ${selectedHandle === pair.recipient.agentHandle ? 'is-selected' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onSelectResident(pair.recipient);
            }}
          >
            <HandDrawnChibiMedallion
              appearance={resolveChibiAppearance(pair.recipient.agentHandle, chibiWardrobe, bindingsByHandle)}
              size="xs"
            />
            <span>{pair.recipient.displayName}</span>
          </button>
          <span className="utopia-shared-act-tag">{pair.activity.activityLabel}</span>
        </div>
      ))}

      {visibleIndependent.map((resident) => {
        const rawTitle = resident.current?.title;
        const actTitle = (!rawTitle || rawTitle === 'Activity') ? '日常小憩' : rawTitle;
        const publiclyCoPresent = coPresentMultiple && publicHandles.has(resident.agentHandle);
        const coPresentHint = publiclyCoPresent ? '偶遇同坐' : null;
        return (
          <button
            key={resident.agentHandle}
            type="button"
            className={`utopia-resident-pill ${isPrivateQuarter ? 'is-quarter' : ''} ${selectedHandle === resident.agentHandle ? 'is-selected' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onSelectResident(resident);
            }}
            title={
              publiclyCoPresent
                ? `${resident.displayName}：${actTitle}（恰巧也在这里，各自忙着喜欢的事）`
                : `${resident.displayName}：${actTitle}`
            }
          >
            <HandDrawnChibiMedallion
              appearance={resolveChibiAppearance(resident.agentHandle, chibiWardrobe, bindingsByHandle)}
              size="xs"
              presenceTone={resident.solitary ? 'solitary' : 'active'}
            />
            <span className="utopia-resident-name">{resident.displayName}</span>
            <span className="utopia-resident-sub">{actTitle}</span>
            {resident.solitary && <span className="utopia-solitary-chip">独处中</span>}
            {!resident.solitary && coPresentHint && <span className="utopia-copresent-chip">{coPresentHint}</span>}
          </button>
        );
      })}

      {overflowCount > 0 && (
        <span className="utopia-overflow-chip" aria-label={`另有 ${overflowCount} 位伙伴在此`}>
          +{overflowCount}
        </span>
      )}
    </div>
  );
}

const PRESENCE_SORT_WEIGHT: Readonly<Record<string, number>> = {
  conversing: 0,
  shared: 1,
  active: 2,
  solitary: 3,
  resting: 4,
};

export function SanctuaryPresenceDock(props: {
  readonly snapshot: NimiUtopiaSnapshot;
  readonly selectedResidentHandle: string | null;
  readonly chibiWardrobe?: ChibiWardrobeMap;
  readonly bindingsByHandle?: Readonly<Record<string, string>>;
  readonly onSelectResident: (resident: NimiUtopiaResident) => void;
  readonly onFocusPlace?: (placeId: string) => void;
  readonly onOpenHomePartners?: () => void;
}) {
  const {
    snapshot,
    selectedResidentHandle,
    chibiWardrobe,
    bindingsByHandle,
    onSelectResident,
    onFocusPlace,
    onOpenHomePartners,
  } = props;
  if (snapshot.residents.length === 0) {
    return (
      <div className="utopia-presence-dock is-empty" role="region" aria-label="洞天入住指引">
        <span className="utopia-dock-label">
          <span>伙伴行迹</span>
        </span>
        <span className="utopia-dock-empty-hint" style={{ fontSize: 12, opacity: 0.86 }}>
          尚无自治伙伴入住 · 前往 Nimi Home「我的伙伴」开启「自主生活」后，他们会自动来到这座洞天起居
        </span>
        {onOpenHomePartners && (
          <button
            type="button"
            className="utopia-place-unlock-btn"
            onClick={onOpenHomePartners}
          >
            前往 Home「我的伙伴」
          </button>
        )}
      </div>
    );
  }

  const rankedResidents = snapshot.residents
    .map((resident, index) => ({
      resident,
      presence: resolveResidentPresence(resident, snapshot),
      index,
    }))
    .sort((a, b) => {
      const wa = PRESENCE_SORT_WEIGHT[a.presence.tone] ?? 9;
      const wb = PRESENCE_SORT_WEIGHT[b.presence.tone] ?? 9;
      return (wa - wb) || (a.index - b.index);
    });

  return (
    <div className="utopia-presence-dock" role="region" aria-label="洞天伙伴行迹席">
      <span className="utopia-dock-label">
        <span>伙伴行迹</span>
        {snapshot.residents.length > 1 && (
          <small className="utopia-dock-count">{snapshot.residents.length}</small>
        )}
      </span>
      <div className="utopia-dock-list">
        {rankedResidents.map(({ resident, presence }) => {
          const isSelected = selectedResidentHandle === resident.agentHandle;
          return (
            <button
              key={resident.agentHandle}
              type="button"
              className={`utopia-dock-resident-chip ${isSelected ? 'is-selected' : ''} tone-${presence.tone}`}
              title={`${resident.displayName} · ${presence.shortLocationOrState}`}
              onClick={() => {
                if (presence.focusPlaceId && onFocusPlace) {
                  onFocusPlace(presence.focusPlaceId);
                }
                onSelectResident(resident);
              }}
            >
              <HandDrawnChibiMedallion
                appearance={resolveChibiAppearance(resident.agentHandle, chibiWardrobe, bindingsByHandle)}
                size="sm"
                presenceTone={presence.tone}
              />
              <span className="utopia-dock-resident-copy">
                <strong className="utopia-dock-resident-name">{resident.displayName}</strong>
                <small className="utopia-dock-resident-state">{presence.shortLocationOrState}</small>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const ARCHETYPE_LABELS: Readonly<Record<HabitatPlaceArchetype, string>> = {
  lookout: '观景台',
  workshop: '手作坊',
  garden: '园圃',
  waterside: '水畔',
  hearth: '暖炉室',
  library: '书阁',
  courtyard: '庭院',
  shelter: '静舍',
};

const JOURNAL_THEME_PALETTES: Readonly<Record<HabitatThemeTag, { bg: string; cardBg: string; accent: string; text: string }>> = {
  seaside: { bg: '#EBF3F5', cardBg: '#FCFBF7', accent: '#1F6E8C', text: '#1D3540' },
  polar: { bg: '#15253B', cardBg: '#1E3350', accent: '#E09F3E', text: '#EEF5FC' },
  xianxia: { bg: '#F2F0E6', cardBg: '#FAF8F1', accent: '#3A6B5C', text: '#243832' },
  farming: { bg: '#F4F1E3', cardBg: '#FCFBF5', accent: '#6B8E4E', text: '#2C3824' },
  woodland: { bg: '#EBF2EC', cardBg: '#F8FBF8', accent: '#3E7052', text: '#21362A' },
  mountain: { bg: '#EDF1F4', cardBg: '#FAFBFD', accent: '#486884', text: '#223242' },
  harbor: { bg: '#EAEFF4', cardBg: '#FBF9F5', accent: '#2D6282', text: '#1F3040' },
  observatory: { bg: '#1A2238', cardBg: '#25304D', accent: '#C89B54', text: '#F0F4FA' },
  courtyard: { bg: '#F5EFE8', cardBg: '#FDFAF6', accent: '#8C4A32', text: '#33241E' },
  shelter: { bg: '#F2EFEA', cardBg: '#FCFBF8', accent: '#5C6F68', text: '#28322E' },
};

export function FallbackJournalStage(props: {
  readonly snapshot: NimiUtopiaSnapshot;
  readonly daypart: HabitatDaypart;
  readonly frozen: boolean;
  readonly reducedMotion?: boolean;
  readonly selectedPlaceId: string | null;
  readonly selectedResidentHandle: string | null;
  readonly chibiWardrobe?: ChibiWardrobeMap;
  readonly bindingsByHandle?: Readonly<Record<string, string>>;
  readonly packFallbackReason?: 'pack-index-error' | 'version-mismatch' | 'no-pack';
  readonly packFallbackDetail?: string | null;
  readonly onOpenPackLibrary?: () => void;
  readonly onOpenHomePartners?: () => void;
  readonly onSelectPlace: (placeId: string) => void;
  readonly onSelectResident: (resident: NimiUtopiaResident) => void;
}) {
  const {
    snapshot,
    daypart,
    frozen,
    reducedMotion = false,
    selectedPlaceId,
    selectedResidentHandle,
    chibiWardrobe,
    bindingsByHandle,
    packFallbackReason = 'no-pack',
    packFallbackDetail = null,
    onOpenPackLibrary,
    onOpenHomePartners,
    onSelectPlace,
    onSelectResident,
  } = props;
  const theme = JOURNAL_THEME_PALETTES[snapshot.habitat.themeTag] ?? JOURNAL_THEME_PALETTES.shelter;
  const openSet = new Set(snapshot.openPlaceIds);
  const pqBreakdown = buildPlaceOccupancyBreakdown('personal-quarter', snapshot);
  const interactingResidents = snapshot.residents.filter((r) => r.current?.interaction);
  const globalSceneryEvents = snapshot.activeEvents.filter((ev) => !ev.placeId);
  const placeNameById = new Map<string, string>(snapshot.habitat.places.map((p) => [p.id, p.name]));

  return (
    <section
      className={`utopia-journal-stage daypart-${daypart} ${frozen ? 'is-frozen' : ''}`}
      data-utopia-expressive-stage="journal-fallback"
      data-utopia-pack-fallback-reason={packFallbackReason}
      aria-label={`${snapshot.habitat.title} 风物手账舞台`}
      style={{
        '--utopia-stage-bg': theme.bg,
        '--utopia-stage-badge-bg': theme.cardBg,
        '--utopia-stage-badge-text': theme.text,
        '--utopia-stage-accent': theme.accent,
      } as React.CSSProperties}
    >
      <WeatherParticleCanvas
        effects={[]}
        sceneryEvents={globalSceneryEvents}
        daypart={daypart}
        frozen={frozen}
        reducedMotion={reducedMotion}
      />

      <div className="utopia-journal-header">
        <div className="utopia-journal-header-copy">
          <div className="utopia-journal-stamp-row">
            <span className="utopia-journal-stamp">
              <CompassRoseIcon size={12} />
              <span>通用风物手账视图</span>
            </span>
            <span className="utopia-journal-open-stat">
              开放场所 {snapshot.habitat.places.filter((p) => openSet.has(p.id)).length}/{snapshot.habitat.places.length}
            </span>
          </div>
          <h2 className="utopia-journal-heading">{snapshot.habitat.title}</h2>
          <p className="utopia-journal-summary">{snapshot.habitat.backdropSummary}</p>
          {(packFallbackReason === 'pack-index-error' || packFallbackReason === 'version-mismatch') && (
            <div
              className="utopia-journal-fallback-notice"
              role="status"
              style={{
                marginTop: 8,
                padding: '7px 11px',
                borderRadius: 10,
                fontSize: 12,
                lineHeight: 1.5,
                background: 'rgba(224, 159, 62, 0.14)',
                border: '1px solid rgba(224, 159, 62, 0.36)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <span>
                {packFallbackReason === 'pack-index-error'
                  ? `画卷索引读取异常（${packFallbackDetail || '未能读取已导入洞天包列表'}），当前以通用手账忠实展示住地。`
                  : '当前住地与本地同 ID 画卷包版本不一致，已切换为通用风物手账如实呈现。'}
              </span>
              {onOpenPackLibrary && (
                <button
                  type="button"
                  className="utopia-mini-btn"
                  onClick={onOpenPackLibrary}
                >
                  打开画卷库
                </button>
              )}
            </div>
          )}
        </div>

        {snapshot.activeEvents.length > 0 && (
          <div className="utopia-journal-scenery-strip">
            {snapshot.activeEvents.map((ev) => {
              const scopedName = ev.placeId ? placeNameById.get(ev.placeId) : null;
              return (
                <span key={ev.eventId} className="utopia-journal-scenery-pill">
                  <SceneryGlyph kind={ev.sceneryKind} size={12} />
                  <span>{scopedName ? `${ev.label} · ${scopedName}` : ev.label}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>

      <div className="utopia-journal-grid">
        {snapshot.habitat.places.map((place) => {
          const isOpen = openSet.has(place.id);
          const breakdown = buildPlaceOccupancyBreakdown(place.id, snapshot);
          const isSelected = selectedPlaceId === place.id;
          const placeEvents = snapshot.activeEvents.filter((e) => e.placeId === place.id);

          return (
            <div
              key={place.id}
              className={`utopia-journal-card ${isOpen ? 'is-open' : 'is-closed'} ${isSelected ? 'is-selected' : ''}`}
            >
              <button
                type="button"
                className="utopia-journal-card-trigger"
                aria-label={buildPlaceAriaLabel({
                  placeName: place.name,
                  isPrivateQuarter: false,
                  indoor: place.indoor,
                  isOpen,
                  breakdown,
                })}
                onClick={() => onSelectPlace(place.id)}
              >
                <div className="utopia-journal-card-top">
                  <span className="utopia-journal-icon" aria-hidden="true">
                    <ArchetypeIcon archetype={place.archetype} size={15} />
                  </span>
                  <span className="utopia-journal-title">{place.name}</span>
                  <span className="utopia-journal-meta">
                    {isOpen ? (
                      place.indoor ? '室内开放' : '露天开放'
                    ) : (
                      <span className="utopia-inline-icon-text">
                        <LockClosedIcon size={11} />
                        <span>条件暂闭</span>
                      </span>
                    )}
                  </span>
                </div>
                <p className="utopia-journal-traits">{place.sensoryTraits}</p>
                {placeEvents.length > 0 && (
                  <div className="utopia-journal-place-events">
                    {placeEvents.map((ev) => (
                      <span key={ev.eventId} className="utopia-journal-event-chip">
                        <SceneryGlyph kind={ev.sceneryKind} size={11} />
                        <span>{ev.label}</span>
                      </span>
                    ))}
                  </div>
                )}
              </button>
              <PlaceResidentBadges
                placeId={place.id}
                breakdown={breakdown}
                maxVisibleAvatars={4}
                selectedHandle={selectedResidentHandle}
                chibiWardrobe={chibiWardrobe}
                bindingsByHandle={bindingsByHandle}
                onSelectResident={onSelectResident}
              />
            </div>
          );
        })}
      </div>

      <div className="utopia-journal-bottom-row">
        <div className={`utopia-quarter-wing ${selectedPlaceId === 'personal-quarter' ? 'is-selected' : ''}`}>
          <button
            type="button"
            className="utopia-journal-card-trigger"
            aria-label={buildPlaceAriaLabel({
              placeName: snapshot.habitat.personalQuarter.name,
              isPrivateQuarter: true,
              indoor: true,
              isOpen: true,
              breakdown: pqBreakdown,
            })}
            onClick={() => onSelectPlace('personal-quarter')}
          >
            <div className="utopia-journal-card-top">
              <span className="utopia-journal-icon" aria-hidden="true">
                <ArchetypeIcon archetype="personal-quarter" size={15} />
              </span>
              <span className="utopia-journal-title">{snapshot.habitat.personalQuarter.name}</span>
              <span className="utopia-journal-meta">各自独立私舍 · 常开</span>
            </div>
            <p className="utopia-journal-traits">{snapshot.habitat.personalQuarter.sensoryTraits}</p>
          </button>
          <PlaceResidentBadges
            placeId="personal-quarter"
            breakdown={pqBreakdown}
            maxVisibleAvatars={6}
            selectedHandle={selectedResidentHandle}
            chibiWardrobe={chibiWardrobe}
            bindingsByHandle={bindingsByHandle}
            onSelectResident={onSelectResident}
          />
        </div>

        {interactingResidents.length > 0 && (
          <div className="utopia-foreground-interaction" role="region" aria-label="正在对话或应用协作中的伙伴">
            <span className="utopia-interaction-heading">
              <ChatBubbleIcon size={13} />
              <span>正在对话或应用协作中</span>
            </span>
            <div className="utopia-interaction-list">
              {interactingResidents.map((res) => (
                <button
                  key={res.agentHandle}
                  type="button"
                  className="utopia-resident-pill"
                  onClick={() => onSelectResident(res)}
                >
                  <HandDrawnChibiMedallion
                    appearance={resolveChibiAppearance(res.agentHandle, chibiWardrobe, bindingsByHandle)}
                    size="xs"
                    presenceTone="conversing"
                  />
                  <span className="utopia-resident-name">{res.displayName}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <SanctuaryPresenceDock
        snapshot={snapshot}
        selectedResidentHandle={selectedResidentHandle}
        chibiWardrobe={chibiWardrobe}
        bindingsByHandle={bindingsByHandle}
        onSelectResident={onSelectResident}
        onFocusPlace={(pid) => {
          if (selectedPlaceId !== pid) onSelectPlace(pid);
        }}
        onOpenHomePartners={onOpenHomePartners}
      />
    </section>
  );
}
