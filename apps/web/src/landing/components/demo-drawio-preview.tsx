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
const INITIAL: DiagramNode[] = [
  { label: 'An idea', color: '#e8f0fc' },
  { label: 'Create a draft', color: '#e5f1e7' },
  { label: 'Review together', color: '#fff2d7' },
  { label: 'Share the result', color: '#e8f0fc' },
];

/** A local SVG replica of the draw.io canvas and the adjacent Next AI Draw.io assistant. */
export function DemoDrawioPreview({ content }: { content: RemainingPreviewMeta }) {
  const { pText, pData, pFormat } = useAppPreviewLocale();
  const [history, setHistory] = useState<DiagramNode[][]>(() => pData([INITIAL]));
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState(0);
  const [label, setLabel] = useState(() => pData(INITIAL[0]!.label));
  const [prompt, setPrompt] = useState(() => pData('Add a review step before sharing the result.'));
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
          <img src={content.icon} alt={pText('')} />
          <strong>{pText('Next AI Draw.io')}</strong>
          <span>{pText('Untitled diagram · sample')}</span>
        </div>
        <div>
          <PreviewButton
            aria-label={pText('Undo diagram edit')}
            disabled={revision === 0}
            onClick={() => move(revision - 1)}
          >
            <Undo2 size={16} />
          </PreviewButton>
          <PreviewButton
            aria-label={pText('Redo diagram edit')}
            disabled={revision === history.length - 1}
            onClick={() => move(revision + 1)}
          >
            <Redo2 size={16} />
          </PreviewButton>
          <PreviewButton onClick={() => setShowHistory(!showHistory)}>
            <History size={15} />
            {pText('History')}
          </PreviewButton>
        </div>
      </header>
      <div className="dio-mobile-tabs">
        <PreviewTabs
          items={['Diagram', 'Assistant']}
          value={panel}
          onChange={setPanel}
          label={pText('Editor panels')}
        />
      </div>
      <div className="dio-layout">
        <section className="dio-editor" data-active={panel === 'Diagram'}>
          <div className="dio-canvas-tools">
            <span>
              <Shapes size={16} />
              {pText('General')}
            </span>
            <PreviewButton
              disabled={nodes.length >= 6}
              onClick={() =>
                commit([
                  ...nodes,
                  { label: pFormat('Step {0}', nodes.length + 1), color: '#e5f1e7' },
                ])
              }
            >
              <Plus size={14} />
              {pText('Add sample step')}
            </PreviewButton>
            <div>
              <button
                type="button"
                aria-label={pText('Zoom out')}
                onClick={() => setZoom(Math.max(60, zoom - 20))}
              >
                <ZoomOut size={16} />
              </button>
              <span>
                {pText(zoom)}
                {pText('%')}
              </span>
              <button
                type="button"
                aria-label={pText('Zoom in')}
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
              aria-label={pText('Sample workflow diagram')}
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
                      aria-label={pFormat('Select {0}', node.label)}
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
              {pText('Selected node label')}
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
              {pText('Apply label')}
            </PreviewButton>
          </div>
        </section>
        <aside className="dio-assistant" data-active={panel === 'Assistant'}>
          <h2>
            <MessageSquare size={18} />
            {pText('Diagram assistant')}
          </h2>
          <p>{pText('Describe a change, then explore a saved example.')}</p>
          <div className="dio-chat">
            <span className="rp-badge">{pText('Sample conversation')}</span>
            <h3>{pText('A clear flow, from idea to result')}</h3>
            <p>
              {pText(
                'The canvas contains four editable steps. Select a shape to change its label, or add a sample step from the toolbar.',
              )}
            </p>
            {reply && (
              <article>
                <strong>{pText('Saved suggestion')}</strong>
                <p>
                  {pText(
                    'A review step belongs between creating the draft and sharing it. This example already includes that step; you can rename it on the canvas.',
                  )}
                </p>
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
              aria-label={pText('Diagram request')}
              value={prompt}
              rows={3}
              onChange={(e) => {
                setPrompt(e.target.value);
              }}
            />
            <button
              type="submit"
              aria-label={pText('Show example diagram suggestion')}
              disabled={!prompt.trim()}
            >
              <ArrowUp size={18} />
            </button>
          </form>
          {showHistory && (
            <section className="dio-history">
              <h3>{pText('Local example history')}</h3>
              {history.map((_, i) => (
                <button type="button" key={i} aria-pressed={revision === i} onClick={() => move(i)}>
                  {pText('Revision ')}
                  {pText(i + 1)}
                </button>
              ))}
            </section>
          )}
        </aside>
      </div>
      {showHistory && (
        <div className="dio-history-status" role="status">
          {pText('Revision ')}
          {pText(revision + 1)} {pText(' of ')}
          {pText(history.length)} {pText(' · switch to Assistant to inspect the history.')}
        </div>
      )}
    </RemainingPreview>
  );
}
