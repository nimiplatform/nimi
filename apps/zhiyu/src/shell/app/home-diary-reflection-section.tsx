import { BookOpenText } from 'lucide-react';
import { StatusBadge, Surface } from '@nimiplatform/kit/ui';
import type { ZhiyuEvidence } from './evidence';
import type { ZhiyuHomeGatedSurface } from './home-product-state';

export function DiaryReflectionSection({
  surface,
  diary,
}: {
  readonly surface: ZhiyuHomeGatedSurface;
  readonly diary: ZhiyuEvidence['diaryReflection'];
}) {
  return (
    <Surface
      as="section"
      className="zhiyu-home__gated zhiyu-home__diary-reflection"
      data-zhiyu-region="diary"
      data-zhiyu-gated-surface="diary"
      data-zhiyu-diary-reflection={diary.state}
      data-zhiyu-diary-reflection-ready={String(diary.ready)}
      data-zhiyu-diary-reflection-reason={diary.reasonCode}
      data-zhiyu-diary-reflection-artifact-count={String(diary.artifacts.length)}
      data-zhiyu-diary-reflection-missing-owner={diary.missingOwner}
      data-zhiyu-diary-reflection-missing-storage-policy={diary.missingStoragePolicyRef}
      data-zhiyu-diary-reflection-missing-sdk-projection={diary.missingSdkProjection}
      material="glass-thin"
      elevation="base"
      padding="md"
    >
      <div className="zhiyu-home__section-heading">
        <BookOpenText size={18} aria-hidden="true" />
        <div>
          <h2>{surface.title}</h2>
          <p>{surface.description}</p>
        </div>
      </div>
      <div className="zhiyu-home__diary-summary">
        <StatusBadge tone={diary.ready ? 'success' : 'info'} shape="dot">
          {diaryStateLabel(diary.state)}
        </StatusBadge>
        <span>{diary.ready ? '已投影' : '等待授权'}</span>
        <span>{diary.artifacts.length} 个内容</span>
      </div>
      <div className="zhiyu-home__diary-missing" aria-label="日记与回顾缺少授权">
        <DiaryMissingField label="归属" value={diary.missingOwner ? '等待上游归属' : '已就绪'} />
        <DiaryMissingField label="存储策略" value={diary.missingStoragePolicyRef ? '等待存储策略' : '已就绪'} />
        <DiaryMissingField label="投影能力" value={diary.missingSdkProjection ? '等待投影能力' : '已就绪'} />
      </div>
      <div className="zhiyu-home__diary-classes" aria-label="日记与回顾内容类型">
        {diary.artifactClasses.map((artifactClass) => (
          <span
            key={artifactClass}
            data-zhiyu-diary-reflection-artifact-class={artifactClass}
          >
            {diaryArtifactClassLabel(artifactClass)}
          </span>
        ))}
      </div>
      <div className="zhiyu-home__diary-required" aria-label="日记与回顾必需字段">
        {diary.requiredFields.map((field) => (
          <span
            key={field}
            data-zhiyu-diary-reflection-required-field={field}
          >
            {diaryRequiredFieldLabel(field)}
          </span>
        ))}
      </div>
      <div
        className="zhiyu-home__diary-empty"
        data-zhiyu-diary-reflection-empty={diary.artifacts.length === 0 ? 'authority_not_admitted' : 'projected'}
      >
        <strong>{diary.artifacts.length === 0 ? '日记与回顾尚未开放' : '日记与回顾已投影'}</strong>
        <small>{diary.artifacts.length === 0 ? '上游授权完成后，这里会显示长期内容和回顾。' : diary.message}</small>
      </div>
      <div className="zhiyu-home__diary-unsupported" aria-label="日记与回顾未开放字段">
        {diary.unsupportedFields.map((field) => (
          <span
            key={field}
            data-zhiyu-diary-reflection-unsupported-field={field}
            data-zhiyu-diary-reflection-unsupported-state="not_admitted"
          >
            {diaryRequiredFieldLabel(field)}：尚未开放
          </span>
        ))}
      </div>
      <p className="zhiyu-home__action-hint">{surface.actionHint}</p>
    </Surface>
  );
}

function DiaryMissingField({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <span
      data-zhiyu-diary-reflection-missing={label}
      data-zhiyu-diary-reflection-missing-state="not_admitted"
    >
      {label}：{value}
    </span>
  );
}

function diaryStateLabel(state: string): string {
  if (state === 'projected') return '已投影';
  if (state === 'deferred') return '等待授权';
  if (state === 'blocked') return '等待开放';
  return state.replaceAll('_', ' ');
}

function diaryArtifactClassLabel(value: string): string {
  if (value === 'user-authored-note') return '用户笔记';
  if (value === 'agent-generated-reflection') return '伙伴回顾';
  if (value === 'memory-derived-summary') return '记忆摘要';
  if (value === 'system-generated-audit-summary') return '系统审计摘要';
  return value.replaceAll('_', ' ').replaceAll('-', ' ');
}

function diaryRequiredFieldLabel(value: string): string {
  if (value === 'artifact_id') return '内容 ID';
  if (value === 'artifact_class') return '内容类型';
  if (value === 'owner_domain') return '归属域';
  if (value === 'created_timestamp') return '创建时间';
  if (value === 'generated_approved_reviewed_status') return '生成/审批/复核状态';
  if (value === 'source_anchor') return '来源锚点';
  if (value === 'storage_policy_ref') return '存储策略';
  if (value === 'retention_or_export_state') return '留存或导出状态';
  if (value === 'diary_reflection_artifact_projection') return '日记与回顾投影';
  return value.replaceAll('_', ' ');
}
