import { Button, IconButton, Surface } from '@nimiplatform/nimi-kit/ui';
import { useState } from 'react';

/* ================================================================
   VISION GUIDE — interactive step-by-step tutorial
   ================================================================ */

const GUIDE_STEPS = [
  {
    title: '了解验光检查',
    sections: [
      {
        heading: '什么是验光？',
        body: '验光就是检查眼睛的屈光状态：是近视、远视、散光还是正视。医院通常会出具一张验光单。',
      },
      {
        heading: '两种瞳孔状态',
        items: [
          { label: '小瞳验光', desc: '自然状态下验光，不滴散瞳药水。日常复查常用，速度快但可能受调节力影响。', tag: '常规' },
          { label: '散瞳验光', desc: '滴麻痹睫状肌的药水后验光，排除假性近视。首次配镜或青少年建议散瞳验光。', tag: '更准确' },
        ],
      },
      {
        heading: '两种验光方法',
        items: [
          { label: '电脑验光', desc: '通过电脑验光仪自动测量，结果以小票打印。球镜标注 S 或 SPH，柱镜标注 C 或 CYL。速度快但仅供参考。', tag: '快速筛查' },
          { label: '综合验光', desc: '医生通过综合验光仪（插片法）逐步调整镜片，依赖受检者识别视标。也叫主觉验光。球镜标注 DS，柱镜标注 DC。结果更准确，用于配镜处方。', tag: '配镜依据' },
        ],
      },
    ],
  },
  {
    title: '看懂验光单',
    sections: [
      {
        heading: '验光单上的字段',
        table: [
          { field: '球镜 S / SPH / DS', meaning: '近视或远视度数', note: '负值 = 近视，正值 = 远视。如 -1.25 表示近视 125 度' },
          { field: '柱镜 C / CYL / DC', meaning: '散光度数', note: '通常为负值。如 -0.75 表示散光 75 度。无散光时为 0 或不写' },
          { field: '轴位 AX / AXIS', meaning: '散光方向', note: '0-180° 之间的角度。只有有散光时才有意义' },
          { field: '矫正视力 VA', meaning: '戴镜后的视力', note: '如 → 1.0 表示矫正后能看到 1.0' },
          { field: '瞳距 PD', meaning: '两眼瞳孔间距', note: '配镜时需要，本 APP 暂不记录' },
        ],
      },
      {
        heading: 'OD 和 OS 是什么？',
        body: 'OD = 右眼 (拉丁文 Oculus Dexter)，OS = 左眼 (Oculus Sinister)。有些单子用 R (Right) 和 L (Left)。录入时请注意区分左右眼。',
      },
      {
        heading: '常见格式示例',
        examples: [
          { raw: 'OD  -1.25DS / -0.75DC × 80 → 1.0', parsed: '右眼 近视125度 / 散光75度 轴位80° 矫正视力1.0' },
          { raw: 'R  -1.25 / -0.75 × 80', parsed: '无DS DC标注，同上含义' },
          { raw: 'R  PL → 1.0', parsed: '平光 PL = 球镜和柱镜都为 0，录入时都填 0' },
          { raw: 'R  0.6  -1.25DS / -0.75DC × 80 → 1.0', parsed: '第一个数 0.6 是裸眼视力' },
        ],
      },
    ],
  },
  {
    title: '看懂眼轴单',
    sections: [
      {
        heading: '什么是眼轴检查？',
        body: '眼轴长度 (AL) 是从角膜到眼底的距离，是预测近视进展的核心指标。每增长 1mm 眼轴，约等于增加 300 度近视。比视力表检查更有预测价值。',
      },
      {
        heading: '眼轴单上的字段',
        table: [
          { field: 'AL 眼轴长', meaning: '角膜到眼底的长度', note: '正常成人约 24mm。儿童应低于同龄均值。超过临界值需高度关注' },
          { field: 'K1 / R1', meaning: '角膜平坦子午线曲率', note: '正常约 42-44D' },
          { field: 'K2 / R2', meaning: '角膜陡峭子午线曲率', note: '正常约 43-45D。K1 和 K2 差值反映角膜散光' },
          { field: 'AD / ACD', meaning: '前房深度', note: '角膜到晶状体前表面的距离，正常约 2.5-4.0mm' },
          { field: 'LT', meaning: '晶体厚度', note: '眼内晶状体的厚度，正常约 3.5-4.5mm' },
          { field: 'AL/CR', meaning: '眼轴/角膜曲率比', note: '> 3 可能提示近视风险增加' },
        ],
      },
      {
        heading: '眼轴余量',
        body: '眼轴余量 = 同龄同性别眼轴临界值 - 孩子当前眼轴。余量越小，近视风险越高。每次检查关注眼轴增长速度比绝对值更重要。每半年增长超过 0.3mm 需要注意。',
      },
    ],
  },
];

