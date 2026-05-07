import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus } from 'lucide-react';
import { Surface } from '@nimiplatform/nimi-kit/ui';
import { S } from '../../app-shell/page-style.js';
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
      tone="card"
      className="mb-6 overflow-hidden rounded-[var(--nimi-radius-xl)] p-6 shadow-[0_8px_32px_rgba(31,38,135,0.04)]"
      style={{ background: 'linear-gradient(135deg, rgba(167,243,208,0.35) 0%, rgba(191,219,254,0.30) 60%, rgba(221,214,254,0.30) 100%)' }}
    >
      <div className="flex flex-wrap items-start gap-5">
        <ChildAvatar
          child={child}
          ageMonths={ageMonths}
          className="h-[72px] w-[72px] rounded-[20px] border-2 object-cover"
          style={{ borderColor: 'rgba(255,255,255,0.65)', boxShadow: '0 4px 14px rgba(0,0,0,0.06)' }}
        />
        <div className="min-w-[240px] flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-[22px] font-semibold tracking-normal" style={{ color: S.text, letterSpacing: 0 }}>
              {child.displayName}
            </h1>
            <p className="text-[13px]" style={{ color: S.sub }}>{subtitleParts.join(' · ')}</p>
          </div>
          <p className="mt-2 text-[13px]" style={{ color: S.sub }}>
            {t('Profile.hero.recordSummary', {
              count: recordCount,
              defaultValue: '已经陪她记录了 {{count}} 条',
            })}
            {lastRecordedDaysAgo !== null
              ? ` · ${t('Profile.hero.recordRecency', { days: lastRecordedDaysAgo, defaultValue: '最近一次记录是 {{days}} 天前' })}`
              : ''}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <span className="text-[12px] uppercase tracking-[0.06em]" style={{ color: S.sub }}>
              {t('Profile.hero.completeness', { defaultValue: '档案完整度' })}
            </span>
            <div className="h-[6px] flex-1 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.5)' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${completeness}%`, background: 'linear-gradient(90deg, #4ECCA3 0%, #818CF8 100%)' }}
              />
            </div>
            <span className="text-[12px] font-semibold" style={{ color: S.text }}>{completeness}%</span>
          </div>
        </div>
        <div className="flex flex-col items-stretch gap-2">
          <button
            type="button"
            onClick={onAddRecord}
            className="inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold text-white transition-transform hover:-translate-y-0.5"
            style={{ background: S.accent, boxShadow: '0 4px 14px rgba(78,204,163,0.32)' }}
          >
            <Plus size={15} />
            {t('Profile.actions.addHealthData', { defaultValue: '记录新数据' })}
          </button>
          <Link
            to="/settings/children"
            state={{ from: 'profile' }}
            className="inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-medium transition-colors"
            style={{ background: 'rgba(255,255,255,0.65)', color: S.text }}
          >
            <Pencil size={13} />
            {t('Profile.actions.editChild', { defaultValue: '编辑资料' })}
          </Link>
        </div>
      </div>
    </Surface>
  );
}
