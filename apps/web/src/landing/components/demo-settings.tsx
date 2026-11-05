import { useState, type ReactNode } from 'react';
import type { HeroDemo } from '../content/landing-content.js';
import { DemoRow, DemoWorkspace, demoText } from './demo-home-ui.js';

export type DemoPreferences = {
  theme: 'system' | 'light' | 'dark';
  reducedMotion: boolean;
  notifications: boolean;
  sound: boolean;
  developer: boolean;
  visibility: string;
};

function Setting({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="demo-setting-row">
      <div>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </div>
      {children}
    </div>
  );
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      className="demo-toggle"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={onChange}
    >
      <span />
    </button>
  );
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r023
export function DemoSettingsSurface({
  demo,
  target,
  preferences,
  onPreferences,
  onLocale,
}: {
  demo: HeroDemo;
  target?: string;
  preferences: DemoPreferences;
  onPreferences: (next: DemoPreferences) => void;
  onLocale: (locale: 'zh' | 'en') => void;
}) {
  const t = demoText(demo);
  const [section, setSection] = useState(target ?? 'appearance');
  const title = demo.home.settingsGroups
    .flatMap((group) => group.items)
    .find((item) => item.id === section)!.label;
  const toggle = (key: 'notifications' | 'sound' | 'reducedMotion' | 'developer', label: string) => (
    <Toggle
      label={label}
      checked={preferences[key]}
      onChange={() => onPreferences({ ...preferences, [key]: !preferences[key] })}
    />
  );
  return (
    <DemoWorkspace
      title={demo.nav.settings}
      sidebar={
        <div className="demo-sidebar-scroll">
          {demo.home.settingsGroups.map((group) => (
            <div key={group.label}>
              <p className="demo-sidebar-label">{group.label}</p>
              {group.items.map((item) => (
                <DemoRow
                  key={item.id}
                  label={item.label}
                  active={section === item.id}
                  onClick={() => setSection(item.id)}
                />
              ))}
            </div>
          ))}
        </div>
      }
    >
      <div className="demo-settings-page">
        <h1>{title}</h1>
        <p className="demo-muted mt-2 mb-6">
          {section === 'appearance'
            ? t('仅对当前设备生效。', 'Applies only to this device.')
            : demo.home.badge}
        </p>
        <div className="demo-management-card">
          {section === 'appearance' && (
            <>
              <Setting label={t('配色主题', 'Color theme')}>
                <div className="demo-tabs">
                  {(['system', 'light', 'dark'] as const).map((value, index) => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={preferences.theme === value}
                      onClick={() => onPreferences({ ...preferences, theme: value })}
                    >
                      {[t('跟随系统', 'System'), t('浅色', 'Light'), t('深色', 'Dark')][index]}
                    </button>
                  ))}
                </div>
              </Setting>
              <Setting
                label={t('语言', 'Language')}
                description={t('更改将立即生效。', 'Changes take effect immediately.')}
              >
                <select
                  aria-label={t('语言', 'Language')}
                  value={demo.appPreview.locale}
                  onChange={(event) => onLocale(event.target.value as 'en' | 'zh')}
                >
                  <option value="zh">简体中文</option>
                  <option value="en">English</option>
                </select>
              </Setting>
              <Setting
                label={t('减少动效', 'Reduce motion')}
                description={t(
                  '尽量减少非必要的动画与过渡效果。',
                  'Reduce nonessential animations and transitions.',
                )}
              >
                {toggle('reducedMotion', t('减少动效', 'Reduce motion'))}
              </Setting>
            </>
          )}
          {section === 'notifications' && (
            <>
              <Setting label={t('桌面通知', 'Desktop notifications')}>
                {toggle('notifications', t('桌面通知', 'Desktop notifications'))}
              </Setting>
              <Setting label={t('提示音', 'Notification sound')}>
                {toggle('sound', t('提示音', 'Notification sound'))}
              </Setting>
              <Setting
                label={t('消息中心', 'Message center')}
                description={t(
                  '集中查看应用消息、待处理事项和系统进度。',
                  'Review app messages, pending items, and system progress.',
                )}
              >
                <span>{t('已开启', 'Enabled')}</span>
              </Setting>
            </>
          )}
          {section === 'profile' && (
            <>
              <Setting label={t('显示名称', 'Display name')}>
                <strong>{demo.chat.self.name}</strong>
              </Setting>
              <Setting label={t('用户名', 'Username')}>
                <span>{demo.chat.self.handle}</span>
              </Setting>
              <Setting label={t('简介', 'Bio')}>
                <span>{demo.chat.self.bio}</span>
              </Setting>
            </>
          )}
          {section === 'privacy' && (
            <>
              <Setting
                label={t('可见性', 'Visibility')}
                description={t('选择谁可以查看你的个人资料。', 'Choose who can see your profile.')}
              >
                <select
                  aria-label={t('可见性', 'Visibility')}
                  value={preferences.visibility}
                  onChange={(event) => onPreferences({ ...preferences, visibility: event.target.value })}
                >
                  <option value="friends">{t('仅好友', 'Friends only')}</option>
                  <option value="public">{t('公开', 'Public')}</option>
                  <option value="private">{t('仅自己', 'Only me')}</option>
                </select>
              </Setting>
              <Setting label={t('屏蔽名单', 'Blocked users')}>
                <span>{t('暂无屏蔽用户', 'No blocked users')}</span>
              </Setting>
            </>
          )}
          {section === 'security' && (
            <>
              <Setting
                label={t('登录方式', 'Sign-in methods')}
                description={t(
                  '密码、登录方式与双重验证在浏览器中管理。',
                  'Manage passwords, sign-in methods, and two-factor authentication in your browser.',
                )}
              >
                <span>{t('Nimi 账户', 'Nimi account')}</span>
              </Setting>
              <h2 className="my-4">{t('登录会话', 'Login sessions')}</h2>
              <Setting
                label="Nimi Home · macOS"
                description={t("当前会话 · 此设备", "Current session · This device")}
              >
                <span className="demo-success">{t('当前', 'Current')}</span>
              </Setting>
            </>
          )}
          {section === 'data' && (
            <>
              <h2>{t('存储用量', 'Storage usage')}</h2>
              <Setting label={t('本机模型', 'Local models')}>
                <strong>9.80 GB</strong>
              </Setting>
              <Setting label={t('应用数据', 'App data')}>
                <strong>246 MB</strong>
              </Setting>
              <Setting label={t('缓存', 'Cache')}>
                <strong>18 MB</strong>
              </Setting>
              <p className="demo-muted mt-4">
                {t(
                  '实际数据目录和清理操作在 Nimi Home 中管理。',
                  'Manage actual data directories and cleanup in Nimi Home.',
                )}
              </p>
            </>
          )}
          {section === 'developer' && <div data-tour-anchor="developer">
            <Setting
              label={t('开发者模式', 'Developer mode')}
              description={t(
                '显示本地开发注册和开发工具入口。',
                'Show local development registrations and developer tools.',
              )}
            >
              {toggle('developer', t('开发者模式', 'Developer mode'))}
            </Setting>
          </div>}
          {section === 'troubleshooting' && (
            <>
              <h2>{t('运行状态', 'Service status')}</h2>
              {['Runtime', 'Realm', 'Nimi Home'].map((name) => (
                <Setting key={name} label={name}>
                  <span className="demo-success">{t('正常', 'Healthy')}</span>
                </Setting>
              ))}
            </>
          )}
          {section === 'logs' && (
            <>
              <h2>{t('本地日志', 'Local logs')}</h2>
              <p className="demo-muted my-4">
                {t(
                  '在 Nimi Home 中选择时间范围并导出本机日志，用于排查问题。日志可能包含设备和应用诊断信息，分享前请先检查。',
                  'Select a time range in Nimi Home and export local logs for troubleshooting. Logs may contain device and app diagnostic information; review them before sharing.',
                )}
              </p>
              <details>
                <summary>{t("查看日志", "View log")}</summary>
                <pre className="demo-log">
                  14:20:00 [demo] Runtime healthy
                  <br />
                  14:20:01 [demo] Home ready
                </pre>
              </details>
            </>
          )}
        </div>
      </div>
    </DemoWorkspace>
  );
}
