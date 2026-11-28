import { useEffect, useRef, useState } from 'react';
import { Button } from '@nimiplatform/kit/ui';
import type { HabitatDaypart, NimiUtopiaSnapshot } from '@nimiplatform/sdk/app';
import {
  ChatBubbleIcon,
  CollapseStageIcon,
  CompassRoseIcon,
  DaypartIcon,
  ExpandStageIcon,
  SceneryGlyph,
  ScrollMapIcon,
  SlidersIcon,
  VolumeMutedIcon,
  VolumeOnIcon,
} from '../components/UtopiaIcons.js';
import {
  DAYPART_LABELS,
  THEME_TAG_LABELS,
  formatClockInTimezone,
  formatRemainingDuration,
  previewParameterPlaceDiff,
  utopiaTimeToMs,
} from '../domain/visit-journal.js';

export type UtopiaDrawerTab = 'journal' | 'residents' | 'tuner';

export const UTOPIA_HORIZON_HEIGHT_VAR = '--utopia-horizon-height';

export function HorizonTopBar(props: {
  readonly snapshot: NimiUtopiaSnapshot | null;
  readonly nowMs: number;
  readonly daypart: HabitatDaypart;
  readonly frozen: boolean;
  readonly busy?: boolean;
  readonly audioMuted: boolean;
  readonly audioVolume?: number;
  readonly hasAudioTrack: boolean;
  readonly sidebarCollapsed: boolean;
  readonly activeDrawerTab?: UtopiaDrawerTab | null;
  readonly residentCount?: number;
  readonly hudHidden?: boolean;
  readonly onSelectDrawerTab?: (tab: UtopiaDrawerTab) => void;
  readonly onToggleAudioMute: () => void;
  readonly onAudioVolumeChange?: (nextVolume: number) => void;
  readonly onQuickCycleParameter?: (parameterKey: string, nextValue: string) => void;
  readonly onOpenTuner: () => void;
  readonly onOpenPackLibrary: () => void;
  readonly onToggleSidebar: () => void;
  readonly onRetryRefresh: () => void;
}) {
  const {
    snapshot,
    nowMs,
    daypart,
    frozen,
    busy = false,
    audioMuted,
    audioVolume = 0.72,
    hasAudioTrack,
    sidebarCollapsed,
    activeDrawerTab = null,
    residentCount,
    hudHidden = false,
    onSelectDrawerTab,
    onToggleAudioMute,
    onAudioVolumeChange,
    onQuickCycleParameter,
    onOpenTuner,
    onOpenPackLibrary,
    onToggleSidebar,
    onRetryRefresh,
  } = props;

  const observedMs = snapshot ? utopiaTimeToMs(snapshot.observedAt) : nowMs;
  const clockLabel = snapshot ? formatClockInTimezone(nowMs, snapshot.timezone) : '--:--';
  const frozenClockLabel = snapshot ? formatClockInTimezone(observedMs, snapshot.timezone) : '--:--';
  const themeLabel = snapshot ? (THEME_TAG_LABELS[snapshot.habitat.themeTag] ?? snapshot.habitat.themeTag) : '';
  const totalResidents = residentCount ?? snapshot?.residents.length ?? 0;
  const headerRef = useRef<HTMLElement | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{
    readonly key: string;
    readonly paramLabel: string;
    readonly nextValue: string;
    readonly nextLabel: string;
    readonly closedNames: string;
    readonly affectedNames: string;
  } | null>(null);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const hostTarget = (el.closest('.utopia-world-shell') as HTMLElement | null) ?? document.documentElement;

    const publishHeight = (entry?: ResizeObserverEntry) => {
      const borderBoxHeight = entry?.borderBoxSize?.[0]?.blockSize ?? 0;
      const rectHeight = el.getBoundingClientRect().height;
      const measured = borderBoxHeight > 0
        ? borderBoxHeight
        : (rectHeight > 0 ? rectHeight : (el.offsetHeight > 0 ? el.offsetHeight : (entry?.contentRect?.height ?? 0)));
      if (measured > 0) {
        hostTarget.style.setProperty(UTOPIA_HORIZON_HEIGHT_VAR, `${Math.ceil(measured)}px`);
      }
    };

    publishHeight();
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver((entries) => {
          publishHeight(entries[0]);
        })
      : null;
    ro?.observe(el);
    const onResize = () => publishHeight();
    window.addEventListener('resize', onResize);

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', onResize);
      hostTarget.style.removeProperty(UTOPIA_HORIZON_HEIGHT_VAR);
    };
  }, []);

  return (
    <header
      ref={headerRef}
      className={`utopia-horizon-bar ${hudHidden ? 'is-hud-hidden' : ''}`}
      aria-label="洞天顶部状态栏"
    >
      <div className="utopia-horizon-primary">
        {snapshot ? (
          <>
            <div className="utopia-horizon-identity">
              <span className="utopia-horizon-seal" aria-hidden="true">
                <CompassRoseIcon size={14} />
              </span>
              <strong className="utopia-horizon-title">{snapshot.habitat.title}</strong>
              <span className="utopia-horizon-theme">{themeLabel}</span>
            </div>

            <span className="utopia-horizon-pill is-time" title={`住地时区：${snapshot.timezone}`}>
              <DaypartIcon daypart={daypart} size={13} />
              <span>{clockLabel} · {DAYPART_LABELS[daypart]}</span>
            </span>

            {snapshot.habitat.parameters.map((param) => {
              const val = snapshot.parameterValues[param.key] ?? param.defaultValue;
              const idx = Math.max(0, param.options.findIndex((o) => o.value === val));
              const opt = param.options[idx];
              const nextOpt = param.options.length >= 2
                ? param.options[(idx + 1) % param.options.length]
                : null;

              if (onQuickCycleParameter && nextOpt) {
                const diff = previewParameterPlaceDiff(
                  snapshot.habitat,
                  snapshot.parameterValues,
                  { [param.key]: nextOpt.value },
                );
                const closingIds = new Set(diff.newlyClosed.map((p) => p.id));
                const affected = closingIds.size > 0
                  ? snapshot.residents.filter(
                      (r) => r.current?.placeId && closingIds.has(r.current.placeId) && !r.current.interaction,
                    )
                  : [];
                const scopeParts = [`全住地生效 · 点击切换为「${nextOpt.label}」`];
                if (diff.newlyOpened.length > 0) {
                  scopeParts.push(`将开放：${diff.newlyOpened.map((p) => p.name).join('、')}`);
                }
                if (diff.newlyClosed.length > 0) {
                  const closedText = `将暂闭：${diff.newlyClosed.map((p) => p.name).join('、')}`;
                  scopeParts.push(
                    affected.length > 0
                      ? `${closedText}（会中断 ${affected.map((r) => r.displayName).join('、')} 当前活动）`
                      : closedText,
                  );
                }
                const fullHint = `${param.label}：${opt?.summary ?? val}（${scopeParts.join('；')}）`;
                const closedNames = diff.newlyClosed.map((p) => p.name).join('、');
                const affectedNames = affected.map((r) => r.displayName).join('、');

                return (
                  <button
                    key={param.key}
                    type="button"
                    disabled={busy || frozen}
                    className={`utopia-horizon-pill is-interactive ${affected.length > 0 ? 'has-impact-warn' : ''}`}
                    title={fullHint}
                    aria-label={`${param.label}当前为${opt?.label ?? val}，${scopeParts.join('，')}`}
                    onClick={() => {
                      if (affected.length > 0) {
                        setPendingConfirm({
                          key: param.key,
                          paramLabel: param.label,
                          nextValue: nextOpt.value,
                          nextLabel: nextOpt.label,
                          closedNames,
                          affectedNames,
                        });
                        return;
                      }
                      setPendingConfirm(null);
                      onQuickCycleParameter(param.key, nextOpt.value);
                    }}
                  >
                    <span className="utopia-pill-kicker">{param.label}</span>
                    <strong>{opt?.label ?? val}</strong>
                    {affected.length > 0 ? (
                      <span className="utopia-pill-impact-tag is-warn">
                        切至{nextOpt.label}将打断{affected.length}人
                      </span>
                    ) : diff.newlyClosed.length > 0 ? (
                      <span className="utopia-pill-impact-tag">
                        切至{nextOpt.label}暂闭{diff.newlyClosed.length}处
                      </span>
                    ) : null}
                  </button>
                );
              }

              return (
                <span
                  key={param.key}
                  className="utopia-horizon-pill"
                  title={`${param.label}：${opt?.summary ?? val}`}
                >
                  <span className="utopia-pill-kicker">{param.label}</span>
                  <strong>{opt?.label ?? val}</strong>
                </span>
              );
            })}

            {snapshot.activeEvents.map((ev) => (
              <span
                key={ev.eventId}
                className="utopia-horizon-pill is-event"
                title={ev.description}
              >
                <SceneryGlyph kind={ev.sceneryKind} size={12} />
                <span>{ev.label} · {formatRemainingDuration(ev.expiresAt, nowMs)}</span>
              </span>
            ))}
          </>
        ) : (
          <span className="utopia-horizon-loading">正在展开洞天画卷…</span>
        )}
      </div>

      {pendingConfirm && snapshot && onQuickCycleParameter && !frozen && (
        <div className="utopia-horizon-confirm-strip" role="alertdialog" aria-label="环境切换影响确认">
          <span>
            全住地切换「{pendingConfirm.paramLabel}」为「{pendingConfirm.nextLabel}」将暂闭{pendingConfirm.closedNames}，并中断 {pendingConfirm.affectedNames} 当前活动。
          </span>
          <div className="utopia-horizon-confirm-actions">
            <Button
              tone="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setPendingConfirm(null)}
            >
              取消
            </Button>
            <Button
              tone="primary"
              size="sm"
              disabled={busy}
              onClick={() => {
                const target = pendingConfirm;
                setPendingConfirm(null);
                onQuickCycleParameter(target.key, target.nextValue);
              }}
            >
              确认切换
            </Button>
          </div>
        </div>
      )}

      {frozen && snapshot && (
        <div className="utopia-freeze-banner" role="status">
          <span>画面定格于 {frozenClockLabel} · 等待连接 Runtime</span>
          <Button tone="ghost" size="sm" onClick={onRetryRefresh}>
            立即重试
          </Button>
        </div>
      )}

      <div className="utopia-horizon-actions">
        <div className="utopia-audio-control-cluster">
          <button
            type="button"
            className={`utopia-toolbar-btn is-audio-pill ${!audioMuted ? 'is-active' : ''}`}
            disabled={!hasAudioTrack || frozen}
            aria-pressed={!audioMuted}
            aria-label={audioMuted ? '开启洞天环境声景' : '静音洞天环境声景'}
            title={hasAudioTrack ? (audioMuted ? '点击开启环境声景' : '点击静音环境声景') : '当前视图无音频轨道'}
            onClick={onToggleAudioMute}
          >
            {audioMuted ? <VolumeMutedIcon size={14} /> : <VolumeOnIcon size={14} />}
            <span>声景</span>
            {!audioMuted && hasAudioTrack && !frozen && (
              <span className="utopia-soundwave-bars" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            )}
          </button>

          {!audioMuted && hasAudioTrack && !frozen && onAudioVolumeChange && (
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={Math.round(audioVolume * 100)}
              aria-label="环境声景音量"
              title={`声景音量 ${Math.round(audioVolume * 100)}%`}
              className="utopia-volume-slider"
              onChange={(e) => onAudioVolumeChange(Number(e.currentTarget.value) / 100)}
            />
          )}
        </div>

        {onSelectDrawerTab ? (
          <div className="utopia-ribbon-nav-group" role="group" aria-label="手记、伙伴与营造">
            <button
              type="button"
              disabled={!snapshot}
              aria-pressed={activeDrawerTab === 'journal'}
              className={`utopia-toolbar-btn ${activeDrawerTab === 'journal' ? 'is-active' : ''}`}
              onClick={() => onSelectDrawerTab('journal')}
            >
              <span>手记</span>
            </button>
            <button
              type="button"
              disabled={!snapshot}
              aria-pressed={activeDrawerTab === 'residents'}
              className={`utopia-toolbar-btn ${activeDrawerTab === 'residents' ? 'is-active' : ''}`}
              onClick={() => onSelectDrawerTab('residents')}
            >
              <ChatBubbleIcon size={13} />
              <span>伙伴{totalResidents > 0 ? ` (${totalResidents})` : ''}</span>
            </button>
            <button
              type="button"
              disabled={!snapshot}
              aria-pressed={activeDrawerTab === 'tuner'}
              className={`utopia-toolbar-btn ${activeDrawerTab === 'tuner' ? 'is-active' : ''}`}
              onClick={() => onSelectDrawerTab('tuner')}
            >
              <SlidersIcon size={13} />
              <span>营造</span>
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              className="utopia-toolbar-btn"
              disabled={!snapshot}
              onClick={onOpenTuner}
            >
              <SlidersIcon size={14} />
              <span>营造调音</span>
            </button>

            <button
              type="button"
              className="utopia-toolbar-btn is-icon-toggle"
              aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏，全幅赏景'}
              title={sidebarCollapsed ? '展开侧栏' : '收起侧栏，全幅赏景'}
              onClick={onToggleSidebar}
            >
              {sidebarCollapsed ? <CollapseStageIcon size={14} /> : <ExpandStageIcon size={14} />}
              <span>{sidebarCollapsed ? '侧栏' : '全幅'}</span>
            </button>
          </>
        )}

        <button
          type="button"
          className="utopia-toolbar-btn is-gold-cta"
          onClick={onOpenPackLibrary}
        >
          <ScrollMapIcon size={14} />
          <span>展卷迁居</span>
        </button>
      </div>
    </header>
  );
}
