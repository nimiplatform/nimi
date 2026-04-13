import type { MouseEvent, ReactNode } from 'react';

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
    <div className="vfm-window-frame flex h-full min-h-0 flex-col overflow-hidden">
      <div
        className="vfm-drag-strip flex h-11 shrink-0 items-center justify-center px-28 text-xs font-medium tracking-[0.2em] text-white/42"
        data-tauri-drag-region
        onMouseDown={props.onWindowDragStart}
      >
        VIDEO FOOD MAP
      </div>
      <div className="vfm-app-shell flex min-h-0 flex-1 overflow-hidden">
        <nav className="vfm-rail flex w-20 flex-shrink-0 flex-col items-center gap-8 px-3 py-6">
          <div className="vfm-nav-brand flex h-10 w-10 items-center justify-center rounded-xl text-base font-bold text-white shadow-[0_16px_36px_rgba(249,115,22,0.28)]">
            图
          </div>
          <div className="flex w-full flex-col gap-4">
            {SURFACES.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-label={item.label}
                onClick={() => props.onSurfaceChange(item.id)}
                className={`relative flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl text-center transition ${
                  props.surface === item.id
                    ? 'bg-white/10 text-white'
                    : 'text-white/58 hover:bg-white/6 hover:text-white'
                }`}
              >
                <span className={`relative z-10 flex h-6 w-6 items-center justify-center rounded-lg text-sm font-semibold ${props.surface === item.id ? 'bg-white/10' : ''}`}>
                  {item.badge}
                </span>
                <span className="relative z-10 text-[10px] font-medium leading-3">{item.label}</span>
              </button>
            ))}
          </div>
        </nav>

        <div className="relative flex min-w-0 flex-1 overflow-hidden">
          <div className={`fixed inset-0 z-20 bg-black/28 transition xl:hidden ${props.sidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`} onClick={props.onSidebarClose} />
          <aside
            className={`absolute inset-y-0 left-0 z-30 w-[min(340px,calc(100vw-112px))] max-w-full border-r border-black/6 transition-transform xl:static xl:z-0 xl:w-80 xl:translate-x-0 ${
              props.sidebarOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            {props.sidebar}
          </aside>

          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <header className="shrink-0 border-b border-black/6 bg-white/70 px-4 py-4 backdrop-blur md:px-6 xl:px-8">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <button
                    type="button"
                    onClick={props.onSidebarOpen}
                    className="vfm-mobile-sidebar-button inline-flex h-12 items-center justify-center rounded-2xl border px-4 text-sm font-medium xl:hidden"
                  >
                    打开清单
                  </button>
                  <div className="min-w-0 max-w-2xl flex-1">
                    <div className="relative">
                      <input
                        value={props.intakeInput}
                        onChange={(event) => props.onIntakeInputChange(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            props.onIntakeSubmit();
                          }
                        }}
                        placeholder="粘贴 Bilibili 视频链接或博主主页..."
                        className="vfm-intake-input w-full rounded-2xl border px-5 py-3.5 pr-[150px] text-sm shadow-sm outline-none transition"
                      />
                      <div className="absolute right-2 top-2">
                        <button
                          type="button"
                          onClick={props.onIntakeSubmit}
                          disabled={!props.intakeInput.trim() || props.intakeBusy}
                          className="vfm-intake-submit inline-flex min-h-[40px] items-center justify-center rounded-xl px-5 text-sm font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {props.intakeBusy ? '处理中...' : `+ ${props.intakeActionLabel}`}
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--nimi-text-secondary)]">
                      <span>{props.headerFeedbackText || props.intakeHelperText}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-5 self-end xl:self-auto">
                  <div className="text-right">
                    <div className="text-2xl font-bold leading-none text-[var(--nimi-text-primary)]">{props.mappedVenueCount}</div>
                    <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--nimi-text-muted)]">已上图店铺</div>
                  </div>
                  <div className="h-8 w-px bg-black/8" />
                  <div className="text-right">
                    <div className="text-2xl font-bold leading-none text-[var(--nimi-action-primary-bg)]">{props.reviewCount}</div>
                    <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--nimi-text-muted)]">待确认</div>
                  </div>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-3 text-sm text-[var(--nimi-text-secondary)]">
                <span>{SURFACES.find((item) => item.id === props.surface)?.description}</span>
              </div>
            </header>

            <div className="flex-1 overflow-auto overflow-x-hidden px-4 py-6 md:px-6 xl:px-8 xl:py-8">
              {props.children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
