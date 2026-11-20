import { Button, StatusBadge } from '@nimiplatform/kit/ui';
import type { NimiLocalAppClient } from '@nimiplatform/sdk';
import type { NimiUtopiaSnapshot, NimiUtopiaUpdateIntent } from '@nimiplatform/sdk/app';
import { SceneryGlyph } from '../components/UtopiaIcons.js';
import {
  SCENERY_KIND_LABELS,
  detectSystemIanaTimezone,
  formatRemainingDuration,
  previewParameterPlaceDiff,
  utopiaTimeToMs,
} from '../domain/visit-journal.js';
import { NaturalLanguageTunerSection } from './NaturalLanguageTunerSection.js';

export function DeterministicTunerPanel(props: {
  readonly client: NimiLocalAppClient;
  readonly snapshot: NimiUtopiaSnapshot;
  readonly nowMs: number;
  readonly busy: boolean;
  readonly onApplyIntent: (intent: NimiUtopiaUpdateIntent, expectedRevision?: string) => Promise<boolean>;
}) {
  const { client, snapshot, nowMs, busy, onApplyIntent } = props;
  const systemTz = detectSystemIanaTimezone();
  const showTzPrompt = snapshot.timezone === 'UTC' && systemTz && systemTz !== 'UTC';
  const placeNameById = new Map(snapshot.habitat.places.map((p) => [p.id, p.name]));
  const activeLabels = new Set(snapshot.activeEvents.map((ev) => ev.label));

  return (
    <div className="utopia-side-stack">
      {showTzPrompt && (
        <section className="utopia-card-section is-highlighted" aria-label="本地时区对齐提示">
          <div className="utopia-section-header">
            <strong>对齐本机昼夜节律</strong>
            <Button
              tone="secondary"
              size="sm"
              disabled={busy}
              onClick={() => void onApplyIntent({ kind: 'set-timezone', timezone: systemTz })}
            >
              同步为 {systemTz}
            </Button>
          </div>
          <p className="utopia-causal-note">
            当前住地按 UTC 计时，同步本机时区后，画卷晨昏光影将与伙伴作息时段一致。
          </p>
        </section>
      )}

      <section className="utopia-card-section" aria-labelledby="manual-params-heading">
        <div className="utopia-section-header">
          <h3 id="manual-params-heading">环境参数旋钮</h3>
          <span className="utopia-muted-caption">调节后即时生效</span>
        </div>

        {snapshot.habitat.parameters.length === 0 ? (
          <p className="utopia-empty-hint">当前洞天暂无可调环境参数。</p>
        ) : (
          <div className="utopia-param-groups">
            {snapshot.habitat.parameters.map((param) => {
              const activeVal = snapshot.parameterValues[param.key] ?? param.defaultValue;
              return (
                <div key={param.key} className="utopia-param-group" role="group" aria-label={param.label}>
                  <div className="utopia-param-group-head">
                    <strong>{param.label}</strong>
                    <span className="utopia-muted-caption">{param.options.length} 档可调</span>
                  </div>
                  <div className="utopia-param-options">
                    {param.options.map((opt) => {
                      const isCurrent = opt.value === activeVal;
                      const diff = isCurrent
                        ? null
                        : previewParameterPlaceDiff(snapshot.habitat, snapshot.parameterValues, { [param.key]: opt.value });

                      let consequenceTone: 'open' | 'close' | null = null;
                      let consequenceNote: string | null = null;
                      if (diff) {
                        if (diff.newlyClosed.length > 0) {
                          consequenceTone = 'close';
                          consequenceNote = `− 将暂闭：${diff.newlyClosed.map((p) => p.name).join('、')}`;
                        } else if (diff.newlyOpened.length > 0) {
                          consequenceTone = 'open';
                          consequenceNote = `+ 将开放：${diff.newlyOpened.map((p) => p.name).join('、')}`;
                        }
                      }

                      return (
                        <button
                          key={opt.value}
                          type="button"
                          disabled={busy || isCurrent}
                          aria-pressed={isCurrent}
                          className={`utopia-param-option-btn ${isCurrent ? 'is-active' : ''}`}
                          onClick={() => {
                            void onApplyIntent({
                              kind: 'apply-tuning',
                              parameters: { [param.key]: opt.value },
                            });
                          }}
                        >
                          <div className="utopia-param-opt-top">
                            <strong>{opt.label}</strong>
                            {isCurrent && <StatusBadge tone="success">当前</StatusBadge>}
                          </div>
                          <span className="utopia-param-opt-summary">{opt.summary}</span>
                          {consequenceNote && (
                            <span className={`utopia-param-opt-causal is-${consequenceTone}`}>
                              {consequenceNote}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="utopia-card-section" aria-labelledby="scenery-events-heading">
        <div className="utopia-section-header">
          <h3 id="scenery-events-heading">洞天风物签</h3>
          <span className="utopia-muted-caption">有界双槽 · 到期自消</span>
        </div>

        {snapshot.activeEvents.length > 0 && (
          <ul className="utopia-active-events-list" aria-label="生效中的风物景象">
            {snapshot.activeEvents.map((ev) => {
              const startMs = utopiaTimeToMs(ev.startsAt);
              const endMs = utopiaTimeToMs(ev.expiresAt);
              const span = Math.max(60_000, endMs - startMs);
              const remainRatio = Math.max(0.06, Math.min(1, (endMs - nowMs) / span));

              return (
                <li key={ev.eventId} className="utopia-active-event-row">
                  <div className="utopia-active-event-body">
                    <div className="utopia-journal-item-head">
                      <strong className="utopia-inline-icon-text">
                        <SceneryGlyph kind={ev.sceneryKind} size={13} />
                        <span>{ev.label}</span>
                      </strong>
                      <StatusBadge tone="neutral">{formatRemainingDuration(ev.expiresAt, nowMs)}</StatusBadge>
                    </div>
                    <p className="utopia-causal-note">
                      {ev.description}
                      {ev.placeId && placeNameById.has(ev.placeId) ? `（位于${placeNameById.get(ev.placeId)}）` : ''}
                    </p>
                    <div className="utopia-event-progress-track" aria-hidden="true">
                      <span
                        className="utopia-event-progress-fill"
                        style={{ width: `${Math.round(remainRatio * 100)}%` }}
                      />
                    </div>
                  </div>
                  <Button
                    tone="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      void onApplyIntent({
                        kind: 'apply-tuning',
                        event: { kind: 'clear-event', eventId: ev.eventId },
                      });
                    }}
                  >
                    收起
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        {snapshot.habitat.eventPresets.length > 0 ? (
          <div className="utopia-preset-grid">
            {snapshot.habitat.eventPresets.map((preset) => {
              const isLit = activeLabels.has(preset.label);
              const placeName = preset.placeId ? placeNameById.get(preset.placeId) : null;
              return (
                <div key={preset.id} className={`utopia-preset-card ${isLit ? 'is-lit' : ''}`}>
                  <div className="utopia-preset-copy">
                    <div className="utopia-preset-head">
                      <strong className="utopia-inline-icon-text">
                        <SceneryGlyph kind={preset.sceneryKind} size={13} />
                        <span>{preset.label}</span>
                      </strong>
                      <span className="utopia-muted-caption">
                        {SCENERY_KIND_LABELS[preset.sceneryKind]}
                        {placeName ? ` · ${placeName}` : ''}
                        {' · '}
                        {Math.round((preset.defaultDurationMinutes / 60) * 10) / 10}h
                      </span>
                    </div>
                    <p className="utopia-causal-note">{preset.description}</p>
                  </div>
                  <Button
                    tone="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      void onApplyIntent({
                        kind: 'apply-tuning',
                        event: { kind: 'trigger-preset', presetId: preset.id },
                      });
                    }}
                  >
                    {isLit ? '续添' : '点亮风物'}
                  </Button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="utopia-empty-hint">当前洞天暂无预设风物签。</p>
        )}
      </section>

      <NaturalLanguageTunerSection
        client={client}
        snapshot={snapshot}
        busy={busy}
        onCommitTuning={(intent, expectedRevision) => onApplyIntent(intent, expectedRevision)}
      />
    </div>
  );
}
