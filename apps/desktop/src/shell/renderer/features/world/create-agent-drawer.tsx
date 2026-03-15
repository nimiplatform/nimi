import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollShell } from '@renderer/components/scroll-shell.js';

export type CreateAgentInput = {
  handle: string;
  displayName: string;
  concept: string;
  description: string;
  scenario: string;
  greeting: string;
  referenceImageUrl: string;
  referenceImageFile: File | null;
  wakeStrategy: '' | 'PASSIVE' | 'PROACTIVE';
  dnaPrimary: '' | 'CARING' | 'PLAYFUL' | 'INTELLECTUAL' | 'CONFIDENT' | 'MYSTERIOUS' | 'ROMANTIC';
  dnaSecondary: string[];
};

type CreateAgentDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: CreateAgentInput) => void;
  worldName: string;
  worldBannerUrl?: string | null;
  worldDescription?: string | null;
  submitting?: boolean;
};

const PRIMARY_TRAITS: Array<{ value: CreateAgentInput['dnaPrimary']; labelKey: string; defaultValue: string }> = [
  { value: 'CARING', labelKey: 'World.createAgent.primaryTraits.CARING', defaultValue: 'Caring' },
  { value: 'PLAYFUL', labelKey: 'World.createAgent.primaryTraits.PLAYFUL', defaultValue: 'Playful' },
  { value: 'INTELLECTUAL', labelKey: 'World.createAgent.primaryTraits.INTELLECTUAL', defaultValue: 'Intellectual' },
  { value: 'CONFIDENT', labelKey: 'World.createAgent.primaryTraits.CONFIDENT', defaultValue: 'Confident' },
  { value: 'MYSTERIOUS', labelKey: 'World.createAgent.primaryTraits.MYSTERIOUS', defaultValue: 'Mysterious' },
  { value: 'ROMANTIC', labelKey: 'World.createAgent.primaryTraits.ROMANTIC', defaultValue: 'Romantic' },
];

const SECONDARY_TRAITS = [
  { value: 'HUMOROUS', labelKey: 'World.createAgent.secondaryTraits.HUMOROUS', defaultValue: 'Humorous' },
  { value: 'SARCASTIC', labelKey: 'World.createAgent.secondaryTraits.SARCASTIC', defaultValue: 'Sarcastic' },
  { value: 'GENTLE', labelKey: 'World.createAgent.secondaryTraits.GENTLE', defaultValue: 'Gentle' },
  { value: 'DIRECT', labelKey: 'World.createAgent.secondaryTraits.DIRECT', defaultValue: 'Direct' },
  { value: 'OPTIMISTIC', labelKey: 'World.createAgent.secondaryTraits.OPTIMISTIC', defaultValue: 'Optimistic' },
  { value: 'REALISTIC', labelKey: 'World.createAgent.secondaryTraits.REALISTIC', defaultValue: 'Realistic' },
  { value: 'DRAMATIC', labelKey: 'World.createAgent.secondaryTraits.DRAMATIC', defaultValue: 'Dramatic' },
  { value: 'PASSIONATE', labelKey: 'World.createAgent.secondaryTraits.PASSIONATE', defaultValue: 'Passionate' },
  { value: 'REBELLIOUS', labelKey: 'World.createAgent.secondaryTraits.REBELLIOUS', defaultValue: 'Rebellious' },
  { value: 'INNOCENT', labelKey: 'World.createAgent.secondaryTraits.INNOCENT', defaultValue: 'Innocent' },
  { value: 'WISE', labelKey: 'World.createAgent.secondaryTraits.WISE', defaultValue: 'Wise' },
  { value: 'ECCENTRIC', labelKey: 'World.createAgent.secondaryTraits.ECCENTRIC', defaultValue: 'Eccentric' },
];

const initialForm: CreateAgentInput = {
  handle: '',
  displayName: '',
  concept: '',
  description: '',
  scenario: '',
  greeting: '',
  referenceImageUrl: '',
  referenceImageFile: null,
  wakeStrategy: 'PASSIVE',
  dnaPrimary: '',
  dnaSecondary: [],
};

