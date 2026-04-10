import { useState } from 'react';
import { S } from '../../app-shell/page-style.js';

/* ── Guide data ── */

interface GuideSection {
  heading?: string;
  body?: string;
  items?: Array<{ label: string; desc: string; tag?: string }>;
  table?: Array<{ field: string; meaning: string; note: string }>;
  warning?: { title: string; body: string };
}

interface GuideStep {
  title: string;
  sections: GuideSection[];
}

const GUIDE_STEPS: GuideStep[] = [
  {
    title: '为什么要关注体态',
    sections: [
      {
        heading: '体态问题越早发现越好',
        body: '脊柱侧弯、高低肩、驼背等体态问题在儿童快速生长期（6-14 岁）最容易出现和加重。早期发现时，通过运动干预和姿势纠正就能改善；如果发现太晚，可能需要支具甚至手术。',
      },
      {
        heading: '家长可以做什么',
        items: [
          { label: '定期观察', desc: '每 3-6 个月在家做一次简单的体态筛查，记录下来对比变化。', tag: '推荐' },
          { label: '留意信号', desc: '注意孩子是否有歪头写字、坐姿歪斜、书包总往一边滑、衣领一边高等日常表现。', tag: '日常' },
          { label: '配合体检', desc: '学校脊柱筛查结果及时录入，如果有 Cobb 角数据一定要记录。', tag: '重要' },
        ],
      },
    ],
  },
  {
    title: '在家怎么观察',
    sections: [
      {
        heading: '准备工作',
        body: '让孩子穿贴身衣服或裸露背部，自然站立在光线充足的地方。双脚并拢、双臂自然下垂、目视前方。不要刻意挺胸或耸肩。',
      },
      {
        heading: '四步观察法',
        items: [
          {
            label: '① 看肩膀',
            desc: '站在孩子正后方，观察左右肩最高点是否等高。如果一侧明显偏高，记录为"左高"或"右高"。基本齐平就选"对称"。',
            tag: '简单',
          },
          {
            label: '② 看肩胛骨',
            desc: '观察两侧肩胛骨是否对称。一侧突出或翼状隆起，可能提示脊柱旋转。用手机拍照记录。',
            tag: '重要',
          },
          {
            label: '③ 前屈试验（Adam 试验）',
            desc: '让孩子双脚并拢，缓慢弯腰前屈，双手自然下垂。从后方观察背部两侧是否等高。如果一侧明显隆起（"剃刀背"），提示可能有脊柱旋转或侧弯。这是学校筛查最常用的方法。',
            tag: '关键',
          },
          {
            label: '④ 看整体对称',
            desc: '观察头部是否居中、腰线两侧是否对称、骨盆是否等高。从正面看腋窝三角是否对称。',
          },
        ],
      },
      {
        heading: '拍照建议',
        body: '每次观察时从正后方、左侧、右侧各拍一张站立照片，以及一张前屈试验的照片。保持相同距离和角度，方便日后对比。照片可以在"备注"里附上说明。',
      },
    ],
  },
  {
    title: '看懂 Cobb 角',
    sections: [
      {
        heading: '什么是 Cobb 角',
        body: 'Cobb 角是脊柱侧弯最重要的量化指标，由脊柱 X 光片测量得出，表示弯曲的角度大小。数值越大说明侧弯越严重。它不是靠肉眼估计的，必须由医生根据 X 光片测量。',
      },
      {
        heading: 'Cobb 角分级',
        table: [
          { field: '< 10°', meaning: '正常范围', note: '脊柱有轻微不对称是正常的，不需要干预' },
          { field: '10° - 20°', meaning: '轻度侧弯', note: '定期观察，每 6 个月复查一次。加强核心肌群锻炼' },
          { field: '20° - 40°', meaning: '中度侧弯', note: '需要佩戴矫形支具（特别是骨骼未发育完成的儿童），每 3-6 个月复查' },
          { field: '> 40°', meaning: '重度侧弯', note: '可能需要手术干预。需要在专科医院持续随访' },
        ],
      },
      {
        heading: '数据从哪来',
        body: '优先填写学校脊柱筛查单、医院体检报告或骨科评估里的 Cobb 角数值。如果没有做过 X 光检查，这里留空就好——肩部对称性的记录同样有价值。',
      },
    ],
  },
  {
    title: '在家看足弓',
    sections: [
      {
        heading: '为什么要关注足弓',
        body: '足弓是脚底的天然"弹簧"，负责缓冲和支撑。儿童的足弓在 3-6 岁逐渐成型，6 岁前一定程度的扁平足是正常的。但如果 6 岁以后仍然明显扁平、走路容易累、或者出现 X 型腿/内八字，就需要关注了。',
      },
      {
        heading: '湿脚印测试法',
        items: [
          {
            label: '① 准备',
            desc: '准备一张深色纸板或干燥的地砖地面。让孩子光脚踩水，把脚底打湿。',
            tag: '简单',
          },
          {
            label: '② 踩印',
            desc: '让孩子正常站立在纸板上，自然承重，然后抬脚查看脚印。',
          },
          {
            label: '③ 判读',
            desc: '正常足弓：脚印中间部分有明显的弧形缺口（约占脚宽的 1/3 到 1/2）。扁平足：脚印几乎是完整的脚掌形状，中间没有缺口。高弓足：中间缺口过大，只有脚跟和前脚掌有印。',
            tag: '关键',
          },
        ],
      },
      {
        heading: '日常观察要点',
        items: [
          { label: '看鞋底磨损', desc: '正常磨损在脚后跟外侧偏多。如果内侧磨损严重，可能提示扁平足或足外翻。', tag: '日常' },
          { label: '看站姿', desc: '从后方观察孩子站立时，跟腱（脚踝后面的筋）是否垂直。如果明显向内倾斜，提示足外翻。' },
          { label: '问感受', desc: '长时间走路或运动后是否容易脚疼、腿酸？这可能是足弓支撑不足的信号。' },
        ],
      },
      {
        heading: '数据来源',
        body: '体态档案中的足弓状态会自动读取体能评估里的记录，不需要在这里重复录入。如果体能评估里还没有足弓数据，可以先去体能评估页面补录。',
      },
    ],
  },
  {
    title: '什么时候该就医',
    sections: [
      {
        heading: '需要关注的信号',
        items: [
          { label: '前屈试验异常', desc: '弯腰后背部一侧明显隆起，即使很轻微也建议做进一步检查。', tag: '尽早' },
          { label: '肩膀持续不对称', desc: '多次观察都发现明显高低肩，且有加重趋势。', tag: '关注' },
          { label: 'Cobb 角 ≥ 10°', desc: '筛查或体检发现 Cobb 角达到或超过 10°，需要定期随访。', tag: '随访' },
          { label: 'Cobb 角快速增加', desc: '半年内 Cobb 角增加 5° 以上，提示侧弯在进展，需要积极干预。', tag: '紧急' },
          { label: '6 岁后仍明显扁平足', desc: '走路容易累、经常脚疼腿酸、鞋底内侧严重磨损，建议去骨科或足踝外科评估。', tag: '足弓' },
        ],
      },
      {
        heading: '该去哪个科',
        body: '脊柱问题首选骨科或脊柱外科，部分医院设有脊柱侧弯专病门诊。足弓问题可去骨科或足踝外科，也可先去康复科评估，制定运动矫正或矫形鞋垫方案。',
      },
      {
        warning: {
          title: '快速生长期要特别注意',
          body: '青春期前后（女孩 10-14 岁、男孩 12-16 岁）是脊柱侧弯进展最快的时期。如果这个阶段发现侧弯，建议缩短复查间隔到每 3 个月一次。',
        },
      },
    ],
  },
];

