import type { ReactNode } from 'react';
import type { HumanProfileData } from '../profile/profile-model';

// Shared tooltip chrome for the profile detail top bar; matches the kit
// tooltip bubble surface tokens so it stays readable in both themes.
export const TOPBAR_TOOLTIP_CLASS = 'rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-overlay)] px-3 py-1.5 text-xs font-semibold text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-floating)]';

export type EditableProfileDraft = {
  displayName: string;
  avatarUrl: string;
  bio: string;
  city: string;
  countryCode: string;
  gender: string;
  languages: string;
  tags: string;
};

export function buildEditableDraft(profile: HumanProfileData): EditableProfileDraft {
  return {
    displayName: profile.displayName || '',
    avatarUrl: profile.avatarUrl || '',
    bio: profile.bio || '',
    city: profile.city || '',
    countryCode: profile.countryCode || '',
    gender: profile.gender || '',
    languages: profile.languages.join(', '),
    tags: profile.tags.join(', '),
  };
}

export function EditableField(input: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">{input.label}</span>
      <input
        type="text"
        value={input.value}
        onChange={(event) => input.onChange(event.target.value)}
        placeholder={input.placeholder}
        className="mt-1.5 w-full rounded-2xl border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-4 py-3 text-sm text-[var(--nimi-field-text)] outline-none transition focus:border-[var(--nimi-action-primary-bg)] focus:ring-4 focus:ring-[var(--nimi-action-primary-bg)]/10"
      />
    </label>
  );
}

export function InlineMeta({
  value,
  icon,
}: {
  value: string;
  icon: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="shrink-0 text-[var(--nimi-text-muted)]">{icon}</span>
      <div className="min-w-0 text-[13px] leading-6 text-[var(--nimi-text-secondary)]">{value}</div>
    </div>
  );
}

export function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--nimi-text-muted)]">{label}</div>
      <div className="mt-1.5 text-[28px] font-semibold leading-none tracking-[-0.04em] text-[var(--nimi-text-primary)]">{value}</div>
    </div>
  );
}

export function PencilIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export function CameraIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h3l2-2h6l2 2h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

export function EyeIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function CheckIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}

export function SpinnerIcon({ className = '' }: { className?: string }) {
  return <span className={`${className} inline-block animate-spin rounded-full border-2 border-white/40 border-t-white`} />;
}

export function StatDivider() {
  return <span className="mt-4 h-9 w-px justify-self-center bg-[linear-gradient(180deg,color-mix(in_srgb,var(--nimi-text-muted)_0%,transparent)_0%,color-mix(in_srgb,var(--nimi-text-muted)_35%,transparent)_50%,color-mix(in_srgb,var(--nimi-text-muted)_0%,transparent)_100%)]" />;
}

export function AlertIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export function DotsIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="6" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="18" cy="12" r="2" />
    </svg>
  );
}

export function TrashIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

export function MessageIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function GiftIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13" />
      <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
      <path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />
    </svg>
  );
}

export function UserPlusIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <path d="M20 8v6" />
      <path d="M17 11h6" />
    </svg>
  );
}

export function CalendarIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

export function LocationIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

export function ArrowUpIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 19 0-14" />
      <path d="m6 11 6-6 6 6" />
    </svg>
  );
}
