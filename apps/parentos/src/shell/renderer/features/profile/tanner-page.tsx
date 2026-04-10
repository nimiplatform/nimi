import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonths, computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { insertTannerAssessment, getTannerAssessments, getMeasurements, insertMeasurement } from '../../bridge/sqlite-bridge.js';
import type { TannerAssessmentRow, MeasurementRow } from '../../bridge/sqlite-bridge.js';
import { ulid, isoNow } from '../../bridge/ulid.js';
import { S } from '../../app-shell/page-style.js';
import { AppSelect } from '../../app-shell/app-select.js';
import { AISummaryCard } from './ai-summary-card.js';
import { ProfileDatePicker } from './profile-date-picker.js';

/* ── Tanner stage descriptions ───────────────────────────── */

interface StageDesc { stage: number; title: string; desc: string; howToJudge: string }

const BREAST_STAGES: StageDesc[] = [
  { stage: 1, title: 'B1 · 青春前期', desc: '仅乳头稍隆起，无乳房组织发育，与幼儿期相同。',
    howToJudge: '👀 观察：胸部完全平坦，和小时候一样。用手轻触乳头下方无硬块。' },
  { stage: 2, title: 'B2 · 花蕾期', desc: '乳头下方出现小硬块（如硬币大小），乳晕略增大。这是青春期第一个信号。',
    howToJudge: '👆 触诊：用指腹轻按乳头下方，能摸到一个硬硬的小结节（约1-2cm）。乳晕比之前颜色略深、直径稍大。⚠️ 8岁前出现需就医排查性早熟。' },
  { stage: 3, title: 'B3 · 发育中期', desc: '乳房明显隆起，从侧面看超出胸壁，但乳晕和乳房是一个整体圆弧。',
    howToJudge: '👀 侧面观察：从侧面看，乳房已经明显突出胸壁。但乳晕还没有从乳房上"鼓出来"，整体是一个光滑的圆弧。' },
  { stage: 4, title: 'B4 · 乳晕突出', desc: '乳晕和乳头形成第二个小丘，像"小山上的小山"一样突出于乳房。',
    howToJudge: '👀 正面观察：从正面看，乳晕区域像一个小圆盘一样从乳房上凸起，形成了"两层"的外观。不是所有女孩都会经历此期。' },
  { stage: 5, title: 'B5 · 成熟期', desc: '乳房呈成人形态，乳晕回缩与乳房融为一体，仅乳头突出。',
    howToJudge: '👀 观察：乳房呈完全成熟的圆润外形。B4时凸出的乳晕已回缩，与乳房表面融为一体，仅乳头突出。' },
];

const GENITAL_STAGES: StageDesc[] = [
  { stage: 1, title: 'G1 · 青春前期', desc: '睾丸、阴囊和阴茎与幼儿期相同。睾丸容积<4ml。',
    howToJudge: '📏 参照物：睾丸大小接近一颗花生米（长径<2.5cm，约1-3ml）。阴囊皮肤颜色浅，质感与身体其他部位一致。' },
  { stage: 2, title: 'G2 · 早期', desc: '睾丸开始增大（容积≥4ml），这是男孩青春期的第一个信号。阴茎尚无明显变化。',
    howToJudge: '📏 参照物：睾丸从"花生米"长到约"葡萄"大小（长径约2.5-3cm，约4-6ml）。阴囊皮肤开始变薄、发红。阴茎本身还没变长。⚠️ 9岁前出现需就医排查性早熟。' },
  { stage: 3, title: 'G3 · 发育中期', desc: '阴茎开始变长（但还不太粗），睾丸继续增大（约8-10ml）。',
    howToJudge: '📏 参照物：睾丸约"龙眼/樱桃"大小（长径约3-3.5cm，约8-10ml）。阴茎明显比之前长了，但粗细变化不大。' },
  { stage: 4, title: 'G4 · 接近成熟', desc: '阴茎进一步增长并变粗，龟头发育明显。睾丸约12-15ml。',
    howToJudge: '📏 参照物：睾丸约"板栗"大小（长径约4-4.5cm，约12-15ml）。阴茎不仅变长还明显变粗。龟头轮廓清晰可见。阴囊颜色明显加深。' },
  { stage: 5, title: 'G5 · 成熟期', desc: '外生殖器达到成人大小。睾丸容积约15-25ml。',
    howToJudge: '📏 参照物：睾丸约"大枣/鸽子蛋"大小（长径约4.5-5cm，约15-25ml）。外生殖器整体外观与成人一致。' },
];

const PUBIC_HAIR_STAGES: StageDesc[] = [
  { stage: 1, title: 'PH1 · 无阴毛', desc: '阴部区域无阴毛，仅有类似腹部的细绒毛。',
    howToJudge: '👀 观察：和小时候一样，只有细小的绒毛（"胎毛"），颜色很浅，肉眼几乎看不到。' },
  { stage: 2, title: 'PH2 · 稀疏出现', desc: '出现少量略长的毛发，通常在阴唇边缘或阴茎根部，颜色略深。',
    howToJudge: '👀 观察：能看到几根到十几根比较长的、颜色稍深的毛发。通常是直的或微微弯曲，主要在会阴部或阴茎根部。' },
  { stage: 3, title: 'PH3 · 增多变粗', desc: '毛发明显变多变粗变卷，颜色加深，开始向耻骨联合（小腹下方正中）扩展。',
    howToJudge: '👀 观察：毛发已经够多，可以用"一小撮"来形容。开始卷曲，颜色明显是深色的。分布范围向小腹下方扩展。' },
  { stage: 4, title: 'PH4 · 接近成人', desc: '毛发质地接近成人，粗而卷曲，覆盖范围较大，但尚未达到大腿内侧。',
    howToJudge: '👀 观察：毛发已经很浓密，质感像成人的阴毛一样粗硬卷曲。但分布范围还没有到大腿根部内侧。' },
  { stage: 5, title: 'PH5 · 成人型', desc: '毛发呈成人分布型，延伸至大腿内侧，女性呈倒三角、男性呈菱形。',
    howToJudge: '👀 观察：毛发分布范围和密度与成人一致。已经延伸到大腿内侧根部。' },
];

