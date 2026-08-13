import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const en = {
  Common: { back: 'Back' },
  Auth: {
    alternative: 'Other sign-in methods',
    emailPlaceholder: 'Email address',
    chooseAlternative: 'Other ways to continue',
    web3: 'Wallet',
    useEmailCodeInstead: 'Use an email code instead',
    passwordPlaceholder: 'Password',
    hidePassword: 'Hide password',
    showPassword: 'Show password',
    otpConfirmMessage: 'Send a one-time code to this email?',
    cancel: 'Cancel',
    confirmOtp: 'Send code',
    setPasswordHint: 'Set a password to finish creating your Nimi account.',
    passwordMinChars: 'Password (at least 8 characters)',
    confirmPasswordPlaceholder: 'Confirm password',
    settingPassword: 'Setting password…',
    setPasswordButton: 'Set password',
    otpSentTo: 'A one-time code was sent to',
    verifying: 'Verifying…',
    verifyAndContinue: 'Verify and continue',
    resendIn: 'Resend in {{count}}s',
    resendCode: 'Resend code',
    twoFaHint: 'Enter the 6-digit code from your authenticator app.',
    verifyAndLogin: 'Verify and sign in',
    emailNotRegistered: 'This email is not registered yet.',
    registerConfirmHint: 'Create a Nimi account with this email?',
    confirmRegister: 'Create account',
  },
};

const zh = {
  Common: { back: '返回' },
  Auth: {
    alternative: '其他登录方式',
    emailPlaceholder: '邮箱地址',
    chooseAlternative: '其他继续方式',
    web3: '钱包',
    useEmailCodeInstead: '改用邮箱验证码',
    passwordPlaceholder: '密码',
    hidePassword: '隐藏密码',
    showPassword: '显示密码',
    otpConfirmMessage: '向此邮箱发送一次性验证码？',
    cancel: '取消',
    confirmOtp: '发送验证码',
    setPasswordHint: '设置密码以完成 Nimi 账号注册。',
    passwordMinChars: '密码（至少 8 位）',
    confirmPasswordPlaceholder: '确认密码',
    settingPassword: '正在设置密码…',
    setPasswordButton: '设置密码',
    otpSentTo: '一次性验证码已发送至',
    verifying: '正在验证…',
    verifyAndContinue: '验证并继续',
    resendIn: '{{count}} 秒后可重新发送',
    resendCode: '重新发送验证码',
    twoFaHint: '请输入身份验证器中的 6 位验证码。',
    verifyAndLogin: '验证并登录',
    emailNotRegistered: '此邮箱尚未注册。',
    registerConfirmHint: '使用此邮箱创建 Nimi 账号？',
    confirmRegister: '创建账号',
  },
};

export async function initializeWebAccountI18n(): Promise<void> {
  if (i18n.isInitialized) return;
  const language = String(document.documentElement.lang || navigator.language || 'en').toLowerCase().startsWith('zh')
    ? 'zh'
    : 'en';
  await i18n.use(initReactI18next).init({
    lng: language,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
  });
}