/* ── Component ── */

export function PostureGuide({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const current = GUIDE_STEPS[step];
  if (!current) return null;

  return (
    <div className={`${S.radius} mb-5 overflow-hidden`} style={{ boxShadow: S.shadow }}>
      {/* Step header */}
      <div className="px-5 py-4" style={{ background: 'linear-gradient(135deg, #6f8f2c, #94A533)' }}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] text-white/60">体态观察指引</span>
          <button onClick={onClose} className="w-6 h-6 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10">✕</button>
        </div>
        <h3 className="text-[16px] font-bold text-white mb-3">{current.title}</h3>
        {/* Step indicators */}
        <div className="flex items-center gap-1">
          {GUIDE_STEPS.map((_, i) => (
            <button key={i} onClick={() => setStep(i)}
              className={`h-[6px] rounded-full transition-all ${i === step ? 'w-6 bg-white' : 'w-[6px] bg-white/30 hover:bg-white/50'}`} />
          ))}
          <span className="text-[10px] text-white/50 ml-2">{step + 1}/{GUIDE_STEPS.length}</span>
        </div>
      </div>

      {/* Content */}
      <div className="p-5 space-y-5" style={{ background: S.card }}>
        {current.sections.map((sec, si) => (
          <div key={si}>
            {'heading' in sec && sec.heading && (
              <h4 className="text-[13px] font-semibold mb-2" style={{ color: S.text }}>{sec.heading}</h4>
            )}

            {'body' in sec && sec.body && (
              <p className="text-[12px] leading-relaxed" style={{ color: S.sub }}>{sec.body}</p>
            )}

            {'items' in sec && sec.items && (
              <div className="space-y-2">
                {sec.items.map((item, ii) => (
                  <div key={ii} className={`${S.radiusSm} p-3`} style={{ background: '#f8faf9', border: `1px solid ${S.border}` }}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[12px] font-semibold" style={{ color: S.text }}>{item.label}</span>
                      {item.tag && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: '#e8f0e8', color: S.accent }}>{item.tag}</span>
                      )}
                    </div>
                    <p className="text-[11px] leading-relaxed" style={{ color: S.sub }}>{item.desc}</p>
                  </div>
                ))}
              </div>
            )}

            {'table' in sec && sec.table && (
              <div className={`${S.radiusSm} overflow-hidden border`} style={{ borderColor: S.border }}>
                <div className="grid grid-cols-[0.8fr_1fr_1.5fr] text-[10px] font-medium py-2 px-3" style={{ background: '#f8faf9', color: S.sub }}>
                  <span>角度</span><span>分级</span><span>建议</span>
                </div>
                {sec.table.map((row, ri) => (
                  <div key={ri} className="grid grid-cols-[0.8fr_1fr_1.5fr] py-2 px-3 border-t text-[11px]"
                    style={{ borderColor: '#f0f0ec', background: ri % 2 === 0 ? S.card : '#fafcfb' }}>
                    <span className="font-semibold" style={{ color: S.accent }}>{row.field}</span>
                    <span style={{ color: S.text }}>{row.meaning}</span>
                    <span style={{ color: S.sub }}>{row.note}</span>
                  </div>
                ))}
              </div>
            )}

            {'warning' in sec && sec.warning && (
              <div className={`${S.radiusSm} px-4 py-3`} style={{ background: '#fff8e8', border: '1px solid #f3d38a' }}>
                <p className="text-[12px] font-semibold mb-1" style={{ color: S.text }}>{sec.warning.title}</p>
                <p className="text-[11px] leading-relaxed" style={{ color: S.sub }}>{sec.warning.body}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between px-5 py-3" style={{ background: '#f8faf9', borderTop: `1px solid ${S.border}` }}>
        <button onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}
          className="text-[12px] font-medium disabled:opacity-30" style={{ color: S.sub }}>
          ← 上一步
        </button>
        {step < GUIDE_STEPS.length - 1 ? (
          <button onClick={() => setStep(step + 1)}
            className={`px-4 py-1.5 text-[12px] font-medium text-white ${S.radiusSm}`} style={{ background: S.accent }}>
            下一步 →
          </button>
        ) : (
          <button onClick={onClose}
            className={`px-4 py-1.5 text-[12px] font-medium text-white ${S.radiusSm}`} style={{ background: S.accent }}>
            我知道了 ✓
          </button>
        )}
      </div>
    </div>
  );
}