function SectionTitle(input: { icon: React.ReactNode; title: string; extra?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300 shadow-[0_0_18px_rgba(16,185,129,0.12)]">
          {input.icon}
        </div>
        <h3 className="text-sm font-semibold tracking-[0.02em] text-[#E8FFF6]">{input.title}</h3>
      </div>
      {input.extra}
    </div>
  );
}

function FieldLabel(input: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="mb-2 block text-[11px] font-medium uppercase tracking-[0.18em] text-emerald-300/75">
      {input.children}
      {input.required ? <span className="ml-1 text-red-400">*</span> : null}
    </label>
  );
}

function TextInput(input: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...input}
      className={`h-11 w-full rounded-2xl border border-emerald-300/16 bg-white/5 px-4 text-sm text-[#E8FFF6] outline-none transition-all placeholder:text-[#9CC8B5]/35 focus:border-emerald-300/60 focus:bg-white/[0.07] focus:shadow-[0_0_0_1px_rgba(110,231,183,0.18),0_0_18px_rgba(16,185,129,0.12)] ${input.className || ''}`.trim()}
    />
  );
}

function TextArea(input: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...input}
      className={`w-full rounded-2xl border border-emerald-300/16 bg-white/5 px-4 py-3 text-sm text-[#E8FFF6] outline-none transition-all placeholder:text-[#9CC8B5]/35 resize-none focus:border-emerald-300/60 focus:bg-white/[0.07] focus:shadow-[0_0_0_1px_rgba(110,231,183,0.18),0_0_18px_rgba(16,185,129,0.12)] ${input.className || ''}`.trim()}
    />
  );
}

