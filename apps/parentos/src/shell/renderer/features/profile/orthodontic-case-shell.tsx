/**
 * Case-level shell for the orthodontic surface. Replaces the legacy single
 * `OrthodonticTreatmentCard`: it owns the case-level chrome (the "正在并行 N
 * 件矫治器" header, the bottom 疗程总进度 strip, the ⋯ case menu, the
 * stage-advance dialog, the unknown-legacy banner, the no-appliance empty
 * state) and composes the per-appliance grid + the consolidated review card
 * in between. Per-appliance identity (name + start date) is owned by each
 * appliance card below, so the header strip carries only the parallel count
 * to avoid the duplicate-legend issue the parent flagged. Per-appliance
 * state lives in the cards; this shell never collapses the appliance set to
 * a single "primary" one (PO-ORTHO-003a).
 */
import { useEffect, useRef, useState } from 'react';
import { Button, IconButton, Surface } from '@nimiplatform/nimi-kit/ui';
import {
  deleteOrthodonticCase,
  type OrthodonticCaseRow,
  type OrthodonticStage,
} from '../../bridge/sqlite-bridge.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { computeStageOptions, stageLabel } from './orthodontic-derive.js';
import {
  blockedAdvanceReason,
  computeOverallProgressPct,
  DotsIcon,
  ProgressStrip,
} from './orthodontic-treatment-card-parts.js';
import {
  advanceOrthodonticStage,
  OrthodonticStageConfirmDialog,
} from './orthodontic-stage-confirm-dialog.js';
import {
  OrthodonticAppliancesGrid,
  type ApplianceGridItem,
} from './orthodontic-appliances-grid.js';
import { OrthodonticCaseReviewCard } from './orthodontic-case-review-card.js';
import type { ApplianceCardHandlers } from './appliance-card-shared.js';

export interface OrthodonticCaseShellHandlers extends ApplianceCardHandlers {
  onEditCase: () => void;
  onAddAppliance: () => void;
  onLogClinicalEvent: () => void;
  onCaseChanged: () => Promise<void>;
  onError: (msg: string | null) => void;
}