export function VisionGuide({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const current = GUIDE_STEPS[step];
  if (!current) return null;

  return (
    <Surface tone="card" elevation="raised" padding="none" className="mb-5 overflow-hidden rounded-3xl">
      {/* Step header */}
      <div className="bg-[image:var(--nimi-surface-hero)] px-5 py-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[12px] text-white/60">验光单录入指引</span>
          <IconButton
            aria-label="关闭验光单录入指引"
            icon="✕"
            onClick={onClose}
            size="sm"
            tone="ghost"
            className="h-6 min-h-6 w-6 border-transparent text-white/60 hover:bg-white/10 hover:text-white"
          />
        </div>
        <h3 className="text-[16px] font-bold text-white mb-3">{current.title}</h3>
        {/* Step indicators */}
        <div className="flex items-center gap-1">
          {GUIDE_STEPS.map((_, i) => (
            <button key={i} onClick={() => setStep(i)}
              className={`h-[6px] rounded-full transition-all ${i === step ? 'w-6 bg-white' : 'w-[6px] bg-white/30 hover:bg-white/50'}`} />
          ))}
          <span className="text-[12px] text-white/50 ml-2">{step + 1}/{GUIDE_STEPS.length}</span>
        </div>
      </div>

      {/* Content */}
      <div className="space-y-5 bg-[var(--nimi-surface-card)] p-5">
        {current.sections.map((sec, si) => (
          <div key={si}>
            <h4 className="text-[14px] font-semibold mb-2 text-[var(--nimi-text-primary)]">{sec.heading}</h4>

            {'body' in sec && sec.body && (
              <p className="text-[14px] leading-relaxed text-[var(--nimi-text-muted)]">{sec.body}</p>
            )}

            {'items' in sec && sec.items && (
              <div className="space-y-2">
                {sec.items.map((item, ii) => (
                  <div key={ii} className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[14px] font-semibold text-[var(--nimi-text-primary)]">{item.label}</span>
                      <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] px-1.5 py-0.5 text-[12px] text-[var(--nimi-action-primary-bg)]">{item.tag}</span>
                    </div>
                    <p className="text-[13px] leading-relaxed text-[var(--nimi-text-muted)]">{item.desc}</p>
                  </div>
                ))}
              </div>
            )}

            {'table' in sec && sec.table && (
              <div className="overflow-hidden rounded-2xl border border-[var(--nimi-border-subtle)]">
                <div className="grid grid-cols-[1.2fr_1fr_1.5fr] bg-[var(--nimi-surface-panel)] px-3 py-2 text-[12px] font-medium text-[var(--nimi-text-muted)]">
                  <span>字段</span><span>含义</span><span>说明</span>
                </div>
                {sec.table.map((row, ri) => (
                  <div
                    key={ri}
                    className={`grid grid-cols-[1.2fr_1fr_1.5fr] border-t border-[var(--nimi-border-subtle)] px-3 py-2 text-[13px] ${ri % 2 === 0 ? 'bg-[var(--nimi-surface-card)]' : 'bg-[var(--nimi-surface-panel)]'}`}
                  >
                    <span className="font-semibold text-[var(--nimi-action-primary-bg)]">{row.field}</span>
                    <span className="text-[var(--nimi-text-primary)]">{row.meaning}</span>
                    <span className="text-[var(--nimi-text-muted)]">{row.note}</span>
                  </div>
                ))}
              </div>
            )}

            {'examples' in sec && sec.examples && (
              <div className="space-y-2">
                {sec.examples.map((ex, ei) => (
                  <div key={ei} className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3">
                    <p className="text-[14px] font-mono font-semibold mb-1 text-[var(--nimi-text-primary)]">{ex.raw}</p>
                    <p className="text-[12px] text-[var(--nimi-text-muted)]">{ex.parsed}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between border-t border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-5 py-3">
        <Button onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0} tone="ghost" size="sm" className="disabled:opacity-30">
          ← 上一步
        </Button>
        {step < GUIDE_STEPS.length - 1 ? (
          <Button onClick={() => setStep(step + 1)} tone="primary" size="sm" className="rounded-2xl">
            下一步 →
          </Button>
        ) : (
          <Button onClick={onClose} tone="primary" size="sm" className="rounded-2xl">
            我知道了 ✓
          </Button>
        )}
      </div>
    </Surface>
  );
}