/* ── Stage-specific guidance (by gender + current max stage) ──

   Sources:
   [A] 中华医学会儿科学分会内分泌遗传代谢学组.
       中枢性性早熟诊断与治疗专家共识（2022）.
       中华儿科杂志 2023;61(1):1-8

   [B] 中国营养学会.
       中国居民膳食营养素参考摄入量（2023版）.
       人民卫生出版社, 2023

   [C] Marshall WA, Tanner JM.
       Variations in pattern of pubertal changes in girls.
       Arch Dis Child 1969;44:291-303

   [D] Marshall WA, Tanner JM.
       Variations in the pattern of pubertal changes in boys.
       Arch Dis Child 1970;45:13-23

   [E] 国家卫生健康委员会.
       儿童青少年近视防控适宜技术指南（更新版）. 2023
       — 引用其中关于户外活动时长建议

   Notation: each item ends with [X] to cite its source
*/

interface StageGuidance {
  stage: number;
  title: string;
  physical: string[];
  psychological: string[];
  nutrition: string[];
  checkups: string[];
  parentTips: string[];
}

const FEMALE_GUIDANCE: StageGuidance[] = [
  { stage: 1, title: '青春前期（B1/PH1）',
    physical: ['保持充足睡眠（6-12岁推荐9-12小时/天）和适量运动 [B]', '关注身高增长速度，青春期前是追赶生长的最后窗口 [C]'],
    psychological: ['可以开始用绘本或适龄读物做基础的身体认知教育', '建立开放的亲子沟通习惯，让孩子知道身体变化是正常的'],
    nutrition: ['钙推荐：4-10岁 600mg/d，11岁起 800mg/d [B]', '维生素D：10μg(400IU)/d，建议检测25-OH-VD [B]', '避免高糖高油高热量食物，肥胖可能导致性早熟 [A]'],
    checkups: ['女孩7.5岁前出现乳房发育需排查性早熟 [A]', '常规体检关注身高体重曲线'],
    parentTips: ['不要因为"还小"就忽视饮食习惯的建立', '注意减少环境中内分泌干扰物暴露（如BPA）'],
  },
  { stage: 2, title: '青春期启动（B2）— 关键时期',
    physical: ['青春期生长突增即将开始 [C]', '可以开始穿发育期内衣保护乳房', '性发育全程约3-4年，每个分期约持续1年 [A]'],
    psychological: ['开展青春期教育：月经、身体变化、隐私保护', '情绪波动是荷尔蒙变化的正常反应 [C]', '教会孩子保护身体隐私'],
    nutrition: ['铁的需求开始增加（为月经做准备）[B]', '钙推荐：11岁起 800mg/d [B]', '蛋白质：10-11岁 50g/d，12岁起 60g/d [B]'],
    checkups: ['建议做骨龄检查，评估发育进程和成年身高预测 [A]', '若B2出现<7.5岁或>13岁，需内分泌科就诊 [A]', '每半年测量身高，记录生长速度'],
    parentTips: ['这是青春期起点，未来3-4年身体会发生很大变化 [A]', '月经通常在B2后约2-3年到来 [C]', '提前准备卫生巾等月经用品'],
  },
  { stage: 3, title: '快速发育期（B3）',
    physical: ['身高生长速度达峰值(PHV)，通常在初潮前约1年 [C]', '体脂开始重新分布，臀部和大腿变丰满 [C]'],
    psychological: ['关注外貌是正常的，引导健康的身体形象认知', '可能出现更明显的情绪波动、与同伴比较'],
    nutrition: ['铁、钙、锌、维生素D是重点营养素 [B]', '避免节食减肥，保证营养质量'],
    checkups: ['月经初潮可能在未来6-12个月内到来 [C]', '初潮后前1-2年月经不规律属正常'],
    parentTips: ['准备"月经急救包"放书包（卫生巾+内裤+湿巾）', '和孩子谈月经知识，消除恐惧感'],
  },
  { stage: 4, title: '接近成熟（B4）',
    physical: ['大部分女孩在此阶段前后出现月经初潮 [C]', '初潮后身高增长减慢 [C]', '体型趋于成熟'],
    psychological: ['自我意识增强，可能出现身体焦虑', '引导关注身体功能而非外观'],
    nutrition: ['月经期注意补铁（红肉、动物肝脏）[B]', '保持均衡饮食，不建议额外"进补"'],
    checkups: ['初潮后2年月经仍很不规律建议就医', '关注HPV疫苗接种时机'],
    parentTips: ['月经疼痛常见，适度热敷和休息即可', '保持开放对话'],
  },
  { stage: 5, title: '发育成熟（B5/PH5）',
    physical: ['身体发育基本完成，身高增长接近停止 [C]', '月经逐渐规律化'],
    psychological: ['青春期情绪波动逐渐稳定', '帮助建立积极的身体形象和自信'],
    nutrition: ['转为维持性营养，继续保证钙和铁摄入 [B]'],
    checkups: ['常规年度体检', '月经异常（过多、过少、剧痛）及时就医'],
    parentTips: ['青春期的"难"即将过去，给彼此一些肯定'],
  },
];