export function OrthodonticCaseShell({
  caseRow,
  items,
  childBirthDate,
  monthsElapsed,
  monthsTotal,
  nowIso,
  canAddAppliance,
  handlers,
}: {
  caseRow: OrthodonticCaseRow;
  /** Active appliances + per-appliance data, pre-sorted by priority. */
  items: ApplianceGridItem[];
  childBirthDate: string;
  monthsElapsed: number;
  monthsTotal: number | null;
  nowIso: string;
  canAddAppliance: boolean;
  handlers: OrthodonticCaseShellHandlers;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pendingStage, setPendingStage] = useState<{ stage: OrthodonticStage } | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [menuOpen]);

  const stageOptions = computeStageOptions(caseRow);
  const advanceTarget = stageOptions.find((o) => o.state === 'future' && o.advanceable);
  const overallProgressPct = computeOverallProgressPct({ caseRow, monthsTotal, nowIso });
  const isLegacy = caseRow.caseType === 'unknown-legacy';
  const appliances = items.map((i) => i.appliance);

  const handleDeleteCase = async () => {
    if (
      !window.confirm(
        '确定删除该疗程？相关矫治器、打卡、未戴记录都会级联删除，操作不可撤销。',
      )
    ) {
      return;
    }
    setMenuOpen(false);
    try {
      await deleteOrthodonticCase(caseRow.caseId);
      await handlers.onCaseChanged();
    } catch (error) {
      catchLog('ortho', 'action:delete-case-failed')(error);
      handlers.onError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── header strip: parallel-appliance count only. Per-appliance
          identity + start date live on each card below, so duplicating
          them here just clutters the chrome. ── */}
      {items.length > 0 && (
        <Surface
          tone="card"
          material="glass-regular"
          elevation="base"
          padding="none"
          className="flex items-center px-5 py-3"
        >
          <span className="text-[13px] text-[var(--nimi-text-muted)]">
            正在并行{' '}
            <strong className="font-bold text-[var(--nimi-text-primary)]">{items.length}</strong> 件矫治器
          </span>
        </Surface>
      )}

      {isLegacy && <UnknownLegacyBanner />}

      {items.length === 0 ? (
        <NoActiveApplianceCard canAdd={!isLegacy && canAddAppliance} onAdd={handlers.onAddAppliance} />
      ) : (
        <>
          <OrthodonticAppliancesGrid
            items={items}
            caseRow={caseRow}
            childBirthDate={childBirthDate}
            nowIso={nowIso}
            handlers={handlers}
          />
          <OrthodonticCaseReviewCard
            appliances={appliances}
            nowIso={nowIso}
            onLogClinicalEvent={handlers.onLogClinicalEvent}
          />
        </>
      )}

      {/* ── bottom: case-level 疗程总进度 strip + ⋯ menu ── */}
      <Surface
        as="section"
        material="glass-thick"
        padding="lg"
        tone="card"
      >
        <ProgressStrip
          progressPct={overallProgressPct}
          stage={caseRow.stage}
          monthsElapsed={monthsElapsed}
          monthsTotal={monthsTotal}
          trailingAction={
            <div ref={menuRef} style={{ position: 'relative' }}>
              <IconButton
                aria-label="疗程管理菜单"
                onClick={() => setMenuOpen((v) => !v)}
                tone="ghost"
                size="sm"
                className="text-[var(--nimi-text-muted)]"
                icon={<DotsIcon />}
              />
              {menuOpen && (
                <Surface
                  role="menu"
                  tone="overlay"
                  material="glass-regular"
                  elevation="floating"
                  padding="none"
                  className="absolute right-0 bottom-full z-10 mb-1.5 min-w-[220px] overflow-hidden py-1"
                  style={{
                    minWidth: 220,
                  }}
                >
                  <Button
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      handlers.onEditCase();
                    }}
                    tone="ghost"
                    size="sm"
                    fullWidth
                    className="justify-start rounded-none px-3 text-left text-[14px]"
                  >
                    编辑当前疗程
                  </Button>
                  {!isLegacy && canAddAppliance && (
                    <Button
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        handlers.onAddAppliance();
                      }}
                      tone="ghost"
                      size="sm"
                      fullWidth
                      className="justify-start rounded-none px-3 text-left text-[14px]"
                    >
                      添加矫治器
                    </Button>
                  )}
                  {advanceTarget ? (
                    <Button
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        setPendingStage({ stage: advanceTarget.stage });
                      }}
                      tone="ghost"
                      size="sm"
                      fullWidth
                      className="justify-start rounded-none px-3 text-left text-[14px]"
                    >
                      推进到「{stageLabel(advanceTarget.stage)}」
                    </Button>
                  ) : (
                    <Button
                      role="menuitem"
                      disabled
                      tone="ghost"
                      size="sm"
                      fullWidth
                      className="justify-start rounded-none px-3 text-left text-[14px] italic text-[var(--nimi-text-muted)]"
                      title={blockedAdvanceReason(stageOptions)}
                    >
                      没有可推进的下一阶段
                    </Button>
                  )}
                  <div className="my-0.5 border-t border-[var(--nimi-border-subtle)]" />
                  <Button
                    role="menuitem"
                    onClick={() => void handleDeleteCase()}
                    tone="danger"
                    size="sm"
                    fullWidth
                    className="justify-start rounded-none px-3 text-left text-[14px]"
                  >
                    删除当前疗程
                  </Button>
                </Surface>
              )}
            </div>
          }
        />
      </Surface>

      {pendingStage && (
        <OrthodonticStageConfirmDialog
          stage={pendingStage.stage}
          onCancel={() => setPendingStage(null)}
          onConfirm={() => {
            const next = pendingStage.stage;
            setPendingStage(null);
            void advanceOrthodonticStage({
              caseRow,
              nextStage: next,
              onError: handlers.onError,
              onAdvanced: handlers.onCaseChanged,
            });
          }}
        />
      )}
    </div>
  );
}

function UnknownLegacyBanner() {
  return (
    <Surface
      tone="card"
      material="glass-regular"
      elevation="base"
      padding="md"
      className="border-[var(--nimi-status-warning)]"
    >
      <div className="mb-1 text-[14px] font-semibold text-[var(--nimi-status-warning)]">
        待确认历史疗程
      </div>
      <p className="text-[13px] text-[var(--nimi-text-muted)]">
        该疗程由历史 ortho-start 记录回补生成。请在「⋯ 菜单 → 删除当前疗程」后新建一个正式疗程，或先把它改归类为正式类型再加矫治器（PO-ORTHO-002a）。
      </p>
    </Surface>
  );
}

function NoActiveApplianceCard({ canAdd, onAdd }: { canAdd: boolean; onAdd: () => void }) {
  return (
    <Surface
      tone="card"
      material="glass-regular"
      elevation="base"
      padding="lg"
    >
      <p className="m-0 text-[14px] text-[var(--nimi-text-muted)]">
        当前疗程还没有进行中的矫治器。添加矫治器后可以开始记录每日状态。
      </p>
      {canAdd && (
        <Button
          onClick={onAdd}
          tone="primary"
          size="md"
          className="mt-3"
        >
          添加矫治器
        </Button>
      )}
    </Surface>
  );
}
