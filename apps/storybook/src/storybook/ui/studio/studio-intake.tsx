import { useState } from 'react';
import { Surface, Button, StatusBadge, InlineAlert } from '@nimiplatform/kit/ui';
import {
  convertIntake,
  seedTruthPackage,
  mintId,
  type IntakeInput,
  type IntakeKind,
  type StorybookProject,
  type StorybookProjectMode,
  type Role,
} from '../../engine/index.js';
import { createProjectMemory } from '../../engine/memory.js';
import { saveProject } from '../../store/storybook-store.js';

// Structured intake. Every admitted input is normalized into structured Storybook
// records BEFORE any generation/preview. Conversion is fail-closed: invalid or
// over-limit input shows a typed reason and creates nothing.

const KIND_OPTIONS: { value: IntakeKind; label: string }[] = [
  { value: 'manual-setting', label: '手动设定' },
  { value: 'original-scenario', label: '原创情景' },
  { value: 'character-card', label: '角色卡' },
  { value: 'short-fiction', label: '短篇小说（精简节选）' },
  { value: 'document-text', label: '文档文本' },
  { value: 'structured-notes', label: '结构化笔记' },
];

const MODE_BY_KIND: Record<IntakeKind, StorybookProjectMode> = {
  'manual-setting': 'manual-setting',
  'original-scenario': 'original-scenario',
  'character-card': 'character-card',
  'short-fiction': 'source-backed',
  'document-text': 'document-backed',
  'structured-notes': 'structured-notes',
};

function lines(value: string): string[] {
  return value.split('\n').map((s) => s.trim()).filter(Boolean);
}

function parseRoles(value: string): Role[] {
  return lines(value).map((line, index) => {
    const [name, summary] = line.split('|').map((s) => s.trim());
    return { id: `role-${index}`, name: name || `角色${index + 1}`, summary: summary || '' };
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

export function StudioIntake({ onCreated, onCancel }: { onCreated: (projectId: string) => void; onCancel: () => void }) {
  const [kind, setKind] = useState<IntakeKind>('original-scenario');
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [secondary, setSecondary] = useState('');
  const [tertiary, setTertiary] = useState('');
  const [error, setError] = useState<string | null>(null);

  function buildInput(projectId: string): IntakeInput | { error: string } {
    switch (kind) {
      case 'manual-setting':
        return { kind, projectId, background: text, roles: parseRoles(secondary), rules: lines(tertiary), playerPosition: '参与者视角', contentBoundaries: [] };
      case 'original-scenario':
        return { kind, projectId, premise: text, cast: parseRoles(secondary).map((r) => ({ name: r.name, summary: r.summary })), rules: lines(tertiary) };
      case 'character-card':
        return { kind, projectId, card: { name: secondary.trim() || name.trim(), persona: text, voice: tertiary.trim() || undefined } };
      case 'short-fiction':
        return { kind, projectId, title: secondary.trim() || undefined, text };
      case 'document-text':
        return { kind, projectId, title: secondary.trim() || undefined, text };
      case 'structured-notes':
        return {
          kind,
          projectId,
          notes: lines(text).map((line) => {
            const [label, ...rest] = line.split(/[:：]/);
            return { label: (label || '').trim(), value: rest.join(':').trim() };
          }),
        };
      default:
        return { error: '不支持的录入类型。' };
    }
  }

  function submit() {
    setError(null);
    if (!name.trim()) {
      setError('请填写项目名称。');
      return;
    }
    const projectId = mintId('proj');
    const built = buildInput(projectId);
    if ('error' in built) {
      setError(built.error);
      return;
    }
    const conversion = convertIntake(built, nowIso());
    if (!conversion.ok) {
      setError(`录入转换失败（${conversion.code}）：${conversion.message}`);
      return;
    }
    const project: StorybookProject = {
      id: projectId,
      name: name.trim(),
      mode: MODE_BY_KIND[kind],
      truthPackageId: mintId('truthpkg'),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const truthPackage = seedTruthPackage(project, conversion.value, nowIso());
    saveProject({ project, truthPackage, memory: createProjectMemory(projectId) });
    onCreated(projectId);
  }

  const textLabel =
    kind === 'manual-setting' ? '背景设定'
      : kind === 'original-scenario' ? '前提 / 情景种子'
        : kind === 'character-card' ? '人物设定（persona）'
          : kind === 'structured-notes' ? '结构化笔记（每行 “标签: 值”）'
            : '源文本（精简节选，≤ 20000 字符）';

  const secondaryLabel =
    kind === 'manual-setting' || kind === 'original-scenario' ? '角色（每行 “名字|简介”）'
      : kind === 'character-card' ? '角色名'
        : '标题（可选）';

  const tertiaryLabel =
    kind === 'manual-setting' || kind === 'original-scenario' ? '规则（每行一条）'
      : kind === 'character-card' ? '语气（可选）'
        : '';

  return (
    <Surface className="sb-section" material="glass-regular" tone="panel">
      <div className="sb-section__head">
        <div>
          <h2>新建项目 · 结构化录入</h2>
          <p>选择来源类型并填写内容。提交后会先转化为结构化记录（场景框架 / 角色候选 / Bible 草案），不直接当作长提示词使用。</p>
        </div>
        <Button type="button" tone="secondary" size="sm" onClick={onCancel}>取消</Button>
      </div>

      <div className="sb-form">
        <div className="sb-field">
          <label htmlFor="sb-kind">来源类型</label>
          <select id="sb-kind" className="sb-select" value={kind} onChange={(event) => setKind(event.target.value as IntakeKind)}>
            {KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>

        <div className="sb-field">
          <label htmlFor="sb-name">项目名称</label>
          <input id="sb-name" className="sb-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：雾港疑案" />
        </div>

        <div className="sb-field">
          <label htmlFor="sb-text">{textLabel}</label>
          <textarea id="sb-text" className="sb-textarea" value={text} onChange={(event) => setText(event.target.value)} />
        </div>

        <div className="sb-field">
          <label htmlFor="sb-secondary">{secondaryLabel}</label>
          <textarea id="sb-secondary" className="sb-textarea" style={{ minHeight: 90 }} value={secondary} onChange={(event) => setSecondary(event.target.value)} />
        </div>

        {tertiaryLabel ? (
          <div className="sb-field">
            <label htmlFor="sb-tertiary">{tertiaryLabel}</label>
            <textarea id="sb-tertiary" className="sb-textarea" style={{ minHeight: 80 }} value={tertiary} onChange={(event) => setTertiary(event.target.value)} />
          </div>
        ) : null}

        {error ? <InlineAlert tone="warning"><div className="runtime-alert-copy"><strong>无法创建</strong><span>{error}</span></div></InlineAlert> : null}

        <div className="sb-actions">
          <StatusBadge tone="neutral">所有输入会先结构化再生成</StatusBadge>
          <Button type="button" tone="primary" onClick={submit} data-testid="studio-intake-submit">转换并创建项目</Button>
        </div>
      </div>
    </Surface>
  );
}