const MALE_GUIDANCE: StageGuidance[] = [
  { stage: 1, title: '青春前期（G1/PH1）',
    physical: ['保持充足睡眠（6-12岁推荐9-12小时/天）和运动 [B]', '男孩青春期生长突增比女孩晚约1-2年 [D]'],
    psychological: ['可以开始基础的身体认知教育', '建立开放的亲子沟通习惯'],
    nutrition: ['钙推荐：4-10岁 600mg/d，11岁起 800mg/d [B]', '维生素D：10μg(400IU)/d [B]', '避免高热量食物，肥胖可能影响青春期启动时间 [A]'],
    checkups: ['男孩9岁前出现睾丸增大需排查性早熟 [A]', '常规体检关注生长曲线'],
    parentTips: ['男孩青春期通常比女孩晚1-2年开始，不必焦虑 [D]', '注意减少环境中内分泌干扰物暴露'],
  },
  { stage: 2, title: '青春期启动（G2）— 关键时期',
    physical: ['睾丸增大（≥4ml）是男孩青春期第一个信号 [D]', '身高突增通常在G2后1-2年开始 [D]', '性发育全程约3-4年，每个分期约1年 [A]'],
    psychological: ['开展青春期教育：身体变化、遗精、隐私 [A]', '可能出现对身体变化的好奇和不安', '教会保护身体隐私'],
    nutrition: ['蛋白质需求增加：10-11岁 50g/d，12岁起 65g/d [B]', '钙：11岁起 800mg/d [B]', '锌很重要：8-10mg/d（海鲜、瘦肉、坚果）[B]'],
    checkups: ['建议做骨龄检查，评估发育进程 [A]', '若G2出现<9岁或>14岁，需内分泌科就诊 [A]', '每半年测量身高'],
    parentTips: ['男孩可能不愿主动谈身体变化，家长需找合适时机', '可选择同性家长沟通', '关注孩子是否在网上搜索相关信息，引导正确认知'],
  },
  { stage: 3, title: '快速发育期（G3）',
    physical: ['身高开始快速增长 [D]', '声音开始变化（变声期）[D]', '可能出现痤疮和首次遗精 [D]'],
    psychological: ['情绪波动加剧，可能变得易怒或沉默', '对异性的好奇是正常的', '自尊心变强，注意交流方式'],
    nutrition: ['热量和蛋白质需求显著增加 [B]', '不要刻意限制主食（碳水供能）', '牛奶/豆浆补钙 [B]'],
    checkups: ['关注脊柱侧弯（快速生长期高发）', '痤疮严重时就诊皮肤科'],
    parentTips: ['遗精是正常现象，提前告知避免恐慌 [D]', '教会面部清洁预防痤疮', '适量运动有助于生长激素分泌'],
  },
  { stage: 4, title: '接近成熟（G4）',
    physical: ['身高生长速度达峰值(PHV) [D]', '肌肉量明显增加 [D]', '体毛（腋毛、胡须）出现，声音完全变粗 [D]'],
    psychological: ['独立意识增强', '需要更多自主空间但也需要边界'],
    nutrition: ['蛋白质：15-17岁 75g/d [B]', '运动量大需更多碳水和水分'],
    checkups: ['持续关注脊柱姿态', '运动损伤预防（骨骺尚未闭合）'],
    parentTips: ['尊重隐私，保持"门开着"的沟通姿态', '引导正确的性知识和价值观'],
  },
  { stage: 5, title: '发育成熟（G5/PH5）',
    physical: ['身体发育基本完成，身高增长接近停止（骨骺闭合）[D]', '肌肉继续充实'],
    psychological: ['青春期情绪逐渐稳定', '自我认同感逐步建立'],
    nutrition: ['转为维持性营养，保持均衡饮食 [B]'],
    checkups: ['常规年度体检'],
    parentTips: ['继续保持良好的亲子关系'],
  },
];

const ASSESSED_BY_OPTIONS = ['parent', 'physician', 'self'] as const;
const ASSESSED_BY_LABELS: Record<string, string> = { self: '自评', parent: '家长评估', physician: '医生评估' };

function fmtAge(am: number) {
  if (am < 24) return `${am}月`;
  const y = Math.floor(am / 12), r = am % 12;
  return r > 0 ? `${y}岁${r}月` : `${y}岁`;
}

/* ── Stage selector card ─────────────────────────────────── */

