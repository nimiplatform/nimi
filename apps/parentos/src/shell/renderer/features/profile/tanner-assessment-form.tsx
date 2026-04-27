import { S } from '../../app-shell/page-style.js';
import { ProfileDatePicker } from './profile-date-picker.js';
import { TannerStageSelector } from './tanner-stage-selector.js';
import {
  ASSESSED_BY_LABELS,
  ASSESSED_BY_OPTIONS,
  PUBIC_HAIR_STAGES,
  type StageDesc,
} from './tanner-page-shared.js';

type TannerAssessmentFormProps = {
  bgLabel: string;
  bgStages: StageDesc[];
  formAssessedAt: string;
  setFormAssessedAt: (value: string) => void;
  formBG: number;
  setFormBG: (value: number) => void;
  formPH: number;
  setFormPH: (value: number) => void;
  formAssessedBy: string;
  setFormAssessedBy: (value: string) => void;
  formNotes: string;
  setFormNotes: (value: string) => void;
  formBoneAge: string;
  setFormBoneAge: (value: string) => void;
  formBodyFat: string;
  setFormBodyFat: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
};

export function TannerAssessmentForm({
  bgLabel,
  bgStages,
  formAssessedAt,
  setFormAssessedAt,
  formBG,
  setFormBG,
  formPH,
  setFormPH,
  formAssessedBy,
  setFormAssessedBy,
  formNotes,
  setFormNotes,
  formBoneAge,
  setFormBoneAge,
  formBodyFat,
  setFormBodyFat,
  onClose,
  onSave,
}: TannerAssessmentFormProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.25)' }} onClick={onClose}>
      <div className={`w-[440px] max-h-[85vh] overflow-y-auto ${S.radius} flex flex-col shadow-xl`} style={{ background: S.card }} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-6 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-[20px]">🌱</span>
            <h2 className="text-[16px] font-bold" style={{ color: S.text }}>新增评估</h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[#f0f0ec]" style={{ color: S.sub }}>✕</button>
        </div>

        <div className="px-6 pb-2 space-y-4 flex-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[13px] mb-1" style={{ color: S.sub }}>评估日期</p>
              <ProfileDatePicker value={formAssessedAt} onChange={setFormAssessedAt} style={{ background: '#fafaf8', color: S.text }} />
            </div>
            <div>
              <p className="text-[13px] mb-1" style={{ color: S.sub }}>评估人</p>
              <div className="flex gap-1.5">
                {ASSESSED_BY_OPTIONS.map((value) => (
                  <button
                    key={value}
                    onClick={() => setFormAssessedBy(value)}
                    className={`flex-1 py-2 text-[13px] font-medium ${S.radiusSm} transition-all`}
                    style={formAssessedBy === value ? { background: '#BDE0F5', color: '#fff' } : { background: '#f5f3ef', color: S.sub }}
                  >
                    {ASSESSED_BY_LABELS[value]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <TannerStageSelector stages={bgStages} value={formBG} onChange={setFormBG} label={bgLabel} />
            <TannerStageSelector stages={PUBIC_HAIR_STAGES} value={formPH} onChange={setFormPH} label="阴毛发育 (PH期)" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[13px] mb-1" style={{ color: S.sub }}>🦴 骨龄（岁，可选）</p>
              <input
                type="number"
                step="0.1"
                value={formBoneAge}
                onChange={(event) => setFormBoneAge(event.target.value)}
                placeholder="如 12.5"
                className={`w-full ${S.radiusSm} px-3 py-2 text-[14px] border-0 outline-none transition-shadow focus:ring-2 focus:ring-[#4ECCA3]/50`}
                style={{ background: '#fafaf8', color: S.text }}
              />
            </div>
            <div>
              <p className="text-[13px] mb-1" style={{ color: S.sub }}>📊 体脂率（%，可选）</p>
              <input
                type="number"
                step="0.1"
                value={formBodyFat}
                onChange={(event) => setFormBodyFat(event.target.value)}
                placeholder="如 18.5"
                className={`w-full ${S.radiusSm} px-3 py-2 text-[14px] border-0 outline-none transition-shadow focus:ring-2 focus:ring-[#4ECCA3]/50`}
                style={{ background: '#fafaf8', color: S.text }}
              />
            </div>
          </div>

          <div>
            <p className="text-[13px] mb-1" style={{ color: S.sub }}>备注</p>
            <input
              value={formNotes}
              onChange={(event) => setFormNotes(event.target.value)}
              placeholder="如：与上次对比有进展..."
              className={`w-full ${S.radiusSm} px-3 py-2 text-[14px] border-0 outline-none transition-shadow focus:ring-2 focus:ring-[#4ECCA3]/50`}
              style={{ background: '#fafaf8', color: S.text }}
            />
          </div>
        </div>

        <div className="px-6 pt-3 pb-5 mt-1">
          <div className="flex items-center justify-end gap-2">
            <button onClick={onClose} className={`px-4 py-2 text-[14px] ${S.radiusSm} transition-colors hover:bg-[#e8e8e4]`} style={{ background: '#f0f0ec', color: S.sub }}>取消</button>
            <button onClick={onSave} className={`px-5 py-2 text-[14px] font-medium text-white ${S.radiusSm} transition-colors hover:brightness-110`} style={{ background: S.accent }}>保存评估</button>
          </div>
        </div>
      </div>
    </div>
  );
}
