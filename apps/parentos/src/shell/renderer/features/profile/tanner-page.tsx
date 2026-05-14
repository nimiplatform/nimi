import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonths, computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { insertTannerAssessment, getTannerAssessments, getMeasurements, insertMeasurement } from '../../bridge/sqlite-bridge.js';
import type { TannerAssessmentRow, MeasurementRow } from '../../bridge/sqlite-bridge.js';
import { ulid, isoNow } from '../../bridge/ulid.js';
import { AISummaryCard } from './ai-summary-card.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { TannerAssessmentForm } from './tanner-assessment-form.js';
import { TannerGuidePanel } from './tanner-guide-panel.js';
import { TannerOverviewCards } from './tanner-overview-cards.js';
import { TannerTimeline } from './tanner-timeline.js';
import {
  BREAST_STAGES,
  GENITAL_STAGES,
  sortAssessmentsDesc,
} from './tanner-page-shared.js';

export default function TannerPage() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [assessments, setAssessments] = useState<TannerAssessmentRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  const [boneAgeMeasurements, setBoneAgeMeasurements] = useState<MeasurementRow[]>([]);
  const [bodyFatMeasurements, setBodyFatMeasurements] = useState<MeasurementRow[]>([]);

  const [formAssessedAt, setFormAssessedAt] = useState(new Date().toISOString().slice(0, 10));
  const [formBG, setFormBG] = useState(1);
  const [formPH, setFormPH] = useState(1);
  const [formAssessedBy, setFormAssessedBy] = useState('parent');
  const [formNotes, setFormNotes] = useState('');
  const [formBoneAge, setFormBoneAge] = useState('');
  const [formBodyFat, setFormBodyFat] = useState('');

  const loadAll = async (cid: string) => {
    const [ta, ms] = await Promise.all([getTannerAssessments(cid), getMeasurements(cid)]);
    setAssessments(ta);
    setBoneAgeMeasurements(ms.filter((m) => m.typeId === 'bone-age'));
    setBodyFatMeasurements(ms.filter((m) => m.typeId === 'body-fat-percentage'));
  };

  useEffect(() => {
    if (activeChildId) loadAll(activeChildId).catch(catchLog('tanner', 'action:load-tanner-data-failed'));
  }, [activeChildId]);

  if (!child) return <div className="p-8 text-[var(--nimi-text-muted)]">请先添加孩子</div>;

  const ageMonths = computeAgeMonths(child.birthDate);
  const isFemale = child.gender === 'female';
  const bgLabel = isFemale ? '乳房发育 (B期)' : '外生殖器发育 (G期)';
  const bgStages = isFemale ? BREAST_STAGES : GENITAL_STAGES;

  const sorted = sortAssessmentsDesc(assessments);

  const resetForm = () => {
    setFormAssessedAt(new Date().toISOString().slice(0, 10));
    setFormBG(1); setFormPH(1); setFormAssessedBy('parent'); setFormNotes('');
    setFormBoneAge(''); setFormBodyFat(''); setShowForm(false);
  };

  const handleSubmit = async () => {
    if (!formAssessedAt || formBG < 1 || formBG > 5 || formPH < 1 || formPH > 5) return;
    const now = isoNow();
    const am = computeAgeMonthsAt(child.birthDate, formAssessedAt);
    try {
      await insertTannerAssessment({
        assessmentId: ulid(), childId: child.childId, assessedAt: formAssessedAt,
        ageMonths: am, breastOrGenitalStage: formBG, pubicHairStage: formPH,
        assessedBy: formAssessedBy || null, notes: formNotes || null, now,
      });
      // Save bone age as measurement if provided
      if (formBoneAge.trim()) {
        await insertMeasurement({
          measurementId: ulid(), childId: child.childId, typeId: 'bone-age',
          value: parseFloat(formBoneAge), measuredAt: formAssessedAt,
          ageMonths: am, percentile: null, source: 'manual', notes: null, now,
        });
      }
      // Save body fat as measurement if provided
      if (formBodyFat.trim()) {
        await insertMeasurement({
          measurementId: ulid(), childId: child.childId, typeId: 'body-fat-percentage',
          value: parseFloat(formBodyFat), measuredAt: formAssessedAt,
          ageMonths: am, percentile: null, source: 'manual', notes: null, now,
        });
      }
      await loadAll(child.childId);
      resetForm();
    } catch { /* bridge */ }
  };

  return (
    <div className="mx-auto min-h-full max-w-3xl px-6 pb-6 pt-[72px]">
      <div className="flex items-center gap-2 mb-5">
        <Link to="/profile" className="text-[14px] hover:underline text-[var(--nimi-text-muted)]">← 返回档案</Link>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-[var(--nimi-text-primary)]">青春期发育评估</h1>
          {/* Info tooltip */}
          <div className="group relative">
            <div className="flex h-[18px] w-[18px] cursor-help items-center justify-center rounded-full text-[var(--nimi-text-muted)] hover:bg-[var(--nimi-action-ghost-hover)]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </div>
            <div className="pointer-events-none absolute left-0 top-7 z-50 w-[320px] rounded-xl bg-[var(--nimi-surface-overlay)] p-4 text-[13px] leading-relaxed text-[var(--nimi-text-secondary)] opacity-0 shadow-[var(--nimi-elevation-floating)] transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100">
              <p className="mb-2 text-[14px] font-semibold text-[var(--nimi-text-primary)]">参考标准</p>
              <ul className="space-y-2">
                <li>
                  <span className="font-medium text-[var(--nimi-action-primary-bg)]">Tanner 分期标准</span>
                  <span className="mt-0.5 block text-[12px] text-[var(--nimi-text-muted)]">Marshall WA, Tanner JM. Variations in pattern of pubertal changes in girls/boys.</span>
                  <span className="block text-[12px] text-[var(--nimi-text-muted)]">Arch Dis Child 1969;44:291-303 / 1970;45:13-23</span>
                </li>
                <li>
                  <span className="font-medium text-[var(--nimi-action-primary-bg)]">中国儿童青春期参考</span>
                  <span className="mt-0.5 block text-[12px] text-[var(--nimi-text-muted)]">中华医学会儿科学分会内分泌遗传代谢学组. 中枢性性早熟诊断与治疗专家共识（2022）</span>
                </li>
              </ul>
              <p className="mt-2 border-t border-[color-mix(in_srgb,var(--nimi-border-subtle)_70%,transparent)] pt-2 text-[12px] text-[var(--nimi-text-muted)]">女孩 B2 通常 8-13 岁出现 · 男孩 G2 通常 9-14 岁出现</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowGuide(!showGuide)}
            className={`flex items-center gap-1 rounded-2xl px-3 py-1.5 text-[13px] font-medium transition-all ${showGuide ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]' : 'bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-muted)]'}`}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            评估指引
          </button>
          {!showForm && (
            <Button onClick={() => setShowForm(true)} tone="primary" size="sm" className="rounded-2xl">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              添加评估
            </Button>
          )}
        </div>
      </div>
      <div className="mb-4">
        <p className="text-[13px] text-[var(--nimi-text-muted)]">{isFemale ? '女孩' : '男孩'} · 共 {assessments.length} 次评估</p>
      </div>

      <TannerOverviewCards
        boneAgeMeasurements={boneAgeMeasurements}
        bodyFatMeasurements={bodyFatMeasurements}
        ageMonths={ageMonths}
      />

      {/* ── Guide ────────────────────────────────────────── */}
      {showGuide && (
        <Surface tone="card" material="glass-regular" elevation="raised" padding="none" className="mb-5 overflow-hidden rounded-3xl">
          <div className="bg-[linear-gradient(135deg,var(--nimi-status-info),var(--nimi-action-primary-bg))] px-5 py-4">
            <h3 className="mb-1 text-[16px] font-bold text-[var(--nimi-action-primary-text)]">什么是 Tanner 分期？</h3>
            <p className="text-[13px] text-[color-mix(in_srgb,var(--nimi-action-primary-text)_70%,transparent)]">Tanner 分期是国际通用的青春期发育评估标准，将{isFemale ? '乳房' : '外生殖器'}和阴毛发育各分为 5 期。</p>
          </div>
          <div className="space-y-4 bg-[var(--nimi-surface-card)] p-5">
            <div>
              <h4 className="text-[14px] font-semibold mb-1 text-[var(--nimi-text-primary)]">如何判断？</h4>
              <p className="text-[13px] leading-relaxed text-[var(--nimi-text-muted)]">
                {isFemale
                  ? '观察乳房的大小、形态和乳晕变化。B1 期是青春前期没有任何发育，B2 期（花蕾期）是乳头下方出现小硬块，这是青春期的第一个信号。如果 8 岁前出现 B2 需警惕性早熟。'
                  : '观察睾丸大小和阴茎长度变化。G1 期是青春前期，G2 期是睾丸开始增大（通常用睾丸容积仪测量>4ml）。如果 9 岁前出现 G2 需警惕性早熟。'}
              </p>
            </div>
            <div>
              <h4 className="text-[14px] font-semibold mb-1 text-[var(--nimi-text-primary)]">正常发育时间参考</h4>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3">
                  <p className="text-[13px] font-semibold text-[var(--nimi-text-primary)]">{isFemale ? '乳房发育 B2 出现' : '睾丸增大 G2 出现'}</p>
                  <p className="text-[12px] text-[var(--nimi-text-muted)]">{isFemale ? '正常: 8-13 岁 · 平均 10.5 岁' : '正常: 9-14 岁 · 平均 11.5 岁'}</p>
                  <p className="text-[12px] mt-1 text-[var(--nimi-status-danger)]">{isFemale ? '<8 岁出现需排查性早熟' : '<9 岁出现需排查性早熟'}</p>
                </div>
                <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3">
                  <p className="text-[13px] font-semibold text-[var(--nimi-text-primary)]">阴毛 PH2 出现</p>
                  <p className="text-[12px] text-[var(--nimi-text-muted)]">{isFemale ? '通常在 B2 后 6-12 个月出现' : '通常与 G2 同时或稍后出现'}</p>
                  <p className="text-[12px] mt-1 text-[var(--nimi-text-muted)]">单纯阴毛早现可能为肾上腺功能早现</p>
                </div>
              </div>
            </div>
            <div>
              <h4 className="text-[14px] font-semibold mb-1 text-[var(--nimi-text-primary)]">何时需要就医？</h4>
              <ul className="text-[13px] leading-relaxed space-y-0.5 text-[var(--nimi-text-muted)]">
                <li>• {isFemale ? '8 岁前出现乳房发育（B2）' : '9 岁前出现睾丸增大（G2）'}——可能是性早熟</li>
                <li>• {isFemale ? '13 岁仍无任何发育迹象' : '14 岁仍无任何发育迹象'}——可能是青春期延迟</li>
                <li>• 发育进展过快（1年内跨越2个分期）或伴随身高增长加速</li>
                <li>• 建议配合骨龄检查评估发育进程</li>
              </ul>
            </div>
          </div>
          <div className="flex justify-end border-t border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-5 py-3">
            <Button onClick={() => setShowGuide(false)} tone="primary" size="sm" className="rounded-2xl">我知道了</Button>
          </div>
        </Surface>
      )}

      <AISummaryCard domain="tanner" childName={child.displayName} childId={child.childId}
        ageLabel={`${Math.floor(ageMonths / 12)}岁${ageMonths % 12}个月`} gender={child.gender}
        dataContext={assessments.length > 0 ? `共 ${assessments.length} 次评估` : ''} />

      {showForm && (
        <TannerAssessmentForm
          bgLabel={bgLabel}
          bgStages={bgStages}
          formAssessedAt={formAssessedAt}
          setFormAssessedAt={setFormAssessedAt}
          formBG={formBG}
          setFormBG={setFormBG}
          formPH={formPH}
          setFormPH={setFormPH}
          formAssessedBy={formAssessedBy}
          setFormAssessedBy={setFormAssessedBy}
          formNotes={formNotes}
          setFormNotes={setFormNotes}
          formBoneAge={formBoneAge}
          setFormBoneAge={setFormBoneAge}
          formBodyFat={formBodyFat}
          setFormBodyFat={setFormBodyFat}
          onClose={resetForm}
          onSave={() => void handleSubmit()}
        />
      )}

      <TannerGuidePanel
        isFemale={isFemale}
        latestBG={sorted[0]?.breastOrGenitalStage ?? null}
        latestPH={sorted[0]?.pubicHairStage ?? null}
        childName={child.displayName}
        ageLabel={`${Math.floor(ageMonths / 12)}岁${ageMonths % 12 > 0 ? `${ageMonths % 12}月` : ''}`}
        gender={child.gender}
      />

      <h2 className="text-[14px] font-semibold mb-3 mt-6 text-[var(--nimi-text-primary)]">
        {sorted.length > 0 ? `评估记录（${sorted.length} 次）` : '暂无评估记录'}
      </h2>
      <TannerTimeline assessments={sorted} bgStages={bgStages} isFemale={isFemale} showForm={showForm} />
    </div>
  );
}