function StageSelector({ stages, value, onChange, label }: {
  stages: StageDesc[]; value: number; onChange: (n: number) => void; label: string;
}) {
  const [expandedStage, setExpandedStage] = useState<number | null>(null);

  return (
    <div className="mb-5">
      <p className="text-[12px] font-semibold mb-2" style={{ color: S.text }}>{label}</p>
      <div className="space-y-1.5">
        {stages.map((s) => {
          const active = value === s.stage;
          const expanded = expandedStage === s.stage;
          return (
            <div key={s.stage} className={`${S.radiusSm} overflow-hidden transition-all`}
              style={active
                ? { background: S.accent, color: '#fff', boxShadow: '0 2px 8px rgba(148,165,51,0.25)' }
                : { background: '#f5f3ef', color: S.text }
              }>
              {/* Main clickable row */}
              <button onClick={() => onChange(s.stage)} className="w-full text-left p-3">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                    style={active ? { background: 'rgba(255,255,255,0.25)', color: '#fff' } : { background: '#e8e5e0', color: S.sub }}>
                    {s.stage}
                  </div>
                  <span className="text-[12px] font-semibold flex-1">{s.title}</span>
                  {/* Expand toggle */}
                  <span onClick={(e) => { e.stopPropagation(); setExpandedStage(expanded ? null : s.stage); }}
                    className="text-[9px] px-1.5 py-0.5 rounded cursor-pointer transition-colors"
                    style={active ? { background: 'rgba(255,255,255,0.2)', color: '#fff' } : { background: '#e8e5e0', color: S.sub }}>
                    {expanded ? '收起' : '如何判断?'}
                  </span>
                </div>
                <p className="text-[10px] mt-1 ml-8 leading-relaxed" style={{ color: active ? 'rgba(255,255,255,0.8)' : S.sub }}>
                  {s.desc}
                </p>
              </button>
              {/* Expanded how-to-judge section */}
              {expanded && (
                <div className="px-3 pb-3 ml-8">
                  <div className={`${S.radiusSm} p-2.5 text-[10px] leading-relaxed`}
                    style={active
                      ? { background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.9)' }
                      : { background: '#fff', color: S.text, border: `1px solid ${S.border}` }
                    }>
                    {s.howToJudge}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────── */

export default function TannerPage() {
  const { activeChildId, setActiveChildId, children } = useAppStore();
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
    if (activeChildId) loadAll(activeChildId).catch(() => {});
  }, [activeChildId]);

  if (!child) return <div className="p-8" style={{ color: S.sub }}>请先添加孩子</div>;

  const ageMonths = computeAgeMonths(child.birthDate);
  const isFemale = child.gender === 'female';
  const bgLabel = isFemale ? '乳房发育 (B期)' : '外生殖器发育 (G期)';
  const bgStages = isFemale ? BREAST_STAGES : GENITAL_STAGES;

  const sorted = [...assessments].sort((a, b) => b.assessedAt.localeCompare(a.assessedAt));

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
    <div className={S.container} style={{ paddingTop: S.topPad, background: S.bg, minHeight: '100%' }}>
      <div className="flex items-center gap-2 mb-5">
        <Link to="/profile" className="text-[13px] hover:underline" style={{ color: S.sub }}>← 返回档案</Link>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold" style={{ color: S.text }}>青春期发育评估</h1>
          {/* Info tooltip */}
          <div className="group relative">
            <div className="w-[18px] h-[18px] rounded-full flex items-center justify-center cursor-help hover:bg-[#f0f0ec]" style={{ color: S.sub }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </div>
            <div className="pointer-events-none absolute left-0 top-7 z-50 w-[320px] rounded-xl p-4 text-[11px] leading-relaxed opacity-0 transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100"
              style={{ background: '#1a2b4a', color: '#e0e4e8', boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
              <p className="text-[12px] font-semibold text-white mb-2">参考标准</p>
              <ul className="space-y-2">
                <li>
                  <span className="text-[#c8e64a] font-medium">Tanner 分期标准</span>
                  <span className="block text-[10px] text-[#a0a8b4] mt-0.5">Marshall WA, Tanner JM. Variations in pattern of pubertal changes in girls/boys.</span>
                  <span className="block text-[10px] text-[#7a8090]">Arch Dis Child 1969;44:291-303 / 1970;45:13-23</span>
                </li>
                <li>
                  <span className="text-[#c8e64a] font-medium">中国儿童青春期参考</span>
                  <span className="block text-[10px] text-[#a0a8b4] mt-0.5">中华医学会儿科学分会内分泌遗传代谢学组. 中枢性性早熟诊断与治疗专家共识（2022）</span>
                </li>
              </ul>
              <p className="text-[9px] mt-2 pt-2 border-t border-white/10 text-[#808890]">女孩 B2 通常 8-13 岁出现 · 男孩 G2 通常 9-14 岁出现</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowGuide(!showGuide)}
            className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium ${S.radiusSm} transition-all`}
            style={showGuide ? { background: S.accent, color: '#fff' } : { background: '#f0f0ec', color: S.sub }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            评估指引
          </button>
          {!showForm && (
            <button onClick={() => setShowForm(true)}
              className={`flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium text-white ${S.radiusSm} hover:opacity-90`}
              style={{ background: S.accent }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              添加评估
            </button>
          )}
        </div>
      </div>
      <div className="mb-4">
        <AppSelect value={activeChildId ?? ''} onChange={(v) => setActiveChildId(v || null)}
          options={children.map((c) => ({ value: c.childId, label: `${c.displayName}，${fmtAge(computeAgeMonths(c.birthDate))}` }))} />
        <p className="text-[11px] mt-1" style={{ color: S.sub }}>{isFemale ? '女孩' : '男孩'} · 共 {assessments.length} 次评估</p>
      </div>

      {/* ── Bone age & body fat overview ──────────────────── */}
      {(boneAgeMeasurements.length > 0 || bodyFatMeasurements.length > 0) && (
        <div className="grid grid-cols-2 gap-3 mb-5">
          {(() => {
            const latest = [...boneAgeMeasurements].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))[0];
            if (!latest) return <div />;
            const actualYears = ageMonths / 12;
            const diff = latest.value - actualYears;
            const status = Math.abs(diff) <= 1
              ? { label: '正常范围', color: '#22c55e', bg: '#f0fdf4' }
              : diff > 1 ? { label: `偏早 ${Math.abs(diff).toFixed(1)} 年`, color: '#f59e0b', bg: '#fffbeb' }
              : { label: `偏晚 ${Math.abs(diff).toFixed(1)} 年`, color: '#3b82f6', bg: '#eff6ff' };
            return (
              <div className={`${S.radiusSm} p-4`} style={{ background: status.bg, border: `1px solid ${status.color}30` }}>
                <p className="text-[10px] font-medium" style={{ color: S.sub }}>🦴 骨龄</p>
                <p className="text-[20px] font-bold mt-1" style={{ color: S.text }}>{latest.value} 岁</p>
                <div className="flex items-center gap-1 mt-1">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: status.color }} />
                  <span className="text-[11px]" style={{ color: status.color }}>{status.label}</span>
                </div>
                <p className="text-[10px] mt-1" style={{ color: S.sub }}>{latest.measuredAt.split('T')[0]}</p>
              </div>
            );
          })()}
          {(() => {
            const latest = [...bodyFatMeasurements].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))[0];
            if (!latest) return <div />;
            return (
              <div className={`${S.radiusSm} p-4`} style={{ background: '#f5f3ef' }}>
                <p className="text-[10px] font-medium" style={{ color: S.sub }}>📊 体脂率</p>
                <p className="text-[20px] font-bold mt-1" style={{ color: S.text }}>{latest.value}%</p>
                <p className="text-[10px] mt-1" style={{ color: S.sub }}>{latest.measuredAt.split('T')[0]}</p>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Guide ────────────────────────────────────────── */}
      {showGuide && (
        <div className={`${S.radius} mb-5 overflow-hidden`} style={{ boxShadow: S.shadow }}>
          <div className="px-5 py-4" style={{ background: 'linear-gradient(135deg, #4a6a8a, #6a8ab0)' }}>
            <h3 className="text-[15px] font-bold text-white mb-1">什么是 Tanner 分期？</h3>
            <p className="text-[11px] text-white/70">Tanner 分期是国际通用的青春期发育评估标准，将{isFemale ? '乳房' : '外生殖器'}和阴毛发育各分为 5 期。</p>
          </div>
          <div className="p-5 space-y-4" style={{ background: S.card }}>
            <div>
              <h4 className="text-[12px] font-semibold mb-1" style={{ color: S.text }}>如何判断？</h4>
              <p className="text-[11px] leading-relaxed" style={{ color: S.sub }}>
                {isFemale
                  ? '观察乳房的大小、形态和乳晕变化。B1 期是青春前期没有任何发育，B2 期（花蕾期）是乳头下方出现小硬块，这是青春期的第一个信号。如果 8 岁前出现 B2 需警惕性早熟。'
                  : '观察睾丸大小和阴茎长度变化。G1 期是青春前期，G2 期是睾丸开始增大（通常用睾丸容积仪测量>4ml）。如果 9 岁前出现 G2 需警惕性早熟。'}
              </p>
            </div>
            <div>
              <h4 className="text-[12px] font-semibold mb-1" style={{ color: S.text }}>正常发育时间参考</h4>
              <div className="grid grid-cols-2 gap-2">
                <div className={`${S.radiusSm} p-3`} style={{ background: '#f8faf9', border: `1px solid ${S.border}` }}>
                  <p className="text-[11px] font-semibold" style={{ color: S.text }}>{isFemale ? '乳房发育 B2 出现' : '睾丸增大 G2 出现'}</p>
                  <p className="text-[10px]" style={{ color: S.sub }}>{isFemale ? '正常: 8-13 岁 · 平均 10.5 岁' : '正常: 9-14 岁 · 平均 11.5 岁'}</p>
                  <p className="text-[10px] mt-1" style={{ color: '#dc2626' }}>{isFemale ? '<8 岁出现需排查性早熟' : '<9 岁出现需排查性早熟'}</p>
                </div>
                <div className={`${S.radiusSm} p-3`} style={{ background: '#f8faf9', border: `1px solid ${S.border}` }}>
                  <p className="text-[11px] font-semibold" style={{ color: S.text }}>阴毛 PH2 出现</p>
                  <p className="text-[10px]" style={{ color: S.sub }}>{isFemale ? '通常在 B2 后 6-12 个月出现' : '通常与 G2 同时或稍后出现'}</p>
                  <p className="text-[10px] mt-1" style={{ color: S.sub }}>单纯阴毛早现可能为肾上腺功能早现</p>
                </div>
              </div>
            </div>
            <div>
              <h4 className="text-[12px] font-semibold mb-1" style={{ color: S.text }}>何时需要就医？</h4>
              <ul className="text-[11px] leading-relaxed space-y-0.5" style={{ color: S.sub }}>
                <li>• {isFemale ? '8 岁前出现乳房发育（B2）' : '9 岁前出现睾丸增大（G2）'}——可能是性早熟</li>
                <li>• {isFemale ? '13 岁仍无任何发育迹象' : '14 岁仍无任何发育迹象'}——可能是青春期延迟</li>
                <li>• 发育进展过快（1年内跨越2个分期）或伴随身高增长加速</li>
                <li>• 建议配合骨龄检查评估发育进程</li>
              </ul>
            </div>
          </div>
          <div className="px-5 py-3 flex justify-end" style={{ background: '#f8faf9', borderTop: `1px solid ${S.border}` }}>
            <button onClick={() => setShowGuide(false)} className={`px-4 py-1.5 text-[12px] font-medium text-white ${S.radiusSm}`} style={{ background: S.accent }}>我知道了</button>
          </div>
        </div>
      )}

      <AISummaryCard domain="tanner" childName={child.displayName} childId={child.childId}
        ageLabel={`${Math.floor(ageMonths / 12)}岁${ageMonths % 12}个月`} gender={child.gender}
        dataContext={assessments.length > 0 ? `共 ${assessments.length} 次评估` : ''} />

      {/* ── Add form ─────────────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.25)' }} onClick={() => resetForm()}>
        <div className={`w-[440px] max-h-[85vh] overflow-y-auto ${S.radius} flex flex-col shadow-xl`} style={{ background: S.card }} onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 pt-6 pb-3">
            <div className="flex items-center gap-2">
              <span className="text-[20px]">🌱</span>
              <h2 className="text-[15px] font-bold" style={{ color: S.text }}>新增评估</h2>
            </div>
            <button onClick={resetForm} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[#f0f0ec]" style={{ color: S.sub }}>✕</button>
          </div>

          <div className="px-6 pb-2 space-y-4 flex-1">
          {/* Date + assessor */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] mb-1" style={{ color: S.sub }}>评估日期</p>
              <ProfileDatePicker value={formAssessedAt} onChange={setFormAssessedAt} style={{ background: '#fafaf8', color: S.text }} />
            </div>
            <div>
              <p className="text-[11px] mb-1" style={{ color: S.sub }}>评估人</p>
              <div className="flex gap-1.5">
                {ASSESSED_BY_OPTIONS.map((v) => (
                  <button key={v} onClick={() => setFormAssessedBy(v)}
                    className={`flex-1 py-2 text-[11px] font-medium ${S.radiusSm} transition-all`}
                    style={formAssessedBy === v ? { background: '#86AFDA', color: '#fff' } : { background: '#f5f3ef', color: S.sub }}>
                    {ASSESSED_BY_LABELS[v]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Stage selectors with descriptions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <StageSelector stages={bgStages} value={formBG} onChange={setFormBG} label={bgLabel} />
            <StageSelector stages={PUBIC_HAIR_STAGES} value={formPH} onChange={setFormPH} label="阴毛发育 (PH期)" />
          </div>

          {/* Bone age + Body fat */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] mb-1" style={{ color: S.sub }}>🦴 骨龄（岁，可选）</p>
              <input type="number" step="0.1" value={formBoneAge} onChange={(e) => setFormBoneAge(e.target.value)}
                placeholder="如 12.5"
                className={`w-full ${S.radiusSm} px-3 py-2 text-[13px] border-0 outline-none transition-shadow focus:ring-2 focus:ring-[#c8e64a]/50`}
                style={{ background: '#fafaf8', color: S.text }} />
            </div>
            <div>
              <p className="text-[11px] mb-1" style={{ color: S.sub }}>📊 体脂率（%，可选）</p>
              <input type="number" step="0.1" value={formBodyFat} onChange={(e) => setFormBodyFat(e.target.value)}
                placeholder="如 18.5"
                className={`w-full ${S.radiusSm} px-3 py-2 text-[13px] border-0 outline-none transition-shadow focus:ring-2 focus:ring-[#c8e64a]/50`}
                style={{ background: '#fafaf8', color: S.text }} />
            </div>
          </div>

          {/* Notes */}
          <div>
            <p className="text-[11px] mb-1" style={{ color: S.sub }}>备注</p>
            <input value={formNotes} onChange={(e) => setFormNotes(e.target.value)} placeholder="如：与上次对比有进展..."
              className={`w-full ${S.radiusSm} px-3 py-2 text-[13px] border-0 outline-none transition-shadow focus:ring-2 focus:ring-[#c8e64a]/50`}
              style={{ background: '#fafaf8', color: S.text }} />
          </div>
          </div>

          <div className="px-6 pt-3 pb-5 mt-1">
            <div className="flex items-center justify-end gap-2">
              <button onClick={resetForm} className={`px-4 py-2 text-[13px] ${S.radiusSm} transition-colors hover:bg-[#e8e8e4]`} style={{ background: '#f0f0ec', color: S.sub }}>取消</button>
              <button onClick={() => void handleSubmit()} className={`px-5 py-2 text-[13px] font-medium text-white ${S.radiusSm} transition-colors hover:brightness-110`} style={{ background: S.accent }}>保存评估</button>
            </div>
          </div>
        </div>
        </div>
      )}

      {/* ── Stage-specific guidance ──────────────────────── */}
      <GuidancePanel isFemale={isFemale} latestBG={sorted[0]?.breastOrGenitalStage ?? null} latestPH={sorted[0]?.pubicHairStage ?? null} />

      {/* ── Assessment timeline ──────────────────────────── */}
      <h2 className="text-[13px] font-semibold mb-3 mt-6" style={{ color: S.text }}>
        {sorted.length > 0 ? `评估记录（${sorted.length} 次）` : '暂无评估记录'}
      </h2>
      {sorted.length === 0 && !showForm && (
        <div className={`${S.radius} p-8 text-center`} style={{ background: S.card, boxShadow: S.shadow }}>
          <span className="text-[28px]">🌱</span>
          <p className="text-[13px] mt-2 font-medium" style={{ color: S.text }}>还没有发育评估记录</p>
          <p className="text-[11px] mt-1" style={{ color: S.sub }}>建议青春期开始后每 6-12 个月评估一次</p>
        </div>
      )}
      <div className="space-y-3">
        {sorted.map((a, i) => {
          const bgInfo = bgStages.find((s) => s.stage === a.breastOrGenitalStage);
          const phInfo = PUBIC_HAIR_STAGES.find((s) => s.stage === a.pubicHairStage);
          const prev = sorted[i + 1]; // previous (older) assessment
          const bgChanged = prev && prev.breastOrGenitalStage !== a.breastOrGenitalStage;
          const phChanged = prev && prev.pubicHairStage !== a.pubicHairStage;

          return (
            <div key={a.assessmentId} className={`${S.radius} overflow-hidden`} style={{ boxShadow: S.shadow }}>
              {/* Header */}
              <div className="px-4 py-3 flex items-center justify-between" style={{ background: 'linear-gradient(135deg, #6a82a8, #86AFDA)' }}>
                <div className="flex items-center gap-3">
                  <span className="text-[13px] font-semibold text-white">{a.assessedAt.split('T')[0]}</span>
                  <span className="text-[10px] text-white/60">{fmtAge(a.ageMonths)}</span>
                  {a.assessedBy && <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/20 text-white/70">{ASSESSED_BY_LABELS[a.assessedBy] ?? a.assessedBy}</span>}
                </div>
              </div>
              {/* Stage badges */}
              <div className="grid grid-cols-2 gap-3 p-4" style={{ background: S.card }}>
                <div className={`${S.radiusSm} p-3`} style={{ background: bgChanged ? '#f0fdf4' : '#f8faf9', border: `1px solid ${bgChanged ? '#86efac' : S.border}` }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white" style={{ background: S.accent }}>{a.breastOrGenitalStage ?? '-'}</span>
                    <span className="text-[11px] font-semibold" style={{ color: S.text }}>{isFemale ? 'B期 乳房' : 'G期 生殖器'}</span>
                    {bgChanged && <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: '#dcfce7', color: '#16a34a' }}>↑ 进展</span>}
                  </div>
                  <p className="text-[10px]" style={{ color: S.sub }}>{bgInfo?.desc.slice(0, 30) ?? ''}...</p>
                </div>
                <div className={`${S.radiusSm} p-3`} style={{ background: phChanged ? '#f0fdf4' : '#f8faf9', border: `1px solid ${phChanged ? '#86efac' : S.border}` }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white" style={{ background: '#86AFDA' }}>{a.pubicHairStage ?? '-'}</span>
                    <span className="text-[11px] font-semibold" style={{ color: S.text }}>PH期 阴毛</span>
                    {phChanged && <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: '#dcfce7', color: '#16a34a' }}>↑ 进展</span>}
                  </div>
                  <p className="text-[10px]" style={{ color: S.sub }}>{phInfo?.desc.slice(0, 30) ?? ''}...</p>
                </div>
              </div>
              {a.notes && (
                <div className="px-4 pb-3 text-[10px]" style={{ color: S.sub, background: S.card }}>备注: {a.notes}</div>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
}

/* ================================================================
   GUIDANCE PANEL — stage-specific developmental advice
   ================================================================ */

/* ── Detailed how-to for key guidance items ──────────────── */

const DETAIL_MAP: Record<string, { steps: string[]; resources?: string[]; when?: string }> = {
  // Psychological
  '可以开始用绘本或适龄读物做基础的身体认知教育': {
    steps: ['洗澡时自然地教孩子认识身体部位的正确名称', '用"泳衣规则"教隐私：泳衣覆盖的部位别人不能碰', '阅读适龄绘本，不需一次讲完，日常中自然带入'],
    resources: ['绘本推荐：《我们的身体》《小威向前冲》《不要随便摸我》', '动画：《丁丁豆豆成长记》'],
    when: '日常洗澡、换衣服、亲子阅读时',
  },
  '建立开放的亲子沟通习惯，让孩子知道身体变化是正常的': {
    steps: ['用"你有没有注意到..."开启话题，不要等孩子问', '回答问题时用正确的名称，不回避不尴尬', '告诉孩子"任何关于身体的问题都可以问爸爸妈妈"'],
    when: '不要专门"开会"讲，利用自然场景（看电视、同学聊天后）',
  },
  '开展青春期教育：月经、身体变化、隐私保护': {
    steps: ['女孩：解释月经是什么、为什么会来、怎么用卫生巾', '教会使用卫生巾/护垫，可以在家先练习', '谈谈内衣选择和胸部发育是正常的', '强调这些都是长大的标记，不需要害羞或害怕'],
    resources: ['绘本推荐：《女孩的秘密书》《你的身体在说话》', 'APP：美柚（适合大孩子自己记录月经）'],
    when: 'B2出现后尽快开始，不要等到月经来了才讲',
  },
  '开展青春期教育：身体变化、遗精、隐私 [A]': {
    steps: ['告诉孩子身体变化（变声、长胡子、长高）都是正常的', '解释遗精：夜里内裤湿了是身体开始成熟的信号，不是生病', '教会正确清洗和更换内裤的习惯', '谈论隐私保护和尊重他人的身体'],
    resources: ['书籍推荐：《男孩的冒险书》《青春期男孩说明书》'],
    when: 'G2出现后，找一个轻松的时间（如散步、开车时），不要正式"开会"',
  },
  // Nutrition
  '钙推荐：4-10岁 600mg/d，11岁起 800mg/d [B]': {
    steps: ['每天1-2杯牛奶/酸奶（250ml牛奶≈300mg钙）', '豆腐、虾皮、芝麻酱也是好的钙来源', '不需要额外吃钙片，食补为主'],
    when: '早餐+睡前各一杯奶最方便',
  },
  '维生素D：10μg(400IU)/d，建议检测25-OH-VD [B]': {
    steps: ['每天户外活动至少1小时（即使阴天也有效）', '如日晒不足可补充维生素D滴剂（400IU/天）', '建议每年体检时查一次血清25-OH-VD水平', '达标值：>20ng/mL（充足>30ng/mL）'],
    when: '冬季、雾霾天、户外活动少时更需要关注',
  },
  '铁的需求开始增加（为月经做准备）[B]': {
    steps: ['每周吃2-3次红肉（牛肉、猪瘦肉）', '动物肝脏每周1次（鸡肝/猪肝25-50g）', '深色蔬菜（菠菜、木耳）搭配维C水果促进吸收', '不要和牛奶/茶/咖啡同时吃，会影响铁吸收'],
  },
  // Checkups
  '建议做骨龄检查，评估发育进程和成年身高预测 [A]': {
    steps: ['到医院内分泌科或儿保科挂号', '拍左手手腕X光片（一张片子，辐射量极小）', '医生会对比标准图谱，读出骨龄', '骨龄-年龄差>1年需要关注'],
    when: '青春期启动时做第一次，之后每年复查一次',
  },
  '女孩7.5岁前出现乳房发育需排查性早熟 [A]': {
    steps: ['先确认是否真的乳房发育（触诊有硬块）而非单纯肥胖', '挂号：儿童内分泌科', '医生可能安排：骨龄片、性激素六项、B超', '如确诊中枢性性早熟，GnRHa治疗越早效果越好 [A]'],
    when: '发现乳房变化后尽快就医，不要"再观察看看"',
  },
  '男孩9岁前出现睾丸增大需排查性早熟 [A]': {
    steps: ['判断标准：睾丸容积≥4ml或长径≥2.5cm [A]', '挂号：儿童内分泌科', '医生会做激发试验和影像检查', '男孩性早熟比女孩少见，但更需要排查病因 [A]'],
    when: '发现变化后尽快就医',
  },
  // Parent tips
  '月经通常在B2后约2-3年到来 [C]': {
    steps: ['B2（乳房开始发育）后约2-3年出现月经初潮', '初潮年龄通常在9-15岁之间', '初潮前1年身高增长最快，初潮后增长减慢', '提前准备好卫生巾，教会使用方法'],
    resources: ['准备"月经急救包"放书包：2片日用卫生巾+1条内裤+湿巾+密封袋'],
    when: 'B2出现后就可以开始准备',
  },
  '遗精是正常现象，提前告知避免恐慌 [D]': {
    steps: ['告诉孩子：睡觉时内裤湿了是身体成熟的正常信号', '不是"做了坏事"，不需要害羞', '教会自己换洗内裤和清洁', '如果孩子不好意思说，可以放一条干净内裤在床边'],
    when: 'G3之前就应该谈到，不要等孩子自己发现后恐慌',
  },
};

/* ── Expandable guidance item ────────────────────────────── */

function GuidanceItem({ text, color, childName, ageLabel, gender }: {
  text: string; color: string; childName: string; ageLabel: string; gender: string;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const detail = DETAIL_MAP[text];
  const hasDetail = !!detail;

  // Build AI advisor URL for this specific guidance item
  const aiUrl = `/advisor?topic=${encodeURIComponent(text.replace(/\s*\[.*?\]\s*/g, ''))}&desc=${encodeURIComponent(`${childName}（${ageLabel}，${gender === 'female' ? '女孩' : '男孩'}）的发育指导`)}&domain=tanner&record=/profile/tanner`;

  return (
    <div className={`${S.radiusSm} overflow-hidden`} style={{ background: color }}>
      <div className="flex items-start gap-2 p-2.5">
        <span className="text-[8px] mt-1.5 shrink-0" style={{ color: S.sub }}>●</span>
        <p className="text-[11px] leading-relaxed flex-1" style={{ color: S.text }}>{text}</p>
        <div className="flex items-center gap-1 shrink-0">
          {hasDetail && (
            <button onClick={() => setShowDetail(!showDetail)}
              className="text-[9px] px-1.5 py-0.5 rounded transition-colors"
              style={showDetail ? { background: S.accent, color: '#fff' } : { background: 'rgba(0,0,0,0.06)', color: S.sub }}>
              {showDetail ? '收起' : '怎么做?'}
            </button>
          )}
          <Link to={aiUrl} title="向AI顾问咨询"
            className="w-5 h-5 rounded flex items-center justify-center transition-colors hover:bg-[rgba(0,0,0,0.08)]"
            style={{ color: '#86AFDA' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </Link>
        </div>
      </div>
      {showDetail && detail && (
        <div className="px-7 pb-3 space-y-2">
          {/* Steps */}
          <div>
            <p className="text-[10px] font-semibold mb-1" style={{ color: S.text }}>具体怎么做：</p>
            {detail.steps.map((step, i) => (
              <p key={i} className="text-[10px] leading-relaxed pl-3 relative" style={{ color: S.sub }}>
                <span className="absolute left-0">{i + 1}.</span> {step}
              </p>
            ))}
          </div>
          {/* Resources */}
          {detail.resources && (
            <div>
              <p className="text-[10px] font-semibold mb-0.5" style={{ color: S.text }}>推荐资源：</p>
              {detail.resources.map((r, i) => (
                <p key={i} className="text-[10px] leading-relaxed" style={{ color: '#86AFDA' }}>📖 {r}</p>
              ))}
            </div>
          )}
          {/* When */}
          {detail.when && (
            <p className="text-[10px]" style={{ color: S.sub }}>
              <span className="font-semibold" style={{ color: S.text }}>什么时候做：</span>{detail.when}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Guidance panel ──────────────────────────────────────── */

function GuidancePanel({ isFemale, latestBG, latestPH }: { isFemale: boolean; latestBG: number | null; latestPH: number | null }) {
  const [expanded, setExpanded] = useState(true);
  const { children, activeChildId } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const ageMonths = child ? computeAgeMonths(child.birthDate) : 0;
  const ageLabel = `${Math.floor(ageMonths / 12)}岁${ageMonths % 12 > 0 ? `${ageMonths % 12}月` : ''}`;

  const currentStage = Math.max(latestBG ?? 1, latestPH ?? 1);
  const guidanceList = isFemale ? FEMALE_GUIDANCE : MALE_GUIDANCE;
  const guidance = guidanceList.find((g) => g.stage === currentStage) ?? guidanceList[0];
  if (!guidance || !child) return null;

  const sections: Array<{ icon: string; title: string; items: string[]; color: string }> = [
    { icon: '💪', title: '身体发育', items: guidance.physical, color: '#e8f5e9' },
    { icon: '🧠', title: '心理引导', items: guidance.psychological, color: '#e3f2fd' },
    { icon: '🥗', title: '营养建议', items: guidance.nutrition, color: '#fff3e0' },
    { icon: '🏥', title: '检查建议', items: guidance.checkups, color: '#fce4ec' },
    { icon: '💡', title: '家长贴士', items: guidance.parentTips, color: '#f3e5f5' },
  ];

  return (
    <div className={`${S.radius} mt-6 overflow-hidden`} style={{ boxShadow: S.shadow }}>
      <button onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
        style={{ background: 'linear-gradient(135deg, #5a7a5a, #7a9a6a)' }}>
        <div>
          <h3 className="text-[14px] font-bold text-white">
            {latestBG ? '当前阶段发育指导' : '发育指导参考'}
          </h3>
          <p className="text-[11px] text-white/60 mt-0.5">
            {guidance.title} · 基于{latestBG ? '最新评估结果' : '青春前期'} · 点击每条建议查看详细指导
          </p>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round"
          className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {expanded && (
        <div className="p-5 space-y-4" style={{ background: S.card }}>
          {sections.map((sec) => (
            <div key={sec.title}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[14px]">{sec.icon}</span>
                <h4 className="text-[12px] font-semibold" style={{ color: S.text }}>{sec.title}</h4>
              </div>
              <div className="space-y-1.5 ml-6">
                {sec.items.map((item, i) => (
                  <GuidanceItem key={i} text={item} color={sec.color}
                    childName={child.displayName} ageLabel={ageLabel} gender={child.gender} />
                ))}
              </div>
            </div>
          ))}
          <div className="pt-3 border-t space-y-1" style={{ borderColor: S.border }}>
            <p className="text-[9px] font-medium" style={{ color: '#8a8f9a' }}>参考文献标注</p>
            <p className="text-[8px]" style={{ color: '#b0b5bc' }}>[A] 中枢性性早熟诊断与治疗专家共识（2022）— 中华儿科杂志 2023;61(1)</p>
            <p className="text-[8px]" style={{ color: '#b0b5bc' }}>[B] 中国居民膳食营养素参考摄入量（2023版）— 中国营养学会</p>
            <p className="text-[8px]" style={{ color: '#b0b5bc' }}>[C] Marshall &amp; Tanner, Arch Dis Child 1969;44:291 (女孩)</p>
            <p className="text-[8px]" style={{ color: '#b0b5bc' }}>[D] Marshall &amp; Tanner, Arch Dis Child 1970;45:13 (男孩)</p>
            <p className="text-[9px] mt-1" style={{ color: '#b0b5bc' }}>以上建议仅供参考，不能替代专业医生的诊断。如有疑虑请咨询儿童内分泌科或青春期门诊。</p>
          </div>
        </div>
      )}
    </div>
  );
}
