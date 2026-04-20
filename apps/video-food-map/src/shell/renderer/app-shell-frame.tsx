import type { MouseEvent, ReactNode } from 'react';
import { AmbientBackground, Button, SearchField, StatusBadge, Surface } from '@nimiplatform/nimi-kit/ui';

import type { SurfaceId } from './app-helpers.js';
import { SURFACES } from './app-surface-shared.js';

export function VideoFoodMapShellFrame(props: {
  surface: SurfaceId;
  sidebarOpen: boolean;
  intakeInput: string;
  intakeBusy: boolean;
  intakeActionLabel: string;
  headerFeedbackText: string | null;
  intakeHelperText: string;
  mappedVenueCount: number;
  favoriteCount: number;
  reviewCount: number;
  onWindowDragStart: (event: MouseEvent<HTMLDivElement>) => void;
  onSurfaceChange: (surface: SurfaceId) => void;
  onSidebarOpen: () => void;
  onSidebarClose: () => void;
  onIntakeInputChange: (next: string) => void;
  onIntakeSubmit: () => void;
  sidebar: ReactNode;
  children: ReactNode;
}) {
  return (
    <AmbientBackground variant="mesh" className="flex h-full min-h-0 flex-col overflow-hidden">
      <div
        className="vfm-drag-strip flex h-11 shrink-0 items-center justify-center px-28 text-xs font-medium tracking-[0.18em] text-[var(--nimi-text-muted)]"
        data-tauri-drag-region
        onMouseDown={props.onWindowDragStart}
      >
        VIDEO FOOD MAP
      </div>

      <div className="flex min-h-0 flex-1 gap-3 px-3 pb-3">
        <Surface tone="panel" material="glass-thick" elevation="raised" className="hidden w-[92px] shrink-0 flex-col items-center gap-5 rounded-[30px] px-3 py-5 xl:flex">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--nimi-action-primary-bg)] text-sm font-bold text-white shadow-[0_18px_40px_rgba(249,115,22,0.24)]">
            食
          </div>
          <div className="flex w-full flex-col gap-3">
            {SURFACES.map((item) => {
              const active = props.surface === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-label={item.label}
                  onClick={() => props.onSurfaceChange(item.id)}
                  className={`vfm-shell-nav-button flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-2xl px-2 text-center transition ${
                    active
                      ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,white)] text-[var(--nimi-text-primary)]'
                      : 'text-[var(--nimi-text-secondary)] hover:bg-white/40 hover:text-[var(--nimi-text-primary)]'
                  }`}
                >
                  <span className={`flex h-7 w-7 items-center justify-center rounded-xl text-xs font-semibold ${active ? 'bg-white/70 text-[var(--nimi-action-primary-bg)]' : 'bg-white/28'}`}>
                    {item.badge}
                  </span>
                  <span className="text-[10px] font-medium leading-3">{item.label}</span>
                </button>
              );
            })}
          </div>
        </Surface>

        <div className="relative flex min-w-0 flex-1 flex-col gap-3 overflow-hidden">
          <Surface tone="panel" material="glass-regular" elevation="raised" className="vfm-radius-shell shrink-0 p-4 md:p-5">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 xl:hidden">
                    <Button tone="secondary" size="sm" onClick={props.onSidebarOpen}>
                      打开我的清单
                    </Button>
                    {SURFACES.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => props.onSurfaceChange(item.id)}
                        className={`rounded-full border px-3 py-1.5 text-xs transition ${
                          props.surface === item.id
                            ? 'border-[var(--nimi-action-primary-bg)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,white)] text-[var(--nimi-action-primary-bg)]'
                            : 'border-[var(--nimi-border-subtle)] text-[var(--nimi-text-secondary)]'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <div className="text-2xl font-semibold tracking-[-0.03em] text-[var(--nimi-text-primary)]">
                    {SURFACES.find((item) => item.id === props.surface)?.label || '我的空间'}
                  </div>
                  <div className="text-sm leading-7 text-[var(--nimi-text-secondary)]">
                    {SURFACES.find((item) => item.id === props.surface)?.description}
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <StatusBadge tone="warning">{props.reviewCount} 条待整理</StatusBadge>
                  <StatusBadge tone="success">{props.favoriteCount} 家收藏</StatusBadge>
                  <StatusBadge tone="info">{props.mappedVenueCount} 家上图</StatusBadge>
                </div>
              </div>

              <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
                <div className="space-y-2">
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                    <SearchField
                      value={props.intakeInput}
                      onChange={(event) => props.onIntakeInputChange(event.target.value)}
                      placeholder="把新种草放进空间里，贴视频或博主主页..."
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          props.onIntakeSubmit();
                        }
                      }}
                    />
                    <Button
                      tone="primary"
                      onClick={props.onIntakeSubmit}
                      disabled={!props.intakeInput.trim() || props.intakeBusy}
                    >
                      {props.intakeBusy ? '处理中...' : props.intakeActionLabel}
                    </Button>
                  </div>
                  <div className="text-xs leading-6 text-[var(--nimi-text-muted)]">
                    {props.headerFeedbackText || props.intakeHelperText}
                  </div>
                </div>
              </div>
            </div>
          </Surface>

          <div className={`fixed inset-0 z-20 bg-black/28 transition xl:hidden ${props.sidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`} onClick={props.onSidebarClose} />

          <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
            <aside
              className={`absolute inset-y-0 left-0 z-30 w-[min(360px,calc(100vw-32px))] max-w-full transition-transform xl:static xl:z-0 xl:w-[340px] xl:translate-x-0 ${
                props.sidebarOpen ? 'translate-x-0' : '-translate-x-full'
              }`}
            >
              <Surface tone="panel" material="glass-regular" elevation="base" className="vfm-radius-shell h-full overflow-hidden">
                {props.sidebar}
              </Surface>
            </aside>

            <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <div className="flex-1 overflow-auto overflow-x-hidden">
                {props.children}
              </div>
            </main>
          </div>
        </div>
      </div>
    </AmbientBackground>
  );
}
