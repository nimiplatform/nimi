import { StatusBadge } from '@nimiplatform/kit/ui';
import type { NimiUtopiaResident, NimiUtopiaSnapshot } from '@nimiplatform/sdk/app';
import { CompanionAvatar } from '../components/CompanionAvatar.js';
import { CompassRoseIcon, SceneryGlyph } from '../components/UtopiaIcons.js';
import { resolveResidentPresence } from '../domain/agent-profiles.js';
import {
  SHARED_STATE_LABELS,
  THEME_TAG_LABELS,
  formatSharedActivityDisplay,
  formatShortDateTimeInTimezone,
  utopiaTimeToMs,
  type JournalHighlight,
} from '../domain/visit-journal.js';

export function JournalAndSharedTab(props: {
  readonly snapshot: NimiUtopiaSnapshot;
  readonly highlights: readonly JournalHighlight[];
  readonly avatarsByHandle?: Readonly<Record<string, string | null>>;
  readonly onOpenDraft: (resident: NimiUtopiaResident, prefill: string) => void;
}) {
  const { snapshot, highlights, avatarsByHandle, onOpenDraft } = props;

  const findResident = (handle: string | null): NimiUtopiaResident | null => {
    if (!handle) return null;
    return snapshot.residents.find((r) => r.agentHandle === handle) ?? null;
  };

  const nameOf = (handle: string): string =>
    snapshot.residents.find((r) => r.agentHandle === handle)?.displayName ?? '伙伴';

  const openPublicCount = snapshot.habitat.places.filter((p) => snapshot.openPlaceIds.includes(p.id)).length;

  // Detect live serendipitous encounters at open public places (2+ companions at the same place right now)
  const activeSharedKeys = new Set(
    snapshot.sharedActivities
      .filter((a) => a.state === 'active')
      .map((a) => `${a.placeId}:${[a.initiatorHandle, a.recipientHandle].sort().join('|')}`),
  );
  const placeNameById = new Map(snapshot.habitat.places.map((p) => [p.id, p.name]));
  const liveEncounters = snapshot.occupancy
    .filter((occ) => occ.placeId !== 'personal-quarter' && occ.agentHandles.length >= 2)
    .map((occ) => {
      const companions = occ.agentHandles
        .map((h) => findResident(h))
        .filter((r): r is NimiUtopiaResident => Boolean(r));
      const key = `${occ.placeId}:${companions.map((c) => c.agentHandle).sort().join('|')}`;
      return {
        placeId: occ.placeId,
        placeName: placeNameById.get(occ.placeId) ?? occ.placeId,
        companions,
        alreadyPaired: activeSharedKeys.has(key),
      };
    })
    .filter((item) => item.companions.length >= 2 && !item.alreadyPaired);

  return (
    <div className="utopia-side-stack">
      <section className="utopia-card-section utopia-postcard-section" aria-label="今日洞天风物志">
        <div className="utopia-postcard-top">
          <span className="utopia-postcard-kicker">
            <CompassRoseIcon size={12} />
            <span>洞天风物志 · {THEME_TAG_LABELS[snapshot.habitat.themeTag] ?? snapshot.habitat.themeTag}</span>
          </span>
          <span className="utopia-muted-caption">
            开放场所 {openPublicCount}/{snapshot.habitat.places.length}
          </span>
        </div>

        <p className="utopia-postcard-summary">{snapshot.habitat.backdropSummary}</p>

        {snapshot.activeEvents.length > 0 && (
          <div className="utopia-postcard-events">
            {snapshot.activeEvents.map((ev) => (
              <span key={ev.eventId} className="utopia-postcard-event-pill">
                <SceneryGlyph kind={ev.sceneryKind} size={12} />
                <span>{ev.label}</span>
              </span>
            ))}
          </div>
        )}

        {snapshot.residents.length > 0 && (() => {
          const withPresence = snapshot.residents.map((res) => ({
            res,
            presence: resolveResidentPresence(res, snapshot),
          }));
          const engaged = withPresence.filter(
            ({ presence }) => presence.tone === 'conversing' || presence.tone === 'shared' || presence.tone === 'active',
          );
          const quiet = withPresence.filter(
            ({ presence }) => presence.tone === 'solitary' || presence.tone === 'resting',
          );
          const shownEngaged = engaged.slice(0, 4);
          const extraQuietCount = quiet.length + Math.max(0, engaged.length - shownEngaged.length);

          return (
            <div className="utopia-postcard-residents">
              {shownEngaged.map(({ res, presence }) => (
                <button
                  key={res.agentHandle}
                  type="button"
                  className="utopia-postcard-resident-row"
                  title={`${res.displayName} · ${presence.shortLocationOrState}`}
                  onClick={() => onOpenDraft(res, '')}
                >
                  <CompanionAvatar
                    displayName={res.displayName}
                    agentHandle={res.agentHandle}
                    avatarUrl={avatarsByHandle?.[res.agentHandle]}
                    size="xs"
                    presenceTone={presence.tone}
                  />
                  <span className="utopia-postcard-res-name">{res.displayName}</span>
                  <span className="utopia-postcard-res-state">{presence.shortLocationOrState}</span>
                </button>
              ))}

              {extraQuietCount > 0 && (
                <div className="utopia-postcard-resting-summary">
                  <div className="utopia-avatar-stack">
                    {quiet.slice(0, 4).map(({ res, presence }) => (
                      <CompanionAvatar
                        key={res.agentHandle}
                        displayName={res.displayName}
                        agentHandle={res.agentHandle}
                        avatarUrl={avatarsByHandle?.[res.agentHandle]}
                        size="xs"
                        presenceTone={presence.tone}
                      />
                    ))}
                  </div>
                  <span className="utopia-muted-caption">
                    {shownEngaged.length > 0
                      ? `其余 ${extraQuietCount} 位伙伴正在洞天缓步或私舍小憩`
                      : `${extraQuietCount} 位伙伴正在洞天缓步或私舍静息`}
                  </span>
                </div>
              )}
            </div>
          );
        })()}
      </section>

      <section className="utopia-card-section" aria-labelledby="journal-recent-heading">
        <div className="utopia-section-header">
          <h3 id="journal-recent-heading">住地近况手记</h3>
          <span className="utopia-muted-caption">近 24 小时摘要</span>
        </div>

        {highlights.length === 0 ? (
          <p className="utopia-empty-hint">
            这阵子洞天很安静，伙伴们各自按昼夜节律起居。点选上方伙伴或舞台路牌即可轻轻搭话。
          </p>
        ) : (
          <ul className="utopia-journal-list">
            {highlights.map((item) => {
              const target = findResident(item.relatedHandle);
              return (
                <li key={item.id} className="utopia-journal-item">
                  <div className="utopia-journal-item-head">
                    <time className="utopia-time-tag">{item.timeLabel}</time>
                    <StatusBadge tone={item.tone}>{item.badge}</StatusBadge>
                  </div>
                  <p className="utopia-journal-item-body">{item.summary}</p>
                  {target && item.suggestedDraft && (
                    <button
                      type="button"
                      className="utopia-inline-link-btn"
                      onClick={() => onOpenDraft(target, item.suggestedDraft!)}
                    >
                      借这件事向 {target.displayName} 搭话 →
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="utopia-card-section utopia-companionship-section" aria-labelledby="shared-arrangements-heading">
        <div className="utopia-section-header">
          <h3 id="shared-arrangements-heading">街巷偶遇与小聚</h3>
          <span className="utopia-muted-caption">
            {snapshot.sharedActivities.length > 0
              ? `${snapshot.sharedActivities.length} 段同游印记`
              : '茶叙 · 邻里日常'}
          </span>
        </div>

        {liveEncounters.length > 0 && (
          <div className="utopia-encounter-list">
            {liveEncounters.map((enc) => {
              const first = enc.companions[0]!;
              const names = enc.companions.map((c) => c.displayName).join('、');
              return (
                <div key={enc.placeId} className="utopia-encounter-spot-card">
                  <div className="utopia-shared-item-top">
                    <div className="utopia-shared-pair-ident">
                      <div className="utopia-avatar-stack">
                        {enc.companions.slice(0, 3).map((comp) => (
                          <CompanionAvatar
                            key={comp.agentHandle}
                            displayName={comp.displayName}
                            agentHandle={comp.agentHandle}
                            avatarUrl={avatarsByHandle?.[comp.agentHandle]}
                            size="xs"
                          />
                        ))}
                      </div>
                      <strong>此刻在「{enc.placeName}」偶遇</strong>
                    </div>
                    <StatusBadge tone="neutral">恰巧同处</StatusBadge>
                  </div>
                  <p className="utopia-shared-item-sub">
                    {names} 刚好都在这边忙活各自喜欢的事，微风拂过时说不定就会聊上几句。
                  </p>
                  <div>
                    <button
                      type="button"
                      className="utopia-inline-link-btn"
                      onClick={() =>
                        onOpenDraft(
                          first,
                          `看到你和${enc.companions.slice(1).map((c) => c.displayName).join('、')}刚好都在「${enc.placeName}」，今天这边热闹吗？`,
                        )
                      }
                    >
                      去和 {first.displayName} 搭句话 →
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {snapshot.sharedActivities.length === 0 ? (
          liveEncounters.length === 0 && (
            <div className="utopia-warm-scene-card">
              <p className="utopia-warm-scene-prose">
                {!snapshot.publicParticipation
                  ? '眼下大家都守着各自的清静时光；若想让伙伴们在茶座与庭院串门小聚，可在「伙伴」页开启邻里往来。'
                  : snapshot.residents.length <= 1
                    ? '等更多伙伴搬进这座洞天，街巷与茶座间便会渐渐热闹起来，遇上合拍的兴致还会相约同游。'
                    : (() => {
                        const firstTwo = snapshot.residents.slice(0, 2);
                        const p0 = resolveResidentPresence(firstTwo[0]!, snapshot);
                        const p1 = resolveResidentPresence(firstTwo[1]!, snapshot);
                        return `此刻 ${firstTwo[0]!.displayName}（${p0.shortLocationOrState}）与 ${firstTwo[1]!.displayName}（${p1.shortLocationOrState}）正按各自的步调起居；等散步在街巷茶座遇上投缘的兴致，便会自然坐下小聚。`;
                      })()}
              </p>
            </div>
          )
        ) : (
          <ul className="utopia-shared-list">
            {snapshot.sharedActivities.map((act) => {
              const initiatorName = nameOf(act.initiatorHandle);
              const recipientName = nameOf(act.recipientHandle);
              const display = formatSharedActivityDisplay(act, snapshot.habitatActivationId);
              const stateText = act.state === 'missed' && act.acceptedAt
                ? '约好却擦肩错过'
                : (SHARED_STATE_LABELS[act.state] ?? act.state);

              let badgeTone: 'neutral' | 'success' | 'warning' = 'neutral';
              if (act.state === 'active' || act.state === 'completed') badgeTone = 'success';
              else if (act.state === 'relocated' || act.state === 'relocated_partial' || act.state === 'invalidated') {
                badgeTone = 'warning';
              }

              const startMs = utopiaTimeToMs(act.startsAt);
              const endMs = utopiaTimeToMs(act.endsAt);
              const showTimeWindow = startMs > 0
                && ['accepted', 'active', 'completed', 'interrupted', 'relocated_partial'].includes(act.state);

              const chatResident = findResident(act.initiatorHandle) ?? findResident(act.recipientHandle);
              const partnerName = chatResident?.agentHandle === act.initiatorHandle ? recipientName : initiatorName;
              const draftText = display.draftForPartner(partnerName, stateText);

              return (
                <li key={act.activityRef} className="utopia-shared-item">
                  <div className="utopia-shared-item-top">
                    <div className="utopia-shared-pair-ident">
                      <div className="utopia-avatar-stack">
                        <CompanionAvatar
                          displayName={initiatorName}
                          agentHandle={act.initiatorHandle}
                          avatarUrl={avatarsByHandle?.[act.initiatorHandle]}
                          size="xs"
                        />
                        <CompanionAvatar
                          displayName={recipientName}
                          agentHandle={act.recipientHandle}
                          avatarUrl={avatarsByHandle?.[act.recipientHandle]}
                          size="xs"
                        />
                      </div>
                      <strong>{initiatorName} &amp; {recipientName}</strong>
                    </div>
                    <StatusBadge tone={badgeTone}>{stateText}</StatusBadge>
                  </div>
                  <p className="utopia-shared-item-sub">
                    {display.subtitle}
                  </p>
                  {showTimeWindow && (
                    <small className="utopia-muted-caption">
                      {formatShortDateTimeInTimezone(startMs, snapshot.timezone)}
                      {endMs > 0 ? ` — ${formatShortDateTimeInTimezone(endMs, snapshot.timezone)}` : ''}
                    </small>
                  )}
                  {chatResident && (
                    <div>
                      <button
                        type="button"
                        className="utopia-inline-link-btn"
                        onClick={() => onOpenDraft(chatResident, draftText)}
                      >
                        聊聊这段时光 →
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
