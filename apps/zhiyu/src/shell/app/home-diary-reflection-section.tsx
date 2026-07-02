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
          {diary.state}
        </StatusBadge>
        <span>{diary.reasonCode}</span>
        <span>{diary.artifacts.length} artifacts</span>
      </div>
      <div className="zhiyu-home__diary-missing" aria-label="Diary reflection missing authority">
        <DiaryMissingField label="owner" value={diary.missingOwner} />
        <DiaryMissingField label="storagePolicy" value={diary.missingStoragePolicyRef} />
        <DiaryMissingField label="sdkProjection" value={diary.missingSdkProjection} />
      </div>
      <div className="zhiyu-home__diary-classes" aria-label="Diary reflection artifact classes">
        {diary.artifactClasses.map((artifactClass) => (
          <span
            key={artifactClass}
            data-zhiyu-diary-reflection-artifact-class={artifactClass}
          >
            {artifactClass}
          </span>
        ))}
      </div>
      <div className="zhiyu-home__diary-required" aria-label="Diary reflection required fields">
        {diary.requiredFields.map((field) => (
          <span
            key={field}
            data-zhiyu-diary-reflection-required-field={field}
          >
            {field}
          </span>
        ))}
      </div>
      <div
        className="zhiyu-home__diary-empty"
        data-zhiyu-diary-reflection-empty={diary.artifacts.length === 0 ? 'authority_not_admitted' : 'projected'}
      >
        <strong>{diary.artifacts.length === 0 ? 'authority_not_admitted' : 'projected'}</strong>
        <small>{diary.message}</small>
      </div>
      <div className="zhiyu-home__diary-unsupported" aria-label="Diary reflection unsupported fields">
        {diary.unsupportedFields.map((field) => (
          <span
            key={field}
            data-zhiyu-diary-reflection-unsupported-field={field}
            data-zhiyu-diary-reflection-unsupported-state="not_admitted"
          >
            {field}: not_admitted
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
      {label}: {value}
    </span>
  );
}
