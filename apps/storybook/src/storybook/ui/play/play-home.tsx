import { useEffect, useMemo, useState } from 'react';
import { Surface, Button, StatusBadge, InlineAlert } from '@nimiplatform/kit/ui';
import {
  buildExamplePreparedPackage,
  validatePreparedPackage,
  startRun,
  createTranscript,
  appendTranscriptEntry,
  mintId,
  type PreparedStorybookPackage,
} from '../../engine/index.js';
import {
  listImportedPackages,
  saveImportedPackage,
  listRuns,
  saveRun,
  type ImportedPackageRecord,
} from '../../store/storybook-store.js';

// Play library. Ordinary-user surface: open an official example or a locally
// imported prepared package and start/continue. `recent`/`recommended`/
// `friend-provided`/`creator-provided` are UI entry labels over valid prepared
// packages — not extra source categories. No Studio authoring controls appear here.

const ENTRY_LABEL_TONE: Record<ImportedPackageRecord['entryLabel'], 'info' | 'success' | 'neutral' | 'warning'> = {
  recommended: 'success',
  recent: 'info',
  'friend-provided': 'neutral',
  'creator-provided': 'warning',
};

function nowIso(): string {
  return new Date().toISOString();
}

export function PlayHome({ onStartRun }: { onStartRun: (runId: string) => void }) {
  const [packages, setPackages] = useState<ImportedPackageRecord[]>([]);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    // Seed the official example package on first load so Play has a valid
    // zero-configuration entry. It is built then Play-validated; only a valid
    // package is stored (no pseudo-success).
    const existing = listImportedPackages();
    if (!existing.some((record) => record.source === 'official')) {
      const built = buildExamplePreparedPackage(nowIso());
      if (built.ok) {
        const report = validatePreparedPackage(built.value);
        if (report.valid) {
          saveImportedPackage({
            id: built.value.manifest.packageId,
            label: '官方示例：雾港疑案',
            source: 'official',
            entryLabel: 'recommended',
            package: built.value,
            importedAt: nowIso(),
          });
        }
      }
    }
    setPackages(listImportedPackages());
  }, []);

  const runs = useMemo(() => listRuns(), [packages, notice]);

  function refresh() {
    setPackages(listImportedPackages());
  }

  function importLocalPackage() {
    setImportError(null);
    setNotice(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(importText);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '无法解析为 JSON。');
      return;
    }
    const candidate = parsed as PreparedStorybookPackage;
    const report = validatePreparedPackage(candidate);
    if (!report.valid) {
      setImportError(`导入的 prepared package 未通过 Play 校验：${report.findings.map((f) => f.message).join('；')}`);
      return;
    }
    saveImportedPackage({
      id: candidate.manifest.packageId || mintId('pkg'),
      label: candidate.publicSummary.slice(0, 40) || '本地导入的 Storybook',
      source: 'local-import',
      entryLabel: 'recent',
      package: candidate,
      importedAt: nowIso(),
    });
    setImportText('');
    setNotice('已导入并通过校验。');
    refresh();
  }

  function startPackage(record: ImportedPackageRecord) {
    const prepared = record.package;
    const report = validatePreparedPackage(prepared);
    if (!report.valid) {
      setImportError(`无法开始：${report.findings.map((f) => f.message).join('；')}`);
      return;
    }
    const chapter = prepared.playableChapters.find((c) => c.id === prepared.startSemantics.chapterId);
    if (!chapter) {
      setImportError('无法开始：找不到起始章节。');
      return;
    }
    const run = startRun({
      projectId: prepared.manifest.packageId,
      packageId: prepared.manifest.packageId,
      chapter,
      variables: prepared.stateMatrix.variables,
      flags: prepared.stateMatrix.flags,
      now: nowIso(),
    });
    let transcript = createTranscript(run.id);
    transcript = appendTranscriptEntry(transcript, { at: nowIso(), kind: 'enter-node', detail: `进入起始节点 ${run.currentNodeId}`, nodeId: run.currentNodeId });
    saveRun({ packageId: prepared.manifest.packageId, run, transcript, snapshots: [] });
    onStartRun(run.id);
  }

  return (
    <div className="sb-content">
      <Surface className="sb-section" material="glass-regular" tone="panel">
        <div className="sb-section__head">
          <div>
            <h2>开始游玩</h2>
            <p>打开一个官方示例或本地导入的 Storybook，立即开始。选项默认自动生成，你无需打字也能推进；自由文本是可选的。</p>
          </div>
        </div>
        {packages.length === 0 ? (
          <p className="sb-muted">尚无可玩的 prepared package。</p>
        ) : (
          <div className="sb-grid">
            {packages.map((record) => (
              <Surface key={record.id} className="sb-card" material="glass-thin" tone="card">
                <div className="sb-chip-row">
                  <StatusBadge tone={ENTRY_LABEL_TONE[record.entryLabel]}>{record.entryLabel}</StatusBadge>
                  <StatusBadge tone="neutral">{record.source === 'official' ? '官方示例' : '本地导入'}</StatusBadge>
                </div>
                <h3>{record.label}</h3>
                <p>{record.package.publicSummary || '（无公开简介）'}</p>
                <div className="sb-chip-row">
                  {record.package.contentBoundaries.slice(0, 3).map((boundary, index) => (
                    <StatusBadge key={index} tone="neutral">{boundary}</StatusBadge>
                  ))}
                </div>
                <div className="sb-actions">
                  <Button type="button" tone="primary" size="sm" onClick={() => startPackage(record)}>开始新游玩</Button>
                </div>
              </Surface>
            ))}
          </div>
        )}
      </Surface>

      {runs.length > 0 ? (
        <Surface className="sb-section" material="glass-regular" tone="panel">
          <div className="sb-section__head">
            <div>
              <h2>继续游玩</h2>
              <p>从已保存的运行恢复。运行状态、分支快照与记录都保存在 app 本地。</p>
            </div>
          </div>
          <div className="sb-grid">
            {runs.map((record) => (
              <Surface key={record.run.id} className="sb-card" material="glass-thin" tone="card">
                <div className="sb-chip-row">
                  <StatusBadge tone={record.run.status === 'ended' ? 'success' : 'info'}>{record.run.status === 'ended' ? '已结束' : '进行中'}</StatusBadge>
                  <StatusBadge tone="neutral">节点 {record.run.currentNodeId}</StatusBadge>
                </div>
                <p>更新于 {record.run.updatedAt}</p>
                <div className="sb-actions">
                  <Button type="button" tone="secondary" size="sm" onClick={() => onStartRun(record.run.id)}>继续</Button>
                </div>
              </Surface>
            ))}
          </div>
        </Surface>
      ) : null}

      <Surface className="sb-section" material="glass-regular" tone="panel">
        <div className="sb-section__head">
          <div>
            <h2>导入 prepared package</h2>
            <p>粘贴一个由 Studio 产出的 prepared package JSON。导入会先经过 Play 校验，校验不通过会显示具体失败原因，不做伪成功。</p>
          </div>
        </div>
        <div className="sb-field">
          <label htmlFor="sb-import">prepared-storybook-package JSON</label>
          <textarea
            id="sb-import"
            className="sb-textarea"
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            placeholder='{"manifest": { ... }, "playableChapters": [ ... ], ...}'
          />
        </div>
        {importError ? <InlineAlert tone="warning"><div className="runtime-alert-copy"><strong>导入失败</strong><span>{importError}</span></div></InlineAlert> : null}
        {notice ? <InlineAlert tone="info"><div className="runtime-alert-copy"><strong>提示</strong><span>{notice}</span></div></InlineAlert> : null}
        <div className="sb-actions">
          <Button type="button" tone="primary" size="sm" disabled={!importText.trim()} onClick={importLocalPackage}>校验并导入</Button>
        </div>
      </Surface>
    </div>
  );
}
