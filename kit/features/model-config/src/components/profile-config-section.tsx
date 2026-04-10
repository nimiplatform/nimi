import { useState } from 'react';
import type { ModelConfigProfileController } from '../types.js';
import { DisabledConfigNote } from './config-section.js';

export function ProfileConfigSection(props: {
  controller: ModelConfigProfileController;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const { controller } = props;
  const currentSummary = controller.currentOrigin
    ? (controller.currentOrigin.title || controller.currentOrigin.profileId)
    : controller.copy.emptySummaryLabel;

  return (
    <>
      <div className="flex items-center justify-between rounded-xl border border-[var(--nimi-border-subtle,#e2e8f0)] bg-[var(--nimi-surface-canvas,#ffffff)] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-[11px] font-medium text-[var(--nimi-text-muted,#64748b)]">
            {controller.copy.summaryLabel}
          </span>
          <span className="truncate text-[11px] text-[var(--nimi-text-secondary,#475569)]">
            {currentSummary}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-[var(--nimi-action-primary-bg,#2563eb)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg,#2563eb)_8%,transparent)]"
            onClick={() => setModalOpen(true)}
          >
            {controller.currentOrigin ? controller.copy.changeButtonLabel : controller.copy.applyButtonLabel}
          </button>
          {controller.onManage ? (
            <button
              type="button"
              className="rounded-lg p-1 text-[var(--nimi-text-muted,#64748b)] transition-colors hover:bg-[var(--nimi-surface-card,#f8fafc)] hover:text-[var(--nimi-text-primary,#0f172a)]"
              title={controller.copy.manageButtonTitle}
              onClick={controller.onManage}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setModalOpen(false)}
          />
          <div className="relative z-10 mx-4 flex max-h-[70vh] w-full max-w-md flex-col rounded-2xl border border-[var(--nimi-border-subtle,#e2e8f0)] bg-white shadow-xl">
            <div className="shrink-0 border-b border-[var(--nimi-border-subtle,#e2e8f0)] px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--nimi-text-primary,#0f172a)]">
                    {controller.copy.modalTitle}
                  </h3>
                  <p className="mt-1 text-xs text-[var(--nimi-text-muted,#64748b)]">
                    {controller.copy.modalHint}
                  </p>
                </div>
                {controller.onReload && controller.copy.reloadLabel ? (
                  <button
                    type="button"
                    className="rounded-xl border border-[var(--nimi-border-subtle,#e2e8f0)] bg-white px-3 py-1.5 text-[11px] text-[var(--nimi-text-secondary,#475569)] transition-colors hover:bg-[var(--nimi-surface-card,#f8fafc)]"
                    onClick={controller.onReload}
                    disabled={controller.isReloading}
                  >
                    {controller.isReloading ? controller.copy.loadingLabel : controller.copy.reloadLabel}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-3">
              {controller.isLoading ? (
                <DisabledConfigNote label={controller.copy.loadingLabel} />
              ) : controller.error ? (
                <DisabledConfigNote label={controller.error} />
              ) : controller.profiles.length === 0 ? (
                <DisabledConfigNote label={controller.copy.emptyLabel} />
              ) : (
                <div className="space-y-2">
                  {controller.profiles.map((profile) => {
                    const isSelected = controller.selectedProfileId === profile.profileId;
                    const isCurrent = controller.currentOrigin?.profileId === profile.profileId;
                    return (
                      <button
                        key={profile.profileId}
                        type="button"
                        className={[
                          'w-full rounded-xl border px-3 py-3 text-left transition-colors',
                          isSelected
                            ? 'border-[var(--nimi-action-primary-bg,#2563eb)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg,#2563eb)_6%,transparent)]'
                            : 'border-[var(--nimi-border-subtle,#e2e8f0)] bg-white hover:border-[var(--nimi-border-strong,#cbd5e1)]',
                        ].join(' ')}
                        onClick={() => controller.onSelectedProfileChange(profile.profileId)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-[var(--nimi-text-primary,#0f172a)]">
                            {profile.title}
                          </span>
                          {isCurrent ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
                              {controller.copy.currentBadgeLabel}
                            </span>
                          ) : null}
                        </div>
                        {profile.description ? (
                          <p className="mt-0.5 line-clamp-2 text-xs text-[var(--nimi-text-muted,#64748b)]">
                            {profile.description}
                          </p>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="shrink-0 flex items-center justify-between border-t border-[var(--nimi-border-subtle,#e2e8f0)] px-5 py-3">
              <div />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-xl border border-[var(--nimi-border-subtle,#e2e8f0)] bg-white px-4 py-2 text-xs text-[var(--nimi-text-secondary,#475569)] transition-colors hover:bg-[var(--nimi-surface-card,#f8fafc)]"
                  onClick={() => setModalOpen(false)}
                >
                  {controller.copy.cancelLabel}
                </button>
                <button
                  type="button"
                  disabled={!controller.selectedProfileId || controller.applying}
                  className="rounded-xl bg-[var(--nimi-action-primary-bg,#2563eb)] px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  onClick={() => {
                    if (!controller.selectedProfileId) {
                      return;
                    }
                    controller.onApply(controller.selectedProfileId);
                  }}
                >
                  {controller.applying ? controller.copy.applyingLabel : controller.copy.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
