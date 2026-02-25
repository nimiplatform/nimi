import type { FormEvent } from 'react';
import type { UiExtensionContext } from '@renderer/mod-ui/contracts';
import { SlotHost } from '@renderer/mod-ui/host/slot-host';
import { getShellFeatureFlags } from '@nimiplatform/shell-core/shell-mode';
import type { AuthMode } from './auth-form-state';

function IconPerson() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M15.833 17.5v-1.667a3.333 3.333 0 0 0-3.333-3.333h-5a3.333 3.333 0 0 0-3.333 3.333V17.5" stroke="white" strokeWidth="1.667" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="10" cy="5.833" r="3.333" stroke="white" strokeWidth="1.667" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconBot() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M10 6.667V3.333H6.667" stroke="white" strokeWidth="1.667" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="3.333" y="6.667" width="13.333" height="10" rx="1.667" stroke="white" strokeWidth="1.667" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M1.667 11.667h1.666M16.667 11.667h1.666M12.5 10.833v1.667M7.5 10.833v1.667" stroke="white" strokeWidth="1.667" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconSparkle() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M8.281 12.917a2.5 2.5 0 0 0-1.198-1.198l-5.112-1.32a.417.417 0 0 1 0-.798l5.112-1.32a2.5 2.5 0 0 0 1.198-1.198l1.318-5.112a.417.417 0 0 1 .802 0l1.318 5.112a2.5 2.5 0 0 0 1.198 1.198l5.112 1.32a.417.417 0 0 1 0 .798l-5.112 1.32a2.5 2.5 0 0 0-1.198 1.198l-1.318 5.112a.417.417 0 0 1-.802 0l-1.318-5.112Z" stroke="white" strokeWidth="1.667" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16.667 2.5v3.333M18.333 4.167H15M3.333 14.167v1.666M4.167 15H2.5" stroke="white" strokeWidth="1.667" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconEye() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#99A1AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconEyeOff() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#99A1AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

const FEATURES = [
  { icon: <IconPerson />, title: 'Human Connections', desc: 'Chat with real people in your network' },
  { icon: <IconBot />, title: 'AI Agents', desc: 'Interact with intelligent agents' },
  { icon: <IconSparkle />, title: 'Local AI Runtime', desc: 'Run models privately on your device' },
] as const;

type LoginViewProps = {
  mode: AuthMode;
  identifier: string;
  password: string;
  showPassword: boolean;
  pending: boolean;
  canSubmit: boolean;
  slotContext: UiExtensionContext;
  onIdentifierChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onToggleShowPassword: () => void;
  onToggleMode: () => void;
  onSubmit: (event: FormEvent) => void;
};

export function LoginView(props: LoginViewProps) {
  const flags = getShellFeatureFlags();

  return (
    <div className="flex h-screen w-screen bg-gray-50">
      <div className="brand-gradient relative hidden flex-1 items-center justify-center lg:flex">
        <div className="w-[342px]">
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-white/20">
            <span className="text-5xl font-bold leading-none text-white">N</span>
          </div>
          <h1 className="mt-8 text-4xl font-bold tracking-tight text-white">Welcome to Nimi</h1>
          <p className="mt-4 text-xl text-brand-50">Where humans and AI agents connect</p>
          <div className="mt-16 flex flex-col gap-4">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-white/20">
                  {feature.icon}
                </div>
                <div>
                  <div className="text-base font-medium text-white">{feature.title}</div>
                  <div className="text-sm text-brand-100">{feature.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex w-full shrink-0 items-center bg-white lg:w-[480px]">
        <div className="mx-auto w-full max-w-[352px] px-6 lg:ml-16 lg:mr-auto lg:px-0">
          <h2 className="text-2xl font-semibold text-gray-900">
            {props.mode === 'register' ? 'Create account' : 'Sign in'}
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            {props.mode === 'register'
              ? 'Fill in your details to create a new account'
              : 'Enter your credentials to access your account'}
          </p>

          <form className="mt-8 flex flex-col gap-5" onSubmit={props.onSubmit}>
            <div className="flex flex-col gap-2">
              <label htmlFor="loginIdentifier" className="text-sm font-medium text-gray-700">
                Username
              </label>
              <input
                id="loginIdentifier"
                value={props.identifier}
                onChange={(event) => props.onIdentifierChange(event.target.value)}
                className="h-[46px] w-full rounded-[10px] border border-gray-200 bg-gray-50 px-4 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-brand-500"
                placeholder="Enter your username"
                autoComplete="username"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="loginPassword" className="text-sm font-medium text-gray-700">
                Password
              </label>
              <div className="relative">
                <input
                  id="loginPassword"
                  value={props.password}
                  onChange={(event) => props.onPasswordChange(event.target.value)}
                  className="h-[46px] w-full rounded-[10px] border border-gray-200 bg-gray-50 px-4 pr-12 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-brand-500"
                  type={props.showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded"
                  onClick={props.onToggleShowPassword}
                  tabIndex={-1}
                >
                  {props.showPassword ? <IconEyeOff /> : <IconEye />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={props.pending || !props.canSubmit}
              className={`h-12 w-full rounded-[10px] text-base font-medium text-white transition-colors disabled:cursor-not-allowed disabled:bg-gray-300 ${
                props.canSubmit && !props.pending ? 'brand-gradient' : ''
              }`}
            >
              {props.pending
                ? (props.mode === 'register' ? 'Creating...' : 'Signing in...')
                : (props.mode === 'register' ? 'Create account' : 'Sign in')}
            </button>

            <div className="flex items-center justify-between">
              <button type="button" className="text-base font-medium text-gray-600 hover:text-gray-700">
                Forgot password?
              </button>
              <button
                type="button"
                className="text-base font-medium text-brand-600 hover:text-brand-700"
                onClick={props.onToggleMode}
              >
                {props.mode === 'login' ? 'Create account' : 'Sign in instead'}
              </button>
            </div>
          </form>

          {flags.enableModUi ? (
            <SlotHost slot="auth.login.form.footer" base={null} context={props.slotContext} />
          ) : null}

          <p className="mt-8 text-center text-xs text-gray-400">
            {flags.mode === 'web' ? 'Nimi Web v1.0.0' : 'Nimi Desktop v1.0.0'}
          </p>
        </div>
      </div>
    </div>
  );
}
