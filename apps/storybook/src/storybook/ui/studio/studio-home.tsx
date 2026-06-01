import { useMemo } from 'react';
import { Surface, Button, StatusBadge } from '@nimiplatform/kit/ui';
import { listProjects } from '../../store/storybook-store.js';

// Studio home: the creator workbench entry. Lists app-owned projects and starts a
// new structured intake. Studio is the first product-led surface.

const MODE_LABEL: Record<string, string> = {
  'source-backed': '源材料改编',
  'document-backed': '文档改编',
  'character-card': '角色卡',
  'original-scenario': '原创情景',
  'manual-setting': '手动设定',
  'structured-notes': '结构化笔记',
};

export function StudioHome({ onNewProject, onOpenProject }: { onNewProject: () => void; onOpenProject: (projectId: string) => void }) {
  const projects = useMemo(() => listProjects(), []);

  return (
    <div className="sb-content">
      <Surface className="sb-section" material="glass-regular" tone="panel">
        <div className="sb-section__head">
          <div>
            <h2>创作者 Studio</h2>
            <p>把手动设定、短篇、文档文本、结构化笔记、角色卡或原创情景转化为结构化的 Storybook 记录，审阅基础（场景框架 / 角色阵容 / Storybook Bible / 分支拓扑 / 资产计划），校验后准备成可游玩的 Play package。</p>
          </div>
          <Button type="button" tone="primary" onClick={onNewProject} data-testid="studio-new-project">新建项目</Button>
        </div>

        {projects.length === 0 ? (
          <p className="sb-muted">还没有项目。点击「新建项目」从结构化录入开始。</p>
        ) : (
          <div className="sb-grid">
            {projects.map((record) => (
              <Surface key={record.project.id} className="sb-card" material="glass-thin" tone="card">
                <div className="sb-chip-row">
                  <StatusBadge tone="info">{MODE_LABEL[record.project.mode] ?? record.project.mode}</StatusBadge>
                  <StatusBadge tone={record.truthPackage.governance.lifecycle === 'play-ready' ? 'success' : 'neutral'}>
                    {record.truthPackage.governance.lifecycle}
                  </StatusBadge>
                </div>
                <h3>{record.project.name}</h3>
                <p>更新于 {record.project.updatedAt}</p>
                <div className="sb-actions">
                  <Button type="button" tone="secondary" size="sm" onClick={() => onOpenProject(record.project.id)}>打开</Button>
                </div>
              </Surface>
            ))}
          </div>
        )}
      </Surface>
    </div>
  );
}
