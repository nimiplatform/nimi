import { useState } from 'react';

export type AuthMode = 'login' | 'register';

export type AuthFormState = {
  mode: AuthMode;
  identifier: string;
  password: string;
  showPassword: boolean;
  pending: boolean;
};

export type AuthFormActions = {
  setMode: (mode: AuthMode) => void;
  toggleMode: () => void;
  setIdentifier: (value: string) => void;
  setPassword: (value: string) => void;
  setShowPassword: (value: boolean) => void;
  setPending: (value: boolean) => void;
};

export type AuthFormModel = AuthFormState & AuthFormActions & {
  canSubmit: boolean;
};

export function getAuthErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return '登录失败，请稍后重试';
}

export function useAuthFormState(): AuthFormModel {
  const [mode, setMode] = useState<AuthMode>('login');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);

  return {
    mode,
    identifier,
    password,
    showPassword,
    pending,
    setMode,
    toggleMode: () => setMode((current) => (current === 'login' ? 'register' : 'login')),
    setIdentifier,
    setPassword,
    setShowPassword,
    setPending,
    canSubmit: identifier.trim().length > 0 && password.length > 0,
  };
}
