import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus } from 'lucide-react';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { ChildAvatar } from '../../shared/child-avatar.js';
import { formatAgeText } from './health-record-display.js';

export interface ProfileHeroChild {
  childId: string;
  displayName: string;
  birthDate: string;
  gender: 'male' | 'female';
  avatarPath: string | null;
}

export interface ProfileHeroProps {
  child: ProfileHeroChild;
  ageMonths: number;
  completeness: number;
  recordCount: number;
  lastRecordedDaysAgo: number | null;
  onAddRecord: () => void;
}

export function ProfileHero({ child, ageMonths, completeness, recordCount, lastRecordedDaysAgo, onAddRecord }: ProfileHeroProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const subtitleParts = [
    t(child.gender === 'male' ? 'Profile.gender.male' : 'Profile.gender.female', { defaultValue: child.gender === 'male' ? '男' : '女' }),
    formatAgeText(ageMonths, t),
    child.birthDate,
  ];
  return (
    <Surface
      as="section"
      material="glass-thick"
      padding="none"
      tone="hero"
      elevation="raised"
      className="mb-6 overflow-hidden rounded-3xl p-6"
    >
      <div className="flex flex-wrap items-start gap-5">
        <ChildAvatar
          child={child}
          ageMonths={ageMonths}
          className="h-[72px] w-[72px] rounded-2xl border-2 border-[var(--nimi-material-glass-thick-border)] object-cover shadow-[var(--nimi-elevation-base)]"
        />
        <div className="min-w-[240px] flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-[22px] font-semibold tracking-normal text-[var(--nimi-text-primary)]">
              {child.displayName}
            </h1>
            <p className="text-[13px] text-[var(--nimi-text-muted)]">{subtitleParts.join(' · ')}</p>
          </div>
          <p className="mt-2 text-[13px] text-[var(--nimi-text-muted)]">
            {t('Profile.hero.recordSummary', {
              count: recordCount,
              defaultValue: '已经陪她记录了 {{count}} 条',
            })}
            {lastRecordedDaysAgo !== null
              ? ` · ${t('Profile.hero.recordRecency', { days: lastRecordedDaysAgo, defaultValue: '最近一次记录是 {{days}} 天前' })}`
              : ''}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <span className="text-[12px] uppercase tracking-[0.06em] text-[var(--nimi-text-muted)]">
              {t('Profile.hero.completeness', { defaultValue: '档案完整度' })}
            </span>
            <div className="h-[6px] flex-1 overflow-hidden rounded-full bg-[var(--nimi-surface-overlay)]">
              <div
                className="h-full rounded-full bg-[image:var(--nimi-surface-hero)] transition-all"
                style={{ width: `${completeness}%` }}
              />
            </div>
            <span className="text-[12px] font-semibold text-[var(--nimi-text-primary)]">{completeness}%</span>
          </div>
        </div>
        <div className="flex flex-col items-stretch gap-2">
          <Button
            onClick={onAddRecord}
            tone="primary"
            size="md"
            leadingIcon={<Plus size={15} />}
          >
            {t('Profile.actions.addHealthData', { defaultValue: '记录新数据' })}
          </Button>
          <Button
            onClick={() => {
              void navigate('/settings/children', { state: { from: 'profile' } });
            }}
            tone="secondary"
            size="md"
            leadingIcon={<Pencil size={13} />}
          >
            {t('Profile.actions.editChild', { defaultValue: '编辑资料' })}
          </Button>
        </div>
      </div>
    </Surface>
  );
}
