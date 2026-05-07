import { Surface } from '@nimiplatform/nimi-kit/ui';
import type { ContextualPrompt } from './orthodontic-derive.js';
import { S } from '../../app-shell/page-style.js';

interface Props {
  prompts: ContextualPrompt[];
  onPromptClick: (prompt: ContextualPrompt) => void;
}

/**
 * Contextual prompt strip. Shows up to 3 prompts at once, sorted by priority.
 * Empty list = card hidden entirely (the parent surface composes around it).
 *
 * All headlines/bodies are deterministic strings produced by
 * `computeContextualPrompts` (PO-ORTHO-010 fact-restatement / descriptive
 * trend wording). No AI inference at this surface.
 */
export function OrthodonticPromptsCard({ prompts, onPromptClick }: Props) {
  if (prompts.length === 0) return null;
  const visible = prompts.slice(0, 3);
  return (
    <Surface
      as="section"
      material="solid"
      padding="none"
      tone="card"
      className="rounded-[20px] p-5"
      style={{
        background:
          'linear-gradient(135deg, rgba(248,250,252,1) 0%, rgba(241,245,249,1) 100%)',
        boxShadow: '0 1px 4px rgba(15,23,42,0.04)',
        border: '1px solid rgba(226,232,240,0.7)',
      }}
    >
      <p className="text-[12px] uppercase tracking-[0.08em]" style={{ color: S.sub }}>
        你可能需要记录的
      </p>
      <ul className="mt-3 flex flex-col gap-2.5" role="list">
        {visible.map((p) => (
          <li key={p.kind} role="listitem">
            <button
              type="button"
              onClick={() => onPromptClick(p)}
              className="w-full text-left rounded-xl px-3.5 py-3 transition-colors hover:bg-white"
              style={{ background: 'rgba(255,255,255,0.68)', border: '1px solid rgba(226,232,240,0.9)', cursor: 'pointer' }}
            >
              <div className="flex items-start gap-3">
                <PriorityBadge priority={p.priority} />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold" style={{ color: S.text }}>
                    {p.headline}
                  </p>
                  <p className="mt-0.5 text-[13px]" style={{ color: S.sub }}>
                    {p.body}
                  </p>
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </Surface>
  );
}

function PriorityBadge({ priority }: { priority: ContextualPrompt['priority'] }) {
  const styles = (() => {
    switch (priority) {
      case 'p1':
        return { background: 'rgba(245,158,11,0.16)', color: '#b45309', label: '优先' };
      case 'p2':
        return { background: 'rgba(99,102,241,0.16)', color: '#4338ca', label: '提示' };
      case 'p3':
        return { background: 'rgba(148,163,184,0.16)', color: '#475569', label: '可选' };
    }
  })();
  return (
    <span
      className="inline-flex items-center justify-center text-[11px] font-semibold rounded-full px-2 py-0.5 mt-0.5"
      style={{ background: styles.background, color: styles.color, flexShrink: 0 }}
    >
      {styles.label}
    </span>
  );
}
