import { useEffect, useRef, useState } from 'react';
import type { ModelConfigProfileController, ModelConfigProfilePreview } from '../types.js';
import { DisabledConfigNote } from './config-section.js';

function ProfileOptionComposition(props: {
  profile: ModelConfigProfileController['profiles'][number];
}) {
  const summaries = props.profile.capabilitySummaries;
  return (
    <div className="mt-2 space-y-1.5">
      {summaries.map((summary) => (
        <div
          key={summary.capabilityId}
          data-nimi-ai-profile-capability={summary.capabilityId}
          className="rounded-lg bg-[var(--nimi-surface-card,#f8fafc)] px-2.5 py-2 text-[11px] text-[var(--nimi-text-secondary,#475569)]"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{summary.capabilityId}</span>
            {summary.modelLabel ? (
              <span className="truncate text-[var(--nimi-text-primary,#0f172a)]">{summary.modelLabel}</span>
            ) : null}
          </div>
          {summary.components.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-[var(--nimi-text-muted,#64748b)]">
              {summary.components.map((component) => (
                <span key={`${component.engineSlot}:${component.label}`}>
                  {component.role || component.engineSlot}: {component.label}
                </span>
              ))}
            </div>
          ) : null}
          {summary.parameterSummary.length > 0 ? (
            <div className="mt-1 text-[10px] text-[var(--nimi-text-muted,#64748b)]">
              {summary.parameterSummary.join(' · ')}
            </div>
          ) : null}
        </div>
      ))}
      {props.profile.setupRequired ? (
        <div
          data-nimi-ai-profile-setup-required="true"
          className="text-[10px] font-medium text-amber-700"
        >
          Selection hint · setup required
        </div>
      ) : null}
    </div>
  );
}

function ProfilePreviewView(props: {
  controller: ModelConfigProfileController;
  preview: ModelConfigProfilePreview;
}) {
  const { controller, preview } = props;
  const { copy } = controller;
  return (
    <>
      <div className="flex-1 overflow-y-auto px-5 py-3">
        <p className="mb-3 text-xs text-[var(--nimi-text-muted,#64748b)]">
          {copy.previewHint}
        </p>
        {preview.isFirstApply ? (
          <div className="mb-3 rounded-xl border border-mint-200 bg-mint-50/60 px-3 py-2 text-xs text-mint-700">
            {copy.previewFirstApplyLabel}
          </div>
        ) : null}
        {preview.identical ? (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-700">
            {copy.previewNoChangeLabel}
          </div>
        ) : (
          <div className="space-y-2">
            {preview.rows.map((row) => (
              <div
                key={row.path}
                className="rounded-xl border border-[var(--nimi-border-subtle,#e2e8f0)] bg-white px-3 py-2"
              >
                <div className="mb-1 font-mono text-[11px] text-[var(--nimi-text-secondary,#475569)]">
                  {row.path}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="mb-0.5 text-[10px] uppercase tracking-wide text-[var(--nimi-text-muted,#64748b)]">
                      {copy.previewBeforeLabel}
                    </div>
                    <div className="break-words font-mono text-[var(--nimi-text-primary,#0f172a)]">
                      {row.beforeText}
                    </div>
                  </div>
                  <div>
                    <div className="mb-0.5 text-[10px] uppercase tracking-wide text-[var(--nimi-text-muted,#64748b)]">
                      {copy.previewAfterLabel}
                    </div>
                    <div className="break-words font-mono text-[var(--nimi-text-primary,#0f172a)]">
                      {row.afterText}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {preview.probeWarnings.length > 0 ? (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
              {copy.previewWarningsLabel}
            </div>
            <ul className="list-disc space-y-0.5 pl-4 text-xs text-amber-700">
              {preview.probeWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {controller.error ? (
          <div className="mt-3">
            <DisabledConfigNote label={controller.error} />
          </div>
        ) : null}
      </div>

      <div className="shrink-0 flex items-center justify-between border-t border-[var(--nimi-border-subtle,#e2e8f0)] px-5 py-3">
        <div />
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-xl border border-[var(--nimi-border-subtle,#e2e8f0)] bg-white px-4 py-2 text-xs text-[var(--nimi-text-secondary,#475569)] transition-colors hover:bg-[var(--nimi-surface-card,#f8fafc)]"
            onClick={controller.onCancelPreview}
            disabled={controller.applying}
          >
            {copy.previewBackLabel}
          </button>
          <button
            type="button"
            disabled={controller.applying}
            className="rounded-xl bg-[var(--nimi-action-primary-bg,#2563eb)] px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            onClick={controller.onConfirmApply}
          >
            {controller.applying ? copy.applyingLabel : copy.previewConfirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}

export function ProfileConfigSection(props: {
  controller: ModelConfigProfileController;
  variant?: 'card' | 'import-button';
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const commitInFlightRef = useRef(false);
  const { controller } = props;
  const variant = props.variant ?? 'card';

  // The modal closes once a confirmed commit completes without error.
  useEffect(() => {
    if (commitInFlightRef.current && !controller.applying) {
      commitInFlightRef.current = false;
      if (!controller.error && !controller.preview) {
        setModalOpen(false);
      }
    }
  }, [controller.applying, controller.error, controller.preview]);

  const currentSummary = controller.currentOrigin
    ? (controller.currentOrigin.title || controller.currentOrigin.profileId)
    : controller.copy.emptySummaryLabel;

  const inPreview = Boolean(controller.preview);
  const selectedProfile = controller.profiles.find(
    (profile) => profile.profileId === controller.selectedProfileId,
  ) ?? null;
  const selectedProfileNeedsSetup = selectedProfile?.setupRequired === true;

  return (
    <>
      {variant === 'import-button' ? (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="group flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-2.5 text-sm font-medium text-slate-600 transition-all duration-200 hover:border-mint-400 hover:bg-mint-50/60 hover:text-mint-700"
        >
          <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V4" />
          </svg>
          <span className="truncate">
            {controller.copy.importLabel || controller.copy.summaryLabel}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="group relative w-full cursor-pointer overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 text-left transition-all duration-200 hover:border-mint-500 hover:shadow-md"
        >
          {/* Left accent line */}
          <div className="absolute left-0 top-0 h-full w-1 bg-mint-500" />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {/* Avatar / icon */}
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-mint-100 bg-mint-50 shadow-sm">
                <span className="text-2xl leading-none" role="img" aria-label="robot">🤖</span>
              </div>

              {/* Identity text */}
              <div className="min-w-0">
                <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  {controller.copy.summaryLabel}
                </div>
                <div className="flex items-center gap-2 text-lg font-bold text-slate-900">
                  <span className="truncate">{currentSummary}</span>
                  {/* Breathing dot */}
                  {controller.currentOrigin ? (
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint-500 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-mint-500" />
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Chevron down */}
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-50 text-slate-400 transition-colors group-hover:bg-mint-50 group-hover:text-mint-500">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        </button>
      )}

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => {
              if (controller.preview) {
                controller.onCancelPreview();
              }
              setModalOpen(false);
            }}
          />
          <div className="relative z-10 mx-4 flex max-h-[70vh] w-full max-w-md flex-col rounded-2xl border border-[var(--nimi-border-subtle,#e2e8f0)] bg-white shadow-xl">
            <div className="shrink-0 border-b border-[var(--nimi-border-subtle,#e2e8f0)] px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--nimi-text-primary,#0f172a)]">
                    {inPreview ? controller.copy.previewTitle : controller.copy.modalTitle}
                  </h3>
                  <p className="mt-1 text-xs text-[var(--nimi-text-muted,#64748b)]">
                    {inPreview ? controller.copy.previewHint : controller.copy.modalHint}
                  </p>
                </div>
                {!inPreview ? (
                  <div className="flex items-center gap-2">
                    {controller.onManage ? (
                      <button
                        type="button"
                        className="rounded-xl border border-[var(--nimi-border-subtle,#e2e8f0)] bg-white px-3 py-1.5 text-[11px] text-[var(--nimi-text-secondary,#475569)] transition-colors hover:bg-[var(--nimi-surface-card,#f8fafc)]"
                        onClick={controller.onManage}
                      >
                        {controller.copy.manageButtonTitle}
                      </button>
                    ) : null}
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
                ) : null}
              </div>
            </div>

            {controller.preview ? (
              <ProfilePreviewView controller={controller} preview={controller.preview} />
            ) : (
              <>
                <div className="flex-1 overflow-y-auto px-5 py-3">
                  {controller.isLoading ? (
                    <DisabledConfigNote label={controller.copy.loadingLabel} />
                  ) : controller.previewing ? (
                    <DisabledConfigNote label={controller.copy.previewingLabel} />
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
                            <ProfileOptionComposition profile={profile} />
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
                      disabled={!controller.selectedProfileId || controller.previewing || selectedProfileNeedsSetup}
                      className="rounded-xl bg-[var(--nimi-action-primary-bg,#2563eb)] px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                      onClick={() => {
                        if (!controller.selectedProfileId) {
                          return;
                        }
                        if (selectedProfileNeedsSetup) {
                          return;
                        }
                        // Step 1: preview only. The commit happens after the
                        // user confirms the surfaced diff (D-AIPC-014).
                        commitInFlightRef.current = true;
                        controller.onApply(controller.selectedProfileId);
                      }}
                    >
                      {controller.previewing ? controller.copy.previewingLabel : controller.copy.confirmLabel}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
