import { useEffect, useRef, useState } from 'react';
import { useNimiReducedMotion } from '@nimiplatform/kit/ui';
import {
  Check,
  Code2,
  Crosshair,
  Film,
  Lock,
  MoveHorizontal,
  Pause,
  Play,
  Search,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react';
import type { LandingLocale } from '../landing/i18n/locale.js';
import type { CapabilityId } from './platform-capability-samples.js';

export const PHASE1_RICH_CAPABILITIES = new Set<CapabilityId>([
  'text.generate',
  'text.embed',
  'text.decide',
  'text.annotate',
  'image.generate',
  'image.upscale',
  'image.face_swap',
  'vision.locate',
  'video.generate',
  'video.upscale',
  'video.face_swap',
]);

interface BeforeAfterSliderProps {
  beforeSrc: string;
  afterSrc: string;
  beforeAlt: string;
  afterAlt: string;
  beforeLabel: string;
  afterLabel: string;
  dragHint: string;
  ariaLabel: string;
  initialPosition?: number;
  position?: number;
  onPositionChange?: (value: number) => void;
  overlayTopRight?: React.ReactNode;
  overlayBottom?: React.ReactNode;
  className?: string;
}

function BeforeAfterSlider({
  beforeSrc,
  afterSrc,
  beforeAlt,
  afterAlt,
  beforeLabel,
  afterLabel,
  dragHint,
  ariaLabel,
  initialPosition = 50,
  position: controlledPosition,
  onPositionChange,
  overlayTopRight,
  overlayBottom,
  className,
}: BeforeAfterSliderProps) {
  const [internalPosition, setInternalPosition] = useState(initialPosition);
  const [isDragging, setIsDragging] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const grabOffsetPxRef = useRef(0);

  const split = controlledPosition ?? internalPosition;
  const updateSplit = (next: number) => {
    const clamped = Math.max(6, Math.min(94, Math.round(next)));
    if (onPositionChange) onPositionChange(clamped);
    else setInternalPosition(clamped);
  };

  const updateFromClientX = (clientX: number, offsetPx = 0) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const pct = ((clientX - offsetPx - rect.left) / rect.width) * 100;
    updateSplit(pct);
  };

  return (
    <div
      ref={frameRef}
      className={`platform-compare-stage${isDragging ? ' is-dragging' : ''}${className ? ` ${className}` : ''}`}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        const rect = frameRef.current?.getBoundingClientRect();
        if (rect && rect.width > 0) {
          const handleCenterX = rect.left + (split / 100) * rect.width;
          const delta = e.clientX - handleCenterX;
          if (Math.abs(delta) <= 22) {
            grabOffsetPxRef.current = delta;
          } else {
            grabOffsetPxRef.current = 0;
            updateFromClientX(e.clientX, 0);
          }
        }
        e.currentTarget.setPointerCapture(e.pointerId);
        setIsDragging(true);
      }}
      onPointerMove={(e) => {
        if (!isDragging) return;
        updateFromClientX(e.clientX, grabOffsetPxRef.current);
      }}
      onPointerUp={(e) => {
        if (!isDragging) return;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
        grabOffsetPxRef.current = 0;
        setIsDragging(false);
      }}
      onPointerCancel={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
        grabOffsetPxRef.current = 0;
        setIsDragging(false);
      }}
    >
      {/* After (Right / Enhanced) Base Layer */}
      <img src={afterSrc} alt={afterAlt} className="platform-compare-img" draggable={false} />

      {/* Before (Left / Original) Clipped Layer */}
      <img
        src={beforeSrc}
        alt={beforeAlt}
        className="platform-compare-img is-before"
        style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
        draggable={false}
      />

      {/* Divider Line & Handle (compositor translate3d track) */}
      <div
        className="platform-compare-divider-track"
        style={{ transform: `translate3d(${split}%, 0, 0)` }}
        aria-hidden="true"
      >
        <div className="platform-compare-divider">
          <span className="platform-compare-handle">
            <MoveHorizontal size={14} />
          </span>
        </div>
      </div>

      {/* Accessible Range Control (keyboard-focusable, pointer-events: none so pointer capture runs) */}
      <input
        type="range"
        min={6}
        max={94}
        value={split}
        aria-label={ariaLabel}
        className="platform-compare-range"
        onChange={(e) => updateSplit(Number(e.target.value))}
      />

      {/* Corner Badges */}
      <span className="platform-stage-pill is-before-pill">{beforeLabel}</span>
      <span className="platform-stage-pill is-after-pill">{afterLabel}</span>
      {overlayTopRight}
      {overlayBottom ?? (
        <span className="platform-compare-hint">{dragHint}</span>
      )}
    </div>
  );
}

/* ==========================================================================
   1. text.generate — Real Mug Photo + Live Streaming / Strict JSON / Tool Call
   ========================================================================== */