export function CreateAgentDrawer(props: CreateAgentDrawerProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<CreateAgentInput>(initialForm);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!props.isOpen) {
      if (form.referenceImageUrl.startsWith('blob:')) {
        URL.revokeObjectURL(form.referenceImageUrl);
      }
      setForm(initialForm);
      setAvatarError(null);
    }
  }, [form.referenceImageUrl, props.isOpen]);

  const canSubmit = form.handle.trim().length > 0 && form.concept.trim().length > 0 && !props.submitting;

  // Check if world has banner or description to show
  const hasWorldBanner = Boolean(props.worldBannerUrl);
  const hasWorldDescription = Boolean(props.worldDescription?.trim());

  const updateField = <K extends keyof CreateAgentInput>(key: K, value: CreateAgentInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleAvatarSelect = (file: File | null | undefined) => {
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setAvatarError(t('World.createAgent.avatarImageRequired', { defaultValue: 'Please choose an image file.' }));
      return;
    }

    const maxAvatarSizeBytes = 10 * 1024 * 1024;
    if (file.size > maxAvatarSizeBytes) {
      setAvatarError(t('World.createAgent.avatarTooLarge', { defaultValue: 'Avatar image must be 10MB or smaller.' }));
      return;
    }

    if (form.referenceImageUrl.startsWith('blob:')) {
      URL.revokeObjectURL(form.referenceImageUrl);
    }
    const previewUrl = URL.createObjectURL(file);
    setAvatarError(null);
    setForm((current) => ({ ...current, referenceImageUrl: previewUrl, referenceImageFile: file }));
  };

  const toggleSecondaryTrait = (trait: string) => {
    setForm((current) => {
      const checked = current.dnaSecondary.includes(trait);
      if (checked) {
        return { ...current, dnaSecondary: current.dnaSecondary.filter((value) => value !== trait) };
      }
      if (current.dnaSecondary.length >= 3) {
        return current;
      }
      return { ...current, dnaSecondary: [...current.dnaSecondary, trait] };
    });
  };

  return (
    <div className={`pointer-events-none fixed inset-0 z-50 ${props.isOpen ? '' : 'hidden'}`}>
      <div
        className={`absolute inset-0 bg-black/55 backdrop-blur-sm transition-opacity duration-300 ${props.isOpen ? 'opacity-100' : 'opacity-0'}`}
        onClick={props.onClose}
      />
      <aside
        className={`pointer-events-auto absolute right-0 top-12 flex h-[calc(100vh-3rem)] w-full max-w-[40vw] min-w-[420px] flex-col rounded-tl-[28px] border-l border-t border-emerald-400/25 bg-[#0B1313]/85 shadow-[-24px_0_60px_rgba(0,0,0,0.45)] backdrop-blur-xl transition-transform duration-300 ease-out ${props.isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-emerald-300/70 to-transparent shadow-[0_0_20px_rgba(16,185,129,0.45)]" />

        <header className="sticky top-0 z-10 overflow-hidden border-b border-emerald-400/12 bg-[#0B1313]/80 px-7 py-6 backdrop-blur-xl">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(16,185,129,0.18)_0%,rgba(16,185,129,0.08)_28%,rgba(11,19,19,0.12)_62%,rgba(11,19,19,0)_100%)]" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-emerald-300/0 via-emerald-300/55 to-emerald-300/0" />
          <div className="pointer-events-none absolute -left-10 top-0 h-24 w-40 rounded-full bg-emerald-400/16 blur-3xl" />
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-[0.01em] text-[#F2FFF9]">
                {t('World.createAgent.title', { defaultValue: 'Create New Agent' })}
              </h2>
              <p className="mt-1 text-sm text-[#A0C7BA]">
                {t('World.createAgent.subtitle', {
                  worldName: props.worldName,
                  defaultValue: 'Bring a new character to life in {{worldName}}',
                })}
              </p>
            </div>
            <button
              type="button"
              onClick={props.onClose}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-emerald-400/18 bg-white/5 text-[#D9FFF2] transition hover:border-emerald-300/40 hover:bg-emerald-400/10 hover:text-white"
              aria-label={t('World.createAgent.close', { defaultValue: 'Close create agent drawer' })}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </header>

        <ScrollShell className="min-h-0 flex-1">
          {/* World Banner & Description Header */}
          {(hasWorldBanner || hasWorldDescription) && (
            <div className="relative w-full">
              {/* Banner Image */}
              {hasWorldBanner && (
                <div className="relative h-40 w-full overflow-hidden">
                  <img
                    src={props.worldBannerUrl!}
                    alt={props.worldName}
                    className="h-full w-full object-cover"
                  />
                  {/* Gradient overlays for depth */}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0B1313] via-[#0B1313]/60 to-transparent" />
                  <div className="absolute inset-0 bg-gradient-to-r from-[#0B1313]/80 via-transparent to-[#0B1313]/40" />
                  {/* Animated aurora effect */}
                  <div className="absolute inset-0 opacity-30">
                    <div
                      className="absolute inset-0"
                      style={{
                        background: 'radial-gradient(ellipse 80% 50% at 50% 120%, rgba(16,185,129,0.25) 0%, transparent 60%)',
                      }}
                    />
                  </div>
                </div>
              )}

              {/* World Info Content */}
              <div className={`${hasWorldBanner ? '-mt-16 relative z-10' : ''} px-7 pb-6`}>
                {/* World Name Badge */}
                <div className="mb-4 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300 ring-1 ring-emerald-400/25 backdrop-blur-sm">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                      <polyline points="9 22 9 12 15 12 15 22" />
                    </svg>
                    {props.worldName}
                  </span>
                </div>

                {/* Description */}
                {hasWorldDescription && (
                  <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-br from-white/[0.06] to-white/[0.02] p-4 backdrop-blur-sm">
                    <div className="flex items-start gap-3">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                          <line x1="16" y1="13" x2="8" y2="13" />
                          <line x1="16" y1="17" x2="8" y2="17" />
                          <polyline points="10 9 9 9 8 9" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-relaxed text-[#A0C7BA]/90">
                          {props.worldDescription}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Divider */}
                <div className="mt-6 h-px bg-gradient-to-r from-transparent via-emerald-300/20 to-transparent" />
              </div>
            </div>
          )}

          <div className="space-y-8 px-7 pb-24 pt-2">
            <section className="space-y-5">
              <SectionTitle
                title={t('World.createAgent.sections.identity', { defaultValue: 'Identity' })}
                icon={(
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                )}
              />
              <div className="group relative rounded-[2rem] border border-white/10 bg-white/[0.02] p-6 shadow-[0_20px_50px_rgba(0,0,0,0.3)] backdrop-blur-2xl transition-all duration-500 hover:border-emerald-400/20 hover:bg-white/[0.04]">
                {/* Decorative corner glow */}
                <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-emerald-500/5 blur-3xl transition-opacity group-hover:opacity-100" />
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(event) => {
                    handleAvatarSelect(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
                
                <div className="flex flex-col gap-8 md:flex-row md:items-center">
                  {/* Left: Avatar Display Hub */}
                  <div className="relative flex-shrink-0 self-center">
                    <button
                      type="button"
                      onClick={() => avatarInputRef.current?.click()}
                      className="relative block h-28 w-28 overflow-hidden rounded-3xl border border-white/10 bg-black/20 p-1 text-left transition-transform duration-500 group-hover:scale-105 hover:border-emerald-300/35 focus:outline-none focus:ring-2 focus:ring-emerald-300/35"
                      aria-label={form.referenceImageUrl
                        ? t('World.createAgent.changeAvatar', { defaultValue: 'Change avatar' })
                        : t('World.createAgent.uploadAvatar', { defaultValue: 'Upload avatar' })}
                    >
                      {/* Interactive ring animation */}
                      <div className="absolute inset-0 animate-[spin_8s_linear_infinite] opacity-30 group-hover:opacity-60">
                        <div className="h-full w-full rounded-full border border-dashed border-emerald-400/40" />
                      </div>
                      
                      <div className="relative h-full w-full overflow-hidden rounded-2xl bg-white/5 flex items-center justify-center text-emerald-300/40">
                        {form.referenceImageUrl ? (
                          <img src={form.referenceImageUrl} alt={t('World.createAgent.avatarPreview', { defaultValue: 'Agent avatar preview' })} className="h-full w-full object-cover" />
                        ) : (
                          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14.5 3H9.5L7 6H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3l-2.5-3Z" />
                            <circle cx="12" cy="13" r="3.5" />
                          </svg>
                        )}
                      </div>
                    </button>
                  </div>

                  {/* Right: Meta Inputs */}
                  <div className="flex-1 space-y-5">
                    {avatarError ? (
                      <p className="text-xs text-red-300">{avatarError}</p>
                    ) : null}
                    <div className="space-y-5">
                      <div className="space-y-2">
                        <FieldLabel required>{t('World.createAgent.handle', { defaultValue: 'Handle' })}</FieldLabel>
                        <div className="relative">
                          <TextInput
                            value={form.handle}
                            onChange={(event) => updateField('handle', event.target.value)}
                            placeholder={t('World.createAgent.handlePlaceholder', { defaultValue: 'agent_unique_id' })}
                            className="pl-9 !bg-black/20 !border-white/5 focus:!border-emerald-400/40"
                          />
                          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-medium text-emerald-400/40">~</span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <FieldLabel>{t('World.createAgent.displayName', { defaultValue: 'Display Name' })}</FieldLabel>
                        <TextInput
                          value={form.displayName}
                          onChange={(event) => updateField('displayName', event.target.value)}
                          placeholder={t('World.createAgent.displayNamePlaceholder', { defaultValue: 'Public identity name' })}
                          className="!bg-black/20 !border-white/5 focus:!border-emerald-400/40"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="space-y-5">
              <SectionTitle
                title={t('World.createAgent.sections.character', { defaultValue: 'Character' })}
                icon={(
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                )}
              />
              <div className="grid gap-4 rounded-[24px] border border-white/6 bg-white/[0.035] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_18px_44px_rgba(0,0,0,0.32)] backdrop-blur-md">
                <div>
                  <FieldLabel required>{t('World.createAgent.concept', { defaultValue: 'Concept' })}</FieldLabel>
                  <TextArea
                    rows={3}
                    value={form.concept}
                    onChange={(event) => updateField('concept', event.target.value)}
                    placeholder={t('World.createAgent.conceptPlaceholder', { defaultValue: 'The core essence' })}
                  />
                </div>
                <div>
                  <FieldLabel>{t('World.createAgent.description', { defaultValue: 'Description' })}</FieldLabel>
                  <TextArea
                    rows={3}
                    value={form.description}
                    onChange={(event) => updateField('description', event.target.value)}
                    placeholder={t('World.createAgent.descriptionPlaceholder', { defaultValue: 'Public-facing' })}
                  />
                </div>
                <div>
                  <FieldLabel>{t('World.createAgent.scenario', { defaultValue: 'Scenario' })}</FieldLabel>
                  <TextArea
                    rows={3}
                    value={form.scenario}
                    onChange={(event) => updateField('scenario', event.target.value)}
                    placeholder={t('World.createAgent.scenarioPlaceholder', { defaultValue: 'The world context' })}
                  />
                </div>
                <div>
                  <FieldLabel>{t('World.createAgent.greeting', { defaultValue: 'Greeting' })}</FieldLabel>
                  <TextInput
                    value={form.greeting}
                    onChange={(event) => updateField('greeting', event.target.value)}
                    placeholder={t('World.createAgent.greetingPlaceholder', { defaultValue: 'How they introduce themselves' })}
                  />
                </div>
              </div>
            </section>

            <section className="space-y-5">
              <SectionTitle
                title={t('World.createAgent.sections.personality', { defaultValue: 'Personality DNA' })}
                icon={(
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2v6" />
                    <path d="M12 16v6" />
                    <path d="M4.93 4.93l4.24 4.24" />
                    <path d="M14.83 14.83l4.24 4.24" />
                    <path d="M2 12h6" />
                    <path d="M16 12h6" />
                    <path d="M4.93 19.07l4.24-4.24" />
                    <path d="M14.83 9.17l4.24-4.24" />
                  </svg>
                )}
              />
              <div className="space-y-5 rounded-[24px] border border-white/6 bg-white/[0.035] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_18px_44px_rgba(0,0,0,0.32)] backdrop-blur-md">
                <div>
                  <FieldLabel>{t('World.createAgent.primaryTrait', { defaultValue: 'Primary Trait' })}</FieldLabel>
                  <div className="grid grid-cols-2 gap-3">
                    {PRIMARY_TRAITS.map((trait) => {
                      const active = form.dnaPrimary === trait.value;
                      return (
                        <button
                          key={trait.value}
                          type="button"
                          onClick={() => updateField('dnaPrimary', trait.value)}
                          className={`rounded-2xl border px-4 py-3 text-sm font-medium transition-all ${
                            active
                              ? 'border-emerald-300 bg-emerald-300 text-[#06110F] shadow-[0_0_15px_rgba(0,255,170,0.45)]'
                              : 'border-white/8 bg-white/[0.04] text-[#B7D8CC] hover:border-emerald-300/35 hover:text-white'
                          }`}
                        >
                          {t(trait.labelKey, { defaultValue: trait.defaultValue })}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <FieldLabel>
                    {t('World.createAgent.secondaryTraitsLabel', { defaultValue: 'Secondary Traits' })}
                    <span className="ml-1 normal-case tracking-normal text-[#8DB4A8]/60">({form.dnaSecondary.length}/3)</span>
                  </FieldLabel>
                  <div className="flex flex-wrap gap-2.5">
                    {SECONDARY_TRAITS.map((trait) => {
                      const checked = form.dnaSecondary.includes(trait.value);
                      const disabled = !checked && form.dnaSecondary.length >= 3;
                      return (
                        <button
                          key={trait.value}
                          type="button"
                          disabled={disabled}
                          onClick={() => toggleSecondaryTrait(trait.value)}
                          className={`rounded-full border px-3.5 py-2 text-xs font-medium transition-all ${
                            checked
                              ? 'border-emerald-300 bg-emerald-400/10 text-emerald-300 shadow-[0_0_12px_rgba(0,255,170,0.18)]'
                              : 'border-white/10 bg-white/[0.04] text-[#A5C4B9] hover:border-emerald-300/30 hover:text-white'
                          } disabled:cursor-not-allowed disabled:opacity-30`}
                        >
                          {t(trait.labelKey, { defaultValue: trait.defaultValue })}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>

            <section className="space-y-5">
              <SectionTitle
                title={t('World.createAgent.sections.wakeStrategy', { defaultValue: 'Wake Strategy' })}
                icon={(
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                )}
              />
              <div className="grid grid-cols-2 gap-4 rounded-[24px] border border-white/6 bg-white/[0.035] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_18px_44px_rgba(0,0,0,0.32)] backdrop-blur-md">
                {(['PASSIVE', 'PROACTIVE'] as const).map((strategy) => {
                  const active = form.wakeStrategy === strategy;
                  return (
                    <button
                      key={strategy}
                      type="button"
                      onClick={() => updateField('wakeStrategy', strategy)}
                      className={`rounded-[20px] border px-4 py-5 text-left transition-all ${
                        active
                          ? 'border-emerald-300 bg-emerald-300/12 text-emerald-200 shadow-[0_0_20px_rgba(0,255,170,0.18)]'
                          : 'border-white/8 bg-white/[0.04] text-[#A5C4B9] hover:border-emerald-300/28 hover:text-white'
                      }`}
                    >
                      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl border border-current/20 bg-black/15">
                        {strategy === 'PASSIVE' ? (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                          </svg>
                        ) : (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="9" />
                            <path d="M12 8v4l2.5 2.5" />
                          </svg>
                        )}
                      </div>
                      <p className="text-sm font-semibold">
                        {strategy === 'PASSIVE'
                          ? t('World.createAgent.wakeStrategyPassiveTitle', { defaultValue: 'Passive' })
                          : t('World.createAgent.wakeStrategyProactiveTitle', { defaultValue: 'Proactive' })}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-current/70">
                        {strategy === 'PASSIVE'
                          ? t('World.createAgent.wakeStrategyPassiveDescription', { defaultValue: 'Waits for a direct trigger before acting.' })
                          : t('World.createAgent.wakeStrategyProactiveDescription', { defaultValue: 'Can initiate reactions when the world shifts.' })}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        </ScrollShell>

        <footer className="sticky bottom-0 z-10 border-t border-emerald-400/12 bg-[#0B1313]/80 px-7 py-5 backdrop-blur-xl">
          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={props.onClose}
              className="inline-flex h-11 items-center justify-center rounded-full border border-white/10 bg-transparent px-5 text-sm font-medium text-[#C4DED5] transition hover:border-white/20 hover:bg-white/5 hover:text-white"
            >
              {t('World.createAgent.cancel', { defaultValue: 'Cancel' })}
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => props.onSubmit(form)}
              className="inline-flex h-11 items-center justify-center rounded-full bg-emerald-300 px-6 text-sm font-semibold text-[#05110E] shadow-[0_0_18px_rgba(0,255,170,0.45)] transition hover:bg-emerald-200 hover:shadow-[0_0_24px_rgba(0,255,170,0.6)] disabled:cursor-not-allowed disabled:bg-emerald-300/25 disabled:text-[#05110E]/45 disabled:shadow-none"
            >
              {props.submitting
                ? t('World.createAgent.creating', { defaultValue: 'Creating...' })
                : t('World.createAgent.submit', { defaultValue: 'Create Agent' })}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
