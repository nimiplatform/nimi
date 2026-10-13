import type { PreviewTranslate } from '../i18n/preview-messages.js';
import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import { useState } from 'react';
import {
  ArrowUp,
  Check,
  History,
  MessageSquare,
  Plus,
  Redo2,
  Shapes,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { RemainingPreviewMeta } from '../content/landing-content.remaining-apps.js';
import { PreviewButton } from './demo-third-party-shared.js';
import { PreviewTabs, RemainingPreview } from './demo-remaining-shared.js';

type DiagramNode = { label: string; color: string };
const createInitialDiagram = (t: PreviewTranslate): DiagramNode[] => [
  { label: t('drawio.workspace.anIdea'), color: '#e8f0fc' },
  { label: t('drawio.workspace.createADraft'), color: '#e5f1e7' },
  { label: t('drawio.workspace.reviewTogether'), color: '#fff2d7' },
  { label: t('drawio.workspace.shareTheResult'), color: '#e8f0fc' },
];

/** A local SVG replica of the draw.io canvas and the adjacent Next AI Draw.io assistant. */
export function DemoDrawioPreview({ content }: { content: RemainingPreviewMeta }) {
  const { t } = useAppPreviewLocale();
  const [history, setHistory] = useState<DiagramNode[][]>(() => [createInitialDiagram(t)]);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState(0);
  const [label, setLabel] = useState(() => createInitialDiagram(t)[0]!.label);
  const [prompt, setPrompt] = useState(() => t('drawio.workspace.addAReviewStepBeforeSharingThe'));
  const [reply, setReply] = useState(false);
  const [panel, setPanel] = useState('Diagram');
  const [zoom, setZoom] = useState(100);
  const [showHistory, setShowHistory] = useState(false);
  const nodes = history[revision]!;
  const commit = (next: DiagramNode[]) => {
    setHistory((v) => [...v.slice(0, revision + 1), next]);
    setRevision(revision + 1);
  };
  const select = (index: number) => {
    setSelected(index);
    setLabel(nodes[index]!.label);
  };
  const move = (next: number) => {
    setRevision(next);
    const index = Math.min(selected, history[next]!.length - 1);
    setSelected(index);
    setLabel(history[next]![index]!.label);
  };
  return (
    <RemainingPreview content={content} kind="drawio">
      <header className="dio-header">
        <div>
          <img src={content.icon} alt={''} />
          <strong>{t('drawio.header.nextAiDrawIo')}</strong>
          <span>{t('drawio.header.untitledDiagramSample')}</span>
        </div>
        <div>
          <PreviewButton
            aria-label={t('drawio.header.undoDiagramEdit')}
            disabled={revision === 0}
            onClick={() => move(revision - 1)}
          >
            <Undo2 size={16} />
          </PreviewButton>
          <PreviewButton
            aria-label={t('drawio.header.redoDiagramEdit')}
            disabled={revision === history.length - 1}
            onClick={() => move(revision + 1)}
          >
            <Redo2 size={16} />
          </PreviewButton>
          <PreviewButton onClick={() => setShowHistory(!showHistory)}>
            <History size={15} />
            {t('drawio.header.history')}
          </PreviewButton>
        </div>
      </header>
      <div className="dio-mobile-tabs">
        <PreviewTabs
          items={[
            { value: 'Diagram', label: t('drawio.tabs.diagram') },
            { value: 'Assistant', label: t('drawio.tabs.assistant') },
          ]}
          value={panel}
          onChange={setPanel}
          label={t('drawio.workspace.editorPanels')}
        />
      </div>
      <div className="dio-layout">
        <section className="dio-editor" data-active={panel === 'Diagram'}>
          <div className="dio-canvas-tools">
            <span>
              <Shapes size={16} />
              {t('drawio.editor.general')}
            </span>
            <PreviewButton
              disabled={nodes.length >= 6}
              onClick={() =>
                commit([
                  ...nodes,
                  {
                    label: t('drawio.editor.step', { nodesLength1: nodes.length + 1 }),
                    color: '#e5f1e7',
                  },
                ])
              }
            >
              <Plus size={14} />
              {t('drawio.editor.addSampleStep')}
            </PreviewButton>
            <div>
              <button
                type="button"
                aria-label={t('drawio.editor.zoomOut')}
                onClick={() => setZoom(Math.max(60, zoom - 20))}
              >
                <ZoomOut size={16} />
              </button>
              <span>
                {zoom}
                {'%'}
              </span>
              <button
                type="button"
                aria-label={t('drawio.editor.zoomIn')}
                onClick={() => setZoom(Math.min(140, zoom + 20))}
              >
                <ZoomIn size={16} />
              </button>
            </div>
          </div>
          <div className="dio-canvas">
            <svg
              viewBox="0 0 680 540"
              style={{ width: `${zoom}%`, minWidth: `${zoom * 5.4}px` }}
              role="group"
              aria-label={t('drawio.editor.sampleWorkflowDiagram')}
            >
              <defs>
                <marker
                  id="demo-dio-arrow"
                  markerWidth="8"
                  markerHeight="8"
                  refX="7"
                  refY="4"
                  orient="auto"
                >
                  <path d="M0 0 L8 4 L0 8" fill="#7c8795" />
                </marker>
              </defs>
              {nodes.map((node, index) => {
                const x = index % 2 === 0 ? 70 : 390;
                const y = 70 + Math.floor(index / 2) * 160;
                const previousY = 70 + Math.floor((index - 1) / 2) * 160;
                return (
                  <g key={index}>
                    {index > 0 && (
                      <path
                        d={
                          index % 2 === 1
                            ? `M250 ${y + 36} H390`
                            : `M570 ${previousY + 36} H620 V${y - 35} H160 V${y}`
                        }
                        fill="none"
                        stroke="#7c8795"
                        strokeWidth="2"
                        markerEnd="url(#demo-dio-arrow)"
                      />
                    )}
                    <g
                      role="button"
                      tabIndex={0}
                      aria-label={t('drawio.editor.select', { nodeLabel: node.label })}
                      onClick={() => select(index)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          select(index);
                        }
                      }}
                    >
                      <rect
                        x={x}
                        y={y}
                        width="180"
                        height="72"
                        rx="8"
                        fill={node.color}
                        stroke={selected === index ? '#2469cb' : '#8da1b4'}
                        strokeWidth={selected === index ? 3 : 1}
                      />
                      <text x={x + 90} y={y + 41} textAnchor="middle" fontSize="15" fill="#23394c">
                        {node.label.length > 23 ? node.label.slice(0, 21) + '…' : node.label}
                      </text>
                    </g>
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="dio-selection">
            <label>
              {t('drawio.editor.selectedNodeLabel')}
              <input
                value={label}
                maxLength={50}
                onChange={(e) => {
                  setLabel(e.target.value);
                }}
              />
            </label>
            <PreviewButton
              disabled={!label.trim()}
              onClick={() =>
                commit(
                  nodes.map((node, i) =>
                    i === selected ? { ...node, label: label.trim() } : node,
                  ),
                )
              }
            >
              <Check size={14} />
              {t('drawio.editor.applyLabel')}
            </PreviewButton>
          </div>
        </section>
        <aside className="dio-assistant" data-active={panel === 'Assistant'}>
          <h2>
            <MessageSquare size={18} />
            {t('drawio.assistant.diagramAssistant')}
          </h2>
          <p>{t('drawio.assistant.describeAChangeThenExploreASaved')}</p>
          <div className="dio-chat">
            <span className="rp-badge">{t('drawio.assistant.sampleConversation')}</span>
            <h3>{t('drawio.assistant.aClearFlowFromIdeaToResult')}</h3>
            <p>{t('drawio.assistant.theCanvasContainsFourEditableStepsSelect')}</p>
            {reply && (
              <article>
                <strong>{t('drawio.assistant.savedSuggestion')}</strong>
                <p>{t('drawio.assistant.aReviewStepBelongsBetweenCreatingThe')}</p>
              </article>
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setReply(true);
            }}
          >
            <textarea
              aria-label={t('drawio.assistant.diagramRequest')}
              value={prompt}
              rows={3}
              onChange={(e) => {
                setPrompt(e.target.value);
              }}
            />
            <button
              type="submit"
              aria-label={t('drawio.assistant.showExampleDiagramSuggestion')}
              disabled={!prompt.trim()}
            >
              <ArrowUp size={18} />
            </button>
          </form>
          {showHistory && (
            <section className="dio-history">
              <h3>{t('drawio.history.localExampleHistory')}</h3>
              {history.map((_, i) => (
                <button type="button" key={i} aria-pressed={revision === i} onClick={() => move(i)}>
                  {t('drawio.history.revision')}
                  {i + 1}
                </button>
              ))}
            </section>
          )}
        </aside>
      </div>
      {showHistory && (
        <div className="dio-history-status" role="status">
          {t('drawio.workspace.revision')}
          {revision + 1} {t('drawio.workspace.of')}
          {history.length} {t('drawio.workspace.switchToAssistantToInspect')}
        </div>
      )}
    </RemainingPreview>
  );
}