function TextGenerateStage({ locale }: { locale: LandingLocale }) {
  const [tab, setTab] = useState<'reply' | 'json' | 'tool'>('reply');
  const tabOrder = ['reply', 'json', 'tool'] as const;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const isZh = locale === 'zh';

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const idx = tabOrder.indexOf(tab);
    let nextIdx = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextIdx = (idx + 1) % tabOrder.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') nextIdx = (idx - 1 + tabOrder.length) % tabOrder.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = tabOrder.length - 1;
    if (nextIdx >= 0) {
      e.preventDefault();
      setTab(tabOrder[nextIdx]!);
      tabRefs.current[nextIdx]?.focus();
    }
  };

  return (
    <div className="platform-rich-stage platform-stage-vision-text">
      <div className="platform-vision-photo-card">
        <img
          src="/platform/capabilities/text-generate-mug.webp"
          alt={isZh ? '窗边木桌上的橙色陶瓷马克杯实拍图' : 'Glossy orange ceramic mug on a sunlit wooden desk'}
          className="platform-vision-photo"
        />
        <span className="platform-vision-scan-beam" aria-hidden="true" />
        <span className="platform-stage-pill is-tl">IMG · 4:3</span>
        <div className="platform-vision-prompt-chip">
          <span>{isZh ? '提问：描述这个杯子的材质与细节' : 'Prompt: Describe the mug’s material and details'}</span>
        </div>
      </div>

      <div className="platform-vision-output-card">
        <div className="platform-vision-output-bar">
          <div
            className="platform-vision-mode-tabs"
            role="tablist"
            aria-label={isZh ? '切换输出形态' : 'Switch output format'}
            onKeyDown={handleTabKeyDown}
          >
            <button
              ref={(el) => { tabRefs.current[0] = el; }}
              type="button"
              role="tab"
              tabIndex={tab === 'reply' ? 0 : -1}
              aria-selected={tab === 'reply'}
              className={tab === 'reply' ? 'is-active' : undefined}
              onClick={() => setTab('reply')}
            >
              <Sparkles size={12} aria-hidden="true" />
              {isZh ? '自然回答' : 'Stream'}
            </button>
            <button
              ref={(el) => { tabRefs.current[1] = el; }}
              type="button"
              role="tab"
              tabIndex={tab === 'json' ? 0 : -1}
              aria-selected={tab === 'json'}
              className={tab === 'json' ? 'is-active' : undefined}
              onClick={() => setTab('json')}
            >
              <Code2 size={12} aria-hidden="true" />
              {isZh ? '严格 JSON' : 'Strict JSON'}
            </button>
            <button
              ref={(el) => { tabRefs.current[2] = el; }}
              type="button"
              role="tab"
              tabIndex={tab === 'tool' ? 0 : -1}
              aria-selected={tab === 'tool'}
              className={tab === 'tool' ? 'is-active' : undefined}
              onClick={() => setTab('tool')}
            >
              <Wrench size={12} aria-hidden="true" />
              {isZh ? '工具调用' : 'Tool Call'}
            </button>
          </div>
          <span className="platform-live-badge">
            <i aria-hidden="true" />
            {isZh ? '多模态流式' : 'Live Stream'}
          </span>
        </div>

        <div className="platform-vision-output-body">
          {tab === 'reply' && (
            <div className="platform-vision-stream-panel">
              <p className="platform-vision-stream-quote">
                {isZh
                  ? '「这是一只亮橙色陶瓷马克杯，带有高光釉面与圆润的弧形杯把。」'
                  : '“The main object is a bright orange ceramic mug with a curved handle.”'}
                <span className="platform-stream-cursor" aria-hidden="true" />
              </p>
              <p className="platform-vision-stream-sub">
                {isZh
                  ? '杯身映着柔和的晨光窗影，稳稳置于浅色木纹桌面，身旁放着一本摊开的米白横线笔记本。'
                  : 'High-gloss orange ceramic glaze with soft morning window reflections, resting on a warm oak desk beside an open ruled notebook.'}
              </p>
              <div className="platform-vision-attr-pills">
                <span>{isZh ? '主体：橙色陶瓷杯' : 'Object: Ceramic mug'}</span>
                <span>{isZh ? '质感：高光釉面' : 'Finish: Glossy glaze'}</span>
                <span>{isZh ? '形态：弧形把手' : 'Shape: Curved handle'}</span>
              </div>
            </div>
          )}

          {tab === 'json' && (
            <pre className="platform-vision-code-panel">
              <code>{`{
  "object": "ceramic_mug",
  "color": "bright_orange",
  "finish": "glossy_glaze",
  "handle": "curved",
  "surface": "sunlit_oak_desk",
  "confidence": 0.98
}`}</code>
            </pre>
          )}

          {tab === 'tool' && (
            <div className="platform-vision-tool-panel">
              <div className="platform-tool-step">
                <span className="platform-tool-tag">CALL #1 / 64</span>
                <code>desk.catalog_object</code>
              </div>
              <pre className="platform-vision-code-panel is-compact">
                <code>{`{
  "label": "orange ceramic mug",
  "material": "glazed_ceramic",
  "scene": "morning_desk"
}`}</code>
              </pre>
              <div className="platform-tool-result">
                <Check size={13} aria-hidden="true" />
                <span>{isZh ? '结构化参数校验通过 · 已写入应用上下文' : 'Schema verified · Returned to app context'}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   2. text.embed — Realistic Semantic Memory Recall Workbench
   ========================================================================== */
function TextEmbedStage({ locale }: { locale: LandingLocale }) {
  const [queryIdx, setQueryIdx] = useState<0 | 1>(0);
  const isZh = locale === 'zh';

  const queries = isZh
    ? [
        {
          prompt: '怎样把个人 AI 数据留在本地、不上传云端？',
          badge: '0 个字面重合词 · 凭语义首位命中',
          notes: [
            {
              title: '《家庭主机离线部署备忘》',
              snippet: '所有推理与私有目录均锁在 Mac 根目录，不经外部服务器中转。',
              score: '0.7590',
              width: '86%',
              isTop: true,
            },
            {
              title: '《桌面应用权限沙箱设计》',
              snippet: '应用读取记忆前必须经过本机隔离闸门显式授权。',
              score: '0.5124',
              width: '58%',
              isTop: false,
            },
            {
              title: '《周日手冲咖啡豆风味记录》',
              snippet: '浅烘耶加雪菲水温 92°C，前段有明显柑橘与茉莉花香。',
              score: '0.1124',
              width: '14%',
              isTop: false,
            },
          ],
        },
        {
          prompt: '上周去海边看日落时拍的胶片参数',
          badge: '语义跨词联想 · 768 维本地检索',
          notes: [
            {
              title: '《海岸车站黄昏扫街笔记》',
              snippet: '日落前二十分钟逆光，ISO 400 搭配暖调测光保留海面高光。',
              score: '0.8240',
              width: '92%',
              isTop: true,
            },
            {
              title: '《夏末旅行轻装清单》',
              snippet: '定焦镜头、驼色风衣、两卷 35mm 负片和备用电池。',
              score: '0.4680',
              width: '52%',
              isTop: false,
            },
            {
              title: '《家庭主机离线部署备忘》',
              snippet: '所有推理与私有目录均锁在 Mac 根目录，不经外部服务器中转。',
              score: '0.0940',
              width: '11%',
              isTop: false,
            },
          ],
        },
      ]
    : [
        {
          prompt: 'How do I keep personal AI context offline without cloud sync?',
          badge: 'Zero exact keywords · Matched by meaning',
          notes: [
            {
              title: 'Local Host Privacy Notes',
              snippet: 'Keep inference and private storage pinned to your home machine directory.',
              score: '0.7590',
              width: '86%',
              isTop: true,
            },
            {
              title: 'App Storage Partition Spec',
              snippet: 'Every app declares required scopes before accessing local memory.',
              score: '0.5124',
              width: '58%',
              isTop: false,
            },
            {
              title: 'Sunday Pour-Over Coffee Log',
              snippet: 'Light-roast Ethiopian beans at 92°C with bright citrus aroma.',
              score: '0.1124',
              width: '14%',
              isTop: false,
            },
          ],
        },
        {
          prompt: 'Film settings from last week’s coastal sunset walk',
          badge: 'Cross-phrase recall · 768-dim local vector',
          notes: [
            {
              title: 'Seaside Station Golden Hour Log',
              snippet: 'Shot backlit twenty minutes before dusk at ISO 400 to hold ocean highlights.',
              score: '0.8240',
              width: '92%',
              isTop: true,
            },
            {
              title: 'Late Summer Travel Packing List',
              snippet: 'Prime lens, camel coat, two rolls of 35mm negative film, spare battery.',
              score: '0.4680',
              width: '52%',
              isTop: false,
            },
            {
              title: 'Local Host Privacy Notes',
              snippet: 'Keep inference and private storage pinned to your home machine directory.',
              score: '0.0940',
              width: '11%',
              isTop: false,
            },
          ],
        },
      ];

  const active = queries[queryIdx]!;

  return (
    <div className="platform-rich-stage platform-stage-embed">
      <div className="platform-embed-searchbar">
        <Search size={15} className="platform-embed-search-icon" aria-hidden="true" />
        <span className="platform-embed-query">{active.prompt}</span>
        <div className="platform-sheet-tabs" role="group" aria-label={isZh ? '切换检索示例' : 'Switch query preset'}>
          <button
            type="button"
            aria-pressed={queryIdx === 0}
            className={queryIdx === 0 ? 'is-active' : undefined}
            onClick={() => setQueryIdx(0)}
          >
            {isZh ? '隐私记忆' : 'Privacy'}
          </button>
          <button
            type="button"
            aria-pressed={queryIdx === 1}
            className={queryIdx === 1 ? 'is-active' : undefined}
            onClick={() => setQueryIdx(1)}
          >
            {isZh ? '胶片笔记' : 'Film log'}
          </button>
        </div>
      </div>

      <div className="platform-embed-note-list">
        {active.notes.map((note, idx) => (
          <div key={`${queryIdx}-${note.title}`} className={`platform-embed-note-card${note.isTop ? ' is-top' : ''}`}>
            <span className="platform-embed-note-rank">0{idx + 1}</span>
            <div className="platform-embed-note-copy">
              <strong>{note.title}</strong>
              <p>{note.snippet}</p>
            </div>
            <div className="platform-embed-note-score">
              <code>{note.score}</code>
              <div className="platform-embed-mini-track" aria-hidden="true">
                <i style={{ transform: `scaleX(${Math.max(0, Math.min(1, parseFloat(note.width) / 100 || 0))})` }} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="platform-sheet-footer">
        <span className="platform-sheet-status">
          <i aria-hidden="true" />
          {active.badge}
        </span>
        <code>768-dim · cosine</code>
      </div>
    </div>
  );
}

/* ==========================================================================
   3. text.decide — Calibrated Decision Matrix Workbench
   ========================================================================== */
function TextDecideStage({ locale }: { locale: LandingLocale }) {
  const [caseIdx, setCaseIdx] = useState<0 | 1>(0);
  const isZh = locale === 'zh';

  const scenarios = isZh
    ? [
        {
          tab: '隐私票据整理',
          contextLabel: '场景',
          context: '整理家庭财务票据，电脑算力空闲，要求资料不传上网',
          options: [
            { id: 'A', label: '直接在本机离线处理', reason: '资料不出电脑 · 响应快 · 零额外费用', prob: '74.2%', pct: 74.2, best: true },
            { id: 'B', label: '先隐藏敏感信息再连云端', reason: '多一步脱敏处理，且受网络速度影响', prob: '19.8%', pct: 19.8, best: false },
            { id: 'C', label: '留到晚上空闲时统一处理', reason: '现在看不到结果，等待时间太长', prob: '6.0%', pct: 6.0, best: false },
          ],
        },
        {
          tab: '视频多任务排期',
          contextLabel: '场景',
          context: '剪辑视频时，同时需要写分镜脚本和做 4K 高清修复',
          options: [
            { id: 'A', label: '错峰运行脚本生成与 4K 修复', reason: '不互相挤占显存，整体完成最快', prob: '81.5%', pct: 81.5, best: true },
            { id: 'B', label: '做完一项再等下一项', reason: '稳妥但总耗时多出两倍以上', prob: '14.5%', pct: 14.5, best: false },
            { id: 'C', label: '降低画质到 720p 快速导出', reason: '画面不够清晰，达不到成片标准', prob: '4.0%', pct: 4.0, best: false },
          ],
        },
      ]
    : [
        {
          tab: 'Private Receipts',
          contextLabel: 'Scenario',
          context: 'Sorting personal tax receipts with idle local compute and strict privacy',
          options: [
            { id: 'A', label: 'Run strictly offline on this computer', reason: 'Files stay local · instant response · zero extra fee', prob: '74.2%', pct: 74.2, best: true },
            { id: 'B', label: 'Mask sensitive details, then use cloud', reason: 'Extra redaction step and depends on network speed', prob: '19.8%', pct: 19.8, best: false },
            { id: 'C', label: 'Queue for overnight processing', reason: 'No immediate result while you are working', prob: '6.0%', pct: 6.0, best: false },
          ],
        },
        {
          tab: 'Video Workflow',
          contextLabel: 'Scenario',
          context: 'Editing a video that needs both storyboard scripting and 4K upscaling',
          options: [
            { id: 'A', label: 'Stagger scripting and 4K upscaling', reason: 'Avoids GPU contention and finishes fastest overall', prob: '81.5%', pct: 81.5, best: true },
            { id: 'B', label: 'Run strictly one task after another', reason: 'Safe, but more than doubles total wait time', prob: '14.5%', pct: 14.5, best: false },
            { id: 'C', label: 'Downgrade export to 720p for speed', reason: 'Too blurry for the target 4K finish', prob: '4.0%', pct: 4.0, best: false },
          ],
        },
      ];

  const active = scenarios[caseIdx]!;

  return (
    <div className="platform-rich-stage platform-stage-decide">
      <div className="platform-decide-header">
        <p>
          <span className="platform-decide-context-label">{active.contextLabel}</span>
          {active.context}
        </p>
        <div className="platform-sheet-tabs" role="group" aria-label={isZh ? '切换决策场景' : 'Switch scenario'}>
          {scenarios.map((item, idx) => (
            <button
              key={item.tab}
              type="button"
              aria-pressed={caseIdx === idx}
              className={caseIdx === idx ? 'is-active' : undefined}
              onClick={() => setCaseIdx(idx as 0 | 1)}
            >
              {item.tab}
            </button>
          ))}
        </div>
      </div>

      <div className="platform-decide-cards">
        {active.options.map((opt) => (
          <div key={opt.id} className={`platform-decide-row${opt.best ? ' is-winner' : ''}`}>
            <span className="platform-decide-option-id">{opt.id}</span>
            <div className="platform-decide-copy">
              <div className="platform-decide-title">
                <strong>{opt.label}</strong>
                {opt.best && (
                  <span className="platform-decide-badge">
                    <Check size={12} aria-hidden="true" />
                    {isZh ? '推荐首选' : 'Top Pick'}
                  </span>
                )}
              </div>
              <p className="platform-decide-reason">{opt.reason}</p>
            </div>
            <div className="platform-decide-meter">
              <code className="platform-decide-prob">{opt.prob}</code>
              <div className="platform-decide-track" aria-hidden="true">
                <i style={{ transform: `scaleX(${opt.pct / 100})` }} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="platform-sheet-footer">
        <span className="platform-sheet-status">
          <i aria-hidden="true" />
          {isZh ? '各选项把握度合计 100% · 自动锁定首选' : 'Confidence scores sum to 100% · Top pick locked'}
        </span>
        <code>{isZh ? '同样条件，稳定给出一致判断' : 'Consistent picks on repeat runs'}</code>
      </div>
    </div>
  );
}

/* ==========================================================================
   4. text.annotate — Real Train Platform Cinema Frame + Subtitle Clause Split
   ========================================================================== */
function TextAnnotateStage({ locale }: { locale: LandingLocale }) {
  const [mode, setMode] = useState<'semantic' | 'naive'>('semantic');
  const isZh = locale === 'zh';

  const tokens = [
    { word: 'The next', pos: 'DET · ADJ', root: false },
    { word: 'train', pos: 'NOUN · ROOT', root: true },
    { word: 'leaves', pos: 'VERB · PRED', root: false },
    { word: 'at 10:00.', pos: 'PREP · TIME', root: false },
  ];

  return (
    <div className="platform-rich-stage platform-stage-annotate">
      <div className="platform-annotate-cinema">
        <img
          src="/platform/capabilities/text-annotate-train.webp"
          alt={isZh ? '显示十点整的欧洲火车站站台电影画面' : 'Sunlit European train platform with a 10:00 station clock'}
          className="platform-annotate-still"
        />
        <div className="platform-annotate-top-controls">
          <span className="platform-stage-pill is-dark">
            <Film size={11} aria-hidden="true" />
            VideoLingo · Offline
          </span>
          <div className="platform-annotate-toggle" role="group" aria-label={isZh ? '对比字幕断句方式' : 'Compare subtitle split'}>
            <button
              type="button"
              aria-pressed={mode === 'semantic'}
              className={mode === 'semantic' ? 'is-active' : undefined}
              onClick={() => setMode('semantic')}
            >
              {isZh ? '自然语义断句 ✓' : 'Semantic Split ✓'}
            </button>
            <button
              type="button"
              aria-pressed={mode === 'naive'}
              className={mode === 'naive' ? 'is-active is-warn' : undefined}
              onClick={() => setMode('naive')}
            >
              {isZh ? '机械字数硬切 ✗' : 'Hard Wrap ✗'}
            </button>
          </div>
        </div>

        <div className={`platform-annotate-subtitle${mode === 'naive' ? ' is-naive' : ''}`}>
          {mode === 'semantic' ? (
            <>
              <span lang="en">A green notebook is on the table. / The next train leaves at 10:00.</span>
              <small>{isZh ? '绿色笔记本放在桌上。 / 下一班火车十点整发车。' : 'Clean clause break between complete thoughts — never mid-phrase.'}</small>
            </>
          ) : (
            <>
              <span lang="en">A green notebook is on the / table. The next train / leaves at 10:00.</span>
              <small>{isZh ? '按固定字数硬截断，介词短语被拦腰劈成两行字幕' : 'Fixed character wrap slices prepositional phrases across captions.'}</small>
            </>
          )}
        </div>
      </div>

      <div className="platform-annotate-tokens">
        {tokens.map((tk) => (
          <div key={tk.word} className={`platform-annotate-chip${tk.root ? ' is-root' : ''}`}>
            <strong>{tk.word}</strong>
            <small>{tk.pos}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ==========================================================================
   5. image.generate — Real Blue Mug -> Warm Terracotta Orange Mug Edit Slider
   ========================================================================== */
function ImageGenerateStage({ locale }: { locale: LandingLocale }) {
  const [split, setSplit] = useState(53);
  const isZh = locale === 'zh';

  return (
    <div className="platform-rich-stage platform-stage-media-full">
      <BeforeAfterSlider
        className="is-mug-recolor"
        beforeSrc="/platform/capabilities/image-generate-blue.webp"
        afterSrc="/platform/capabilities/image-generate-orange.webp"
        beforeAlt={isZh ? '窗边大理石台面上的蓝色陶瓷杯' : 'Cobalt-blue ceramic mug on sunlit marble windowsill'}
        afterAlt={isZh ? '保持窗景光影不变、局部改色为暖橙色的陶瓷杯' : 'Same sunlit windowsill with only the mug recolored to warm orange'}
        beforeLabel={isZh ? 'Step 1 · 文生图（蓝杯）' : 'Step 1 · Generated (Blue)'}
        afterLabel={isZh ? 'Step 2 · 局部改色（暖橙）' : 'Step 2 · Local Edit (Orange)'}
        dragHint={isZh ? '左右拖动对比：窗景、叶影与杯把分毫不差' : 'Drag to compare: window light, shadows & handle stay intact'}
        ariaLabel={isZh ? '拖动对比文生图与局部改色前后效果' : 'Drag slider to compare generated blue mug and local orange edit'}
        position={split}
        onPositionChange={setSplit}
        overlayBottom={(
          <div className="platform-compare-quickbar" role="group" aria-label={isZh ? '快速对比视角' : 'Quick compare presets'}>
            <button type="button" aria-pressed={split >= 88} className={split >= 88 ? 'is-active' : undefined} onClick={() => setSplit(92)}>
              {isZh ? '看蓝色原图' : 'Blue Original'}
            </button>
            <button type="button" aria-pressed={split > 15 && split < 88} className={split > 15 && split < 88 ? 'is-active' : undefined} onClick={() => setSplit(53)}>
              {isZh ? '分屏对比' : 'Split View'}
            </button>
            <button type="button" aria-pressed={split <= 15} className={split <= 15 ? 'is-active' : undefined} onClick={() => setSplit(8)}>
              {isZh ? '看暖橙成图' : 'Orange Edit'}
            </button>
          </div>
        )}
      />
    </div>
  );
}

/* ==========================================================================
   6. image.upscale — Real 1x Blurry vs 4x 4K Macro Texture Slider
   ========================================================================== */
function ImageUpscaleStage({ locale }: { locale: LandingLocale }) {
  const [split, setSplit] = useState(48);
  const isZh = locale === 'zh';

  return (
    <div className="platform-rich-stage platform-stage-media-full">
      <BeforeAfterSlider
        beforeSrc="/platform/capabilities/image-upscale-1x.webp"
        afterSrc="/platform/capabilities/image-upscale-4k.webp"
        beforeAlt={isZh ? '1倍低分辨率模糊茶杯与蕨叶原图' : '1x low-resolution blurry stoneware teacup and fern leaf'}
        afterAlt={isZh ? '本机4倍超清重建后的4K茶杯釉面、亚麻织纹与露珠细节' : '4x locally upscaled 4K teacup showing glaze speckles, linen weave, and fern dewdrops'}
        beforeLabel={isZh ? '1× 低清输入' : '1× Low-Res Input'}
        afterLabel={isZh ? '4× 本机超清 · 4096 px' : '4× Local GPU · 4096 px'}
        dragHint={isZh ? '拖动滑块，细看陶杯釉点、亚麻织纹与蕨叶露珠重建' : 'Drag slider to inspect ceramic speckles, linen weave & dewdrops'}
        ariaLabel={isZh ? '拖动滑块对比 1x 原图与 4x 超清画质' : 'Drag slider to compare 1x input against 4x upscaled output'}
        position={split}
        onPositionChange={setSplit}
      />
    </div>
  );
}

/* ==========================================================================
   7. image.face_swap — Reference Portrait + Storyboard Scene -> Local Fusion
   ========================================================================== */
function ImageFaceSwapStage({ locale }: { locale: LandingLocale }) {
  const [view, setView] = useState<'fused' | 'target'>('fused');
  const isZh = locale === 'zh';

  return (
    <div className="platform-rich-stage platform-stage-faceswap">
      <div className="platform-faceswap-inputs">
        <figure className="platform-faceswap-input-card">
          <img
            src="/platform/capabilities/faceswap-ref.webp"
            alt={isZh ? '参考人物正面棚拍肖像' : 'Reference studio portrait headshot'}
          />
          <figcaption>{isZh ? '参考人像' : 'Ref Portrait'}</figcaption>
        </figure>
        <span className="platform-faceswap-plus" aria-hidden="true">+</span>
        <figure className="platform-faceswap-input-card">
          <img
            src="/platform/capabilities/faceswap-scene.webp"
            alt={isZh ? '海边日落车站分镜原图' : 'Golden-hour coastal station storyboard frame'}
          />
          <figcaption>{isZh ? '目标分镜' : 'Target Scene'}</figcaption>
        </figure>
      </div>

      <div className="platform-faceswap-hero">
        <img
          src={view === 'fused' ? '/platform/capabilities/faceswap-result.webp' : '/platform/capabilities/faceswap-scene.webp'}
          alt={
            view === 'fused'
              ? (isZh ? '本机自然光影人像融合后的海边车站成片' : 'On-device identity-fused golden-hour coastal station frame')
              : (isZh ? '融合前的原始分镜画面' : 'Original storyboard scene before fusion')
          }
          className="platform-faceswap-hero-img"
        />
        <span className="platform-stage-pill is-tl is-emerald">
          <Lock size={11} aria-hidden="true" />
          {isZh ? '100% 本机融合 · 照片不出电脑' : '100% On-Device · Zero Upload'}
        </span>
        <div className="platform-compare-quickbar" role="group" aria-label={isZh ? '切换融合前后视图' : 'Switch original vs blended frame'}>
          <button type="button" aria-pressed={view === 'target'} className={view === 'target' ? 'is-active' : undefined} onClick={() => setView('target')}>
            {isZh ? '原始分镜' : 'Original Scene'}
          </button>
          <button type="button" aria-pressed={view === 'fused'} className={view === 'fused' ? 'is-active' : undefined} onClick={() => setView('fused')}>
            {isZh ? '本机融合结果' : 'Local Blended PNG'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   8. vision.locate — Real Tabletop Photo + Interactive Grounding Reticle
   ========================================================================== */
const LOCATE_TARGETS = [
  {
    id: 'mug',
    label: { zh: '蓝色陶瓷杯', en: 'Blue ceramic mug' },
    coords: '[0.501, 0.655]',
    box: { left: 46.6, top: 51.8, width: 26.2, height: 25.8 },
    point: { x: 56.5, y: 64.7 },
  },
  {
    id: 'notebook',
    label: { zh: '绿色笔记本', en: 'Green notebook' },
    coords: '[0.296, 0.204]',
    box: { left: 10.8, top: 1.2, width: 37.4, height: 38.6 },
    point: { x: 29.6, y: 20.4 },
  },
  {
    id: 'glasses',
    label: { zh: '玳瑁眼镜', en: 'Eyeglasses' },
    coords: '[0.729, 0.230]',
    box: { left: 60.0, top: 12.0, width: 25.8, height: 22.2 },
    point: { x: 72.9, y: 23.0 },
  },
  {
    id: 'succulent',
    label: { zh: '多肉盆栽', en: 'Succulent pot' },
    coords: '[0.202, 0.623]',
    box: { left: 9.0, top: 48.6, width: 22.4, height: 27.2 },
    point: { x: 20.2, y: 62.3 },
  },
] as const;

function VisionLocateStage({ locale }: { locale: LandingLocale }) {
  const [targetId, setTargetId] = useState<(typeof LOCATE_TARGETS)[number]['id']>('mug');
  const active = LOCATE_TARGETS.find((item) => item.id === targetId) ?? LOCATE_TARGETS[0];
  const isZh = locale === 'zh';

  return (
    <div className="platform-rich-stage platform-stage-locate">
      <div className="platform-locate-sidebar">
        <div className="platform-locate-prompt">
          <Crosshair size={13} aria-hidden="true" />
          <span>{isZh ? '点选自然语言目标' : 'Click target phrase'}</span>
        </div>
        <div className="platform-locate-chips" role="group" aria-label={isZh ? '选择画面定位目标' : 'Select object to locate'}>
          {LOCATE_TARGETS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={item.id === targetId}
              className={item.id === targetId ? 'is-active' : undefined}
              onClick={() => setTargetId(item.id)}
            >
              <span>{item.label[locale]}</span>
              <code>{item.coords}</code>
            </button>
          ))}
        </div>
        <div className="platform-locate-readout">
          <small>{isZh ? '锁定坐标 (归一化)' : 'Locked Coords (Norm)'}</small>
          <strong>{active.coords}</strong>
        </div>
      </div>

      <div className="platform-locate-canvas-wrap">
        <div className="platform-locate-frame">
          <img
            src="/platform/capabilities/vision-locate-desk.webp"
            alt={isZh ? '摆放着蓝色陶瓷杯、绿色笔记本、眼镜与多肉盆栽的阳光木桌俯拍图' : 'Top-angle sunlit wooden desk with blue ceramic mug, green notebook, eyeglasses, and succulent'}
            className="platform-locate-img"
          />
          <span className="platform-locate-guide-h" style={{ top: `${active.point.y}%` }} aria-hidden="true" />
          <span className="platform-locate-guide-v" style={{ left: `${active.point.x}%` }} aria-hidden="true" />
          <div
            className="platform-locate-bbox"
            style={{
              left: `${active.box.left}%`,
              top: `${active.box.top}%`,
              width: `${active.box.width}%`,
              height: `${active.box.height}%`,
            }}
          >
            <span className="platform-locate-tag">
              {active.label[locale]} · {active.coords}
            </span>
          </div>
          <span
            className="platform-locate-dot"
            style={{ left: `${active.point.x}%`, top: `${active.point.y}%` }}
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
  );
}

function formatVideoSeconds(sec: number): string {
  const safe = Number.isFinite(sec) && sec > 0 ? sec : 0;
  const mins = Math.floor(safe / 60);
  const rem = safe - mins * 60;
  return `${String(mins).padStart(2, '0')}:${rem < 10 ? '0' : ''}${rem.toFixed(1)}`;
}

/* ==========================================================================
   9. video.generate — Real 4-Second Looping Cinema Clip + Controls
   ========================================================================== */
function VideoGenerateStage({ locale }: { locale: LandingLocale }) {
  const reducedMotion = useNimiReducedMotion();
  const [isPlaying, setIsPlaying] = useState(!reducedMotion);
  const [progress, setProgress] = useState(0);
  const [currentSec, setCurrentSec] = useState(0);
  const [durationSec, setDurationSec] = useState(5.0);
  const [scrubbing, setScrubbing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const isZh = locale === 'zh';

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (reducedMotion) {
      el.pause();
      setIsPlaying(false);
    }
  }, [reducedMotion]);

  const togglePlay = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play().catch(() => {});
      setIsPlaying(true);
    } else {
      el.pause();
      setIsPlaying(false);
    }
  };

  const seekToSeconds = (targetSec: number) => {
    const el = videoRef.current;
    const total = el && Number.isFinite(el.duration) && el.duration > 0 ? el.duration : durationSec;
    const clamped = Math.max(0, Math.min(total, targetSec));
    if (el && Number.isFinite(el.duration) && el.duration > 0) {
      el.currentTime = clamped;
    }
    setCurrentSec(clamped);
    setProgress(total > 0 ? Math.min(1, clamped / total) : 0);
  };

  const seekFromClientX = (clientX: number) => {
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const el = videoRef.current;
    const total = el && Number.isFinite(el.duration) && el.duration > 0 ? el.duration : durationSec;
    seekToSeconds(frac * total);
  };

  return (
    <div className="platform-rich-stage platform-stage-video-gen">
      <video
        ref={videoRef}
        src="/platform/capabilities/video-generate-boat.mp4"
        poster="/platform/capabilities/video-generate-boat.webp"
        className="platform-video-player"
        autoPlay={!reducedMotion}
        loop
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDurationSec(d);
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          const d = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : durationSec;
          if (Number.isFinite(el.duration) && el.duration > 0 && el.duration !== durationSec) {
            setDurationSec(el.duration);
          }
          setCurrentSec(el.currentTime);
          setProgress(Math.min(1, el.currentTime / d));
        }}
        aria-label={isZh ? '蓝色水面上轻轻漂浮的红纸船动态视频预览' : 'Looping motion preview of a red paper boat drifting on cerulean water'}
      />
      <span className="platform-stage-pill is-tl is-dark">
        <span className="platform-rec-dot" aria-hidden="true" />
        {isZh ? '提示词：蓝色水面上轻轻漂浮的红纸船' : 'Prompt: Red paper boat drifting on blue water'}
      </span>
      <span className="platform-stage-pill is-tr is-dark">512 × 288 · 30fps MP4</span>

      <div className="platform-video-hud">
        <button
          type="button"
          className="platform-video-playbtn"
          aria-label={isPlaying ? (isZh ? '暂停预览' : 'Pause preview') : (isZh ? '播放预览' : 'Play preview')}
          onClick={togglePlay}
        >
          {isPlaying ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
        </button>
        <div
          ref={timelineRef}
          className="platform-video-timeline"
          role="slider"
          tabIndex={0}
          aria-label={isZh ? '视频播放进度' : 'Video playback timeline'}
          aria-valuemin={0}
          aria-valuemax={Math.round(durationSec * 10) / 10}
          aria-valuenow={Math.round(currentSec * 10) / 10}
          aria-valuetext={`${formatVideoSeconds(currentSec)} / ${formatVideoSeconds(durationSec)}`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setScrubbing(true);
            seekFromClientX(e.clientX);
          }}
          onPointerMove={(e) => {
            if (!scrubbing) return;
            seekFromClientX(e.clientX);
          }}
          onPointerUp={(e) => {
            if (!scrubbing) return;
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
            setScrubbing(false);
          }}
          onPointerCancel={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
            setScrubbing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
              e.preventDefault();
              seekToSeconds(currentSec + 0.5);
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
              e.preventDefault();
              seekToSeconds(currentSec - 0.5);
            } else if (e.key === 'Home') {
              e.preventDefault();
              seekToSeconds(0);
            } else if (e.key === 'End') {
              e.preventDefault();
              seekToSeconds(durationSec);
            } else if (e.key === ' ') {
              e.preventDefault();
              togglePlay();
            }
          }}
        >
          <span
            className="platform-video-progress-live"
            style={{ transform: `scaleX(${Math.max(0.02, progress)})` }}
          />
        </div>
        <code className="platform-video-tc">
          {formatVideoSeconds(currentSec)} / {formatVideoSeconds(durationSec)}
        </code>
      </div>
    </div>
  );
}

/* ==========================================================================
   10. video.upscale — Real 1x vs 4K Temporal Coastal Train Split Slider
   ========================================================================== */
function VideoUpscaleStage({ locale }: { locale: LandingLocale }) {
  const [split, setSplit] = useState(50);
  const isZh = locale === 'zh';

  return (
    <div className="platform-rich-stage platform-stage-media-full">
      <BeforeAfterSlider
        beforeSrc="/platform/capabilities/video-upscale-1x.webp"
        afterSrc="/platform/capabilities/video-upscale-4k.webp"
        beforeAlt={isZh ? '低清模糊的海岸列车视频帧' : 'Low-resolution blurred coastal train video frame'}
        afterAlt={isZh ? '跨帧无闪烁 4K 超清修复后的海岸列车、松针与海浪细节' : '4K temporally upscaled coastal train frame with crisp foliage and sea foam'}
        beforeLabel={isZh ? '1× 低清原片' : '1× Source Frame'}
        afterLabel={isZh ? '4× 跨帧超清 · 4K' : '4× Temporal · 4K'}
        dragHint={isZh ? '拖动滑块对比松针、石墙与海浪纹理' : 'Drag slider to compare coastal pines, masonry & sea foam'}
        ariaLabel={isZh ? '拖动滑块对比视频 1x 原片与 4K 超清帧' : 'Drag slider to compare 1x source frame and 4K upscaled video frame'}
        position={split}
        onPositionChange={setSplit}
        overlayBottom={(
          <div className="platform-video-upscale-hud">
            <span className="platform-video-sync-chip">
              <i aria-hidden="true" />
              {isZh ? '300 帧跨帧防闪烁 · AAC 原声严丝合缝' : '300 frames flicker-free · AAC audio locked'}
            </span>
            <code>24fps · 4K MP4</code>
          </div>
        )}
      />
    </div>
  );
}

/* ==========================================================================
   11. video.face_swap — Live 720p Dual-Monitor Expression Reenactment
   ========================================================================== */
function VideoFaceSwapStage({ locale }: { locale: LandingLocale }) {
  const isZh = locale === 'zh';

  return (
    <div className="platform-rich-stage platform-stage-video-faceswap">
      <figure className="platform-live-monitor">
        <img
          src="/platform/capabilities/video-faceswap-driver.webp"
          alt={isZh ? '本机摄像头实时驱动画面输入' : 'Live local camera driver expression feed'}
        />
        <span className="platform-stage-pill is-tl is-dark">
          {isZh ? '驱动输入 · 本机镜头' : 'Driver · Local Cam'}
        </span>
        <span className="platform-monitor-caption">{isZh ? '同步捕捉口型、眨眼与微表情' : 'Tracks lip sync, gaze & head pose'}</span>
      </figure>

      <div className="platform-live-bridge" aria-hidden="true">
        <span className="platform-live-bridge-line" />
        <code>&lt;18ms</code>
        <span className="platform-live-bridge-line" />
      </div>

      <figure className="platform-live-monitor is-output">
        <img
          src="/platform/capabilities/video-faceswap-live.webp"
          alt={isZh ? '720p 实时表情重演输出画面' : 'Live 720p real-time expression reenactment output'}
        />
        <span className="platform-stage-pill is-tl is-emerald">
          <span className="platform-rec-dot" aria-hidden="true" />
          LIVE · 1280 × 720 RGB8
        </span>
        <span className="platform-monitor-caption is-secure">
          <ShieldCheck size={12} aria-hidden="true" />
          {isZh ? '关窗即清 · 0 缓存帧留存' : 'Zero cached frames on close'}
        </span>
      </figure>
    </div>
  );
}

export function PlatformCapabilityRichStage({
  capability,
  locale,
}: {
  capability: CapabilityId;
  locale: LandingLocale;
}) {
  switch (capability) {
    case 'text.generate':
      return <TextGenerateStage locale={locale} />;
    case 'text.embed':
      return <TextEmbedStage locale={locale} />;
    case 'text.decide':
      return <TextDecideStage locale={locale} />;
    case 'text.annotate':
      return <TextAnnotateStage locale={locale} />;
    case 'image.generate':
      return <ImageGenerateStage locale={locale} />;
    case 'image.upscale':
      return <ImageUpscaleStage locale={locale} />;
    case 'image.face_swap':
      return <ImageFaceSwapStage locale={locale} />;
    case 'vision.locate':
      return <VisionLocateStage locale={locale} />;
    case 'video.generate':
      return <VideoGenerateStage locale={locale} />;
    case 'video.upscale':
      return <VideoUpscaleStage locale={locale} />;
    case 'video.face_swap':
      return <VideoFaceSwapStage locale={locale} />;
    default:
      return null;
  }
}
