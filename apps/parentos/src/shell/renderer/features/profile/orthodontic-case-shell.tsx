/**
 * Case-level shell for the orthodontic surface. Replaces the legacy single
 * `OrthodonticTreatmentCard`: it owns the case-level chrome (the "正在并行 N
 * 件矫治器" header + identity legend, the bottom 疗程总进度 strip, the ⋯ case
 * menu, the stage-advance dialog, the unknown-legacy banner, the no-appliance
 * empty state) and composes the per-appliance grid + the consolidated review
 * card in between. Per-appliance state lives in the cards; this shell never
 * collapses the appliance set to a single "primary" one (PO-ORTHO-003a).
 */
import { useEffect, useRef, useState } from 'react';
import { Surface } from '@nimiplatform/nimi-kit/ui';
import {
  deleteOrthodonticCase,
  type OrthodonticCaseRow,
  type OrthodonticStage,
} from '../../bridge/sqlite-bridge.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { S } from '../../app-shell/page-style.js';
import { applianceIdentity } from './appliance-identity.js';
import { applianceTypeLabel, computeStageOptions, stageLabel } from './orthodontic-derive.js';
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
      {/* ── header strip: parallel-appliance count + identity legend ── */}
      {items.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '12px 20px',
            borderRadius: 16,
            background: '#ffffff',
            boxShadow: '0 1px 3px rgba(15,23,42,0.05)',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 13, color: S.sub }}>
            正在并行{' '}
            <strong style={{ color: S.text, fontWeight: 700 }}>{items.length}</strong> 件矫治器
          </span>
          <div
            style={{
              marginLeft: 'auto',
              display: 'flex',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            {appliances.map((appliance) => {
              const identity = applianceIdentity(appliance.applianceType);
              return (
                <span
                  key={appliance.applianceId}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      background: identity.solid,
                    }}
                  />
                  <span style={{ color: S.text, fontWeight: 600 }}>
                    {applianceTypeLabel(appliance.applianceType)}
                  </span>
                  <span style={{ color: S.sub, fontFamily: 'var(--nimi-font-mono)' }}>
                    起 {appliance.startedAt.slice(5)}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
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
        padding="none"
        tone="card"
        className="rounded-[24px]"
        style={{ background: '#ffffff', padding: '20px 28px 24px' }}
      >
        <ProgressStrip
          progressPct={overallProgressPct}
          stage={caseRow.stage}
          monthsElapsed={monthsElapsed}
          monthsTotal={monthsTotal}
          trailingAction={
            <div ref={menuRef} style={{ position: 'relative' }}>
              <button
                type="button"
                aria-label="疗程管理菜单"
                onClick={() => setMenuOpen((v) => !v)}
                className="rounded-full p-1.5 transition-colors hover:bg-slate-100"
                style={{
                  background: 'transparent',
                  border: 0,
                  cursor: 'pointer',
                  color: 'var(--nimi-text-muted)',
                  display: 'inline-grid',
                  placeItems: 'center',
                }}
              >
                <DotsIcon />
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 rounded-xl py-1 min-w-[220px]"
                  style={{
                    bottom: '100%',
                    marginBottom: 6,
                    background: '#ffffff',
                    border: '1px solid rgba(226,232,240,0.8)',
                    boxShadow: '0 -12px 32px rgba(15,23,42,0.12)',
                    zIndex: 5,
                  }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      handlers.onEditCase();
                    }}
                    className="w-full text-left text-[14px] px-3 py-2 hover:bg-slate-50"
                    style={{ background: 'transparent', border: 0, color: S.text, cursor: 'pointer' }}
                  >
                    编辑当前疗程
                  </button>
                  {!isLegacy && canAddAppliance && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        handlers.onAddAppliance();
                      }}
                      className="w-full text-left text-[14px] px-3 py-2 hover:bg-slate-50"
                      style={{ background: 'transparent', border: 0, color: S.text, cursor: 'pointer' }}
                    >
                      添加矫治器
                    </button>
                  )}
                  {advanceTarget ? (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        setPendingStage({ stage: advanceTarget.stage });
                      }}
                      className="w-full text-left text-[14px] px-3 py-2 hover:bg-slate-50"
                      style={{ background: 'transparent', border: 0, color: S.text, cursor: 'pointer' }}
                    >
                      推进到「{stageLabel(advanceTarget.stage)}」
                    </button>
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      disabled
                      className="w-full text-left text-[14px] px-3 py-2"
                      style={{
                        background: 'transparent',
                        border: 0,
                        color: 'var(--nimi-text-muted)',
                        cursor: 'not-allowed',
                        fontStyle: 'italic',
                      }}
                      title={blockedAdvanceReason(stageOptions)}
                    >
                      没有可推进的下一阶段
                    </button>
                  )}
                  <div
                    style={{ borderTop: '1px solid rgba(226,232,240,0.6)', margin: '2px 0' }}
                  />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void handleDeleteCase()}
                    className="w-full text-left text-[14px] px-3 py-2 hover:bg-rose-50"
                    style={{ background: 'transparent', border: 0, color: '#b91c1c', cursor: 'pointer' }}
                  >
                    删除当前疗程
                  </button>
                </div>
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
    <div
      className="p-4 rounded-2xl"
      style={{
        background: 'rgba(245,158,11,0.08)',
        border: '1px solid rgba(245,158,11,0.3)',
      }}
    >
      <div className="text-[14px] font-semibold mb-1" style={{ color: '#b45309' }}>
        待确认历史疗程
      </div>
      <p className="text-[13px]" style={{ color: S.sub }}>
        该疗程由历史 ortho-start 记录回补生成。请在「⋯ 菜单 → 删除当前疗程」后新建一个正式疗程，或先把它改归类为正式类型再加矫治器（PO-ORTHO-002a）。
      </p>
    </div>
  );
}

function NoActiveApplianceCard({ canAdd, onAdd }: { canAdd: boolean; onAdd: () => void }) {
  return (
    <div
      className="rounded-2xl p-6"
      style={{ background: '#ffffff', boxShadow: '0 1px 4px rgba(15,23,42,0.06)' }}
    >
      <p className="text-[14px]" style={{ color: S.sub, margin: 0 }}>
        当前疗程还没有进行中的矫治器。添加矫治器后可以开始记录每日状态。
      </p>
      {canAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="mt-3 text-[14px] font-semibold px-4 py-2 rounded-full"
          style={{ background: S.accent, color: '#fff', border: 0, cursor: 'pointer' }}
        >
          添加矫治器
        </button>
      )}
    </div>
  );
}
