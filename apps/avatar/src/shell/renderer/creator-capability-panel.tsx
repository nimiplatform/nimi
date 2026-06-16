import {
  Activity,
  AudioLines,
  CheckCircle2,
  CircleSlash,
  Crosshair,
  FileCode2,
  Smile,
  TriangleAlert,
} from 'lucide-react';
import { cn } from '@nimiplatform/kit/ui';
import { useTranslation } from './i18n/index.js';
import type {
  CreatorCapabilityId,
  CreatorCapabilityItem,
  CreatorCapabilityReport,
  CreatorCapabilityStatus,
} from './creator-capabilities.js';

const ICON_SIZE = 14;

type CreatorCapabilityPanelProps = {
  report: CreatorCapabilityReport | null;
};

export function CreatorCapabilityPanel({ report }: CreatorCapabilityPanelProps) {
  const { t } = useTranslation();
  if (!report) return null;
  return (
    <section
      className="avatar-creator-capabilities"
      aria-label={t('Avatar.creator_capabilities.aria')}
      data-testid="avatar-creator-capabilities"
    >
      <header className="avatar-creator-capabilities__header">
        <span>{t('Avatar.creator_capabilities.header')}</span>
        <span className="avatar-creator-capabilities__backend">
          {t('Avatar.creator_capabilities.backend', { kind: report.backendKind })}
        </span>
      </header>
      <div className="avatar-creator-capabilities__rows">
        {report.items.map((item) => (
          <CapabilityRow key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

function CapabilityRow({ item }: { item: CreatorCapabilityItem }) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        'avatar-creator-capabilities__row',
        `avatar-creator-capabilities__row--${item.status}`,
      )}
      data-testid={`avatar-creator-capability-${item.id}`}
      data-capability-status={item.status}
    >
      <span className="avatar-creator-capabilities__icon" aria-hidden="true">
        {iconForCapability(item.id)}
      </span>
      <span className="avatar-creator-capabilities__text">
        <span className="avatar-creator-capabilities__label">{t(item.labelKey)}</span>
        <span className="avatar-creator-capabilities__proof">
          {t(item.proofKey, item.proofParams)}
        </span>
      </span>
      <span className="avatar-creator-capabilities__status" title={t(statusKey(item.status))}>
        {statusIcon(item.status)}
      </span>
    </div>
  );
}

function iconForCapability(id: CreatorCapabilityId) {
  switch (id) {
    case 'motion':
      return <Activity size={ICON_SIZE} />;
    case 'expression':
      return <Smile size={ICON_SIZE} />;
    case 'hit_region':
      return <Crosshair size={ICON_SIZE} />;
    case 'lipsync':
      return <AudioLines size={ICON_SIZE} />;
    case 'nas_handlers':
      return <FileCode2 size={ICON_SIZE} />;
    default:
      return <CircleSlash size={ICON_SIZE} />;
  }
}

function statusIcon(status: CreatorCapabilityStatus) {
  if (status === 'passed') return <CheckCircle2 size={ICON_SIZE} aria-hidden="true" />;
  if (status === 'failed') return <TriangleAlert size={ICON_SIZE} aria-hidden="true" />;
  return <CircleSlash size={ICON_SIZE} aria-hidden="true" />;
}

function statusKey(status: CreatorCapabilityStatus): string {
  switch (status) {
    case 'passed':
      return 'Avatar.creator_capabilities.status.passed';
    case 'failed':
      return 'Avatar.creator_capabilities.status.failed';
    case 'unsupported':
      return 'Avatar.creator_capabilities.status.unsupported';
    default:
      return 'Avatar.creator_capabilities.status.unsupported';
  }
}
