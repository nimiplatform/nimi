import { useEffect, useRef, useState } from 'react';
import { Button, ConfirmDialog, InlineAlert, SegmentedControl, Surface, Toggle } from '@nimiplatform/kit/ui';
import { Bell, Blocks, Bot, Check, CircleAlert, Info, LoaderCircle, Settings2, type LucideIcon } from 'lucide-react';
import { toLocalDate } from '../domain/time.js';
import type { LanguagePreference, ThemePreference } from '../domain/types.js';
import { formatInstant } from '../i18n/index.js';
import { useDayStore, useDesk, useEngine, useNimiDay } from '../app/context.js';
import { deliver, requestSystemPermission, systemPermission, type SystemPermission, type SystemDeliveryStatus } from '../platform/notifier.js';
import { AgentAvatar, Chip } from './common.js';
import { SettingsSources } from './settings-sources.js';
import { TimeField, timeFieldLabels } from './time-field.js';
import { useUi } from './ui-context.js';
import appPackage from '../../../package.json';
import './settings-page.css';

type SettingsSection = 'reminders' | 'sources' | 'agent' | 'general';

export function SettingsPage() {
  const { copy, actions, store, desk: deskApi } = useNimiDay();
  const { state, saving, unsaved } = useDayStore();
  const desk = useDesk();
  const { now, activityStatus } = useEngine();
  const ui = useUi();
  const pageRef = useRef<HTMLDivElement>(null);
  const notificationAttempt = useRef(0);
  const [section, setSection] = useState<SettingsSection>('reminders');
  const [permission, setPermission] = useState<SystemPermission>(systemPermission);
  const [notificationTest, setNotificationTest] = useState<SystemDeliveryStatus | null>(null);
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const profile = state.profile;
  const today = toLocalDate(now);
  const tabs: { id: SettingsSection; label: string; icon: LucideIcon }[] = [
    { id: 'reminders', label: copy.settings.reminders, icon: Bell },
    { id: 'sources', label: copy.settings.sourceTab, icon: Blocks },
    { id: 'agent', label: copy.settings.agent, icon: Bot },
    { id: 'general', label: copy.settings.general, icon: Settings2 },
  ];
  const selectSection = (next: SettingsSection) => {
    setSection(next);
    pageRef.current?.scrollIntoView({ block: 'start' });
  };
  useEffect(() => {
    const refresh = () => { notificationAttempt.current += 1; setPermission(systemPermission()); setNotificationTest(null); };
    globalThis.addEventListener('focus', refresh);
    return () => { notificationAttempt.current += 1; globalThis.removeEventListener('focus', refresh); };
  }, []);

  const saveState = saving === 'error' ? 'error' : saving === 'saving' || unsaved ? 'saving' : 'saved';

  return (
    <div ref={pageRef} className="nd-page nd-settings-page" data-testid="nd-settings">
      <header className="nd-settings-heading">
        <h1>{copy.settings.title}</h1>
        <div className="nd-settings-save" role="status" data-state={saveState} data-error={saveState === 'error'}>
          {saveState === 'saved' ? <Check size={13} strokeWidth={2.5} aria-hidden="true" /> : null}
          {saveState === 'saving' ? <LoaderCircle size={13} aria-hidden="true" /> : null}
          {saveState === 'error' ? <CircleAlert size={13} aria-hidden="true" /> : null}
          <span>{saveState === 'error' ? copy.common.saveFailed : saveState === 'saving' ? copy.common.saving : copy.settings.saved}</span>
          {saveState === 'error' ? <button type="button" className="nd-link" onClick={() => { void store.persist(); }}>{copy.common.retrySave}</button> : null}
        </div>
      </header>
      <div className="nd-settings-tabs" role="tablist" aria-label={copy.settings.title}>
        {tabs.map((tab, index) => {
          const TabIcon = tab.icon;
          return <button key={tab.id} type="button" role="tab" id={`nd-settings-tab-${tab.id}`} className="nd-settings-tab"
            aria-selected={section === tab.id} aria-controls={`nd-settings-panel-${tab.id}`} tabIndex={section === tab.id ? 0 : -1}
            onClick={() => selectSection(tab.id)} onKeyDown={event => {
              const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
              if (next !== null) { event.preventDefault(); selectSection(tabs[next]!.id); document.getElementById(`nd-settings-tab-${tabs[next]!.id}`)?.focus(); }
            }}><TabIcon size={15} strokeWidth={2} aria-hidden="true" />{tab.label}</button>;
        })}
      </div>

      <div className="nd-settings-panel" role="tabpanel" id="nd-settings-panel-reminders" aria-labelledby="nd-settings-tab-reminders" hidden={section !== 'reminders'} tabIndex={0}>
        <Surface as="section" tone="card" elevation="base" padding="none" className="nd-settings-card" aria-labelledby="nd-settings-delivery">
          <h2 id="nd-settings-delivery" className="nd-settings-card-title">{copy.settings.deliveryHeading}</h2>
          <div className="nd-settings-row nd-settings-row--top">
            <div className="nd-setting-text">
              <span className="nd-setting-title">{copy.settings.systemNotifications}</span>
              <span className="nd-setting-hint">{copy.settings.systemNotificationsHint}</span>
              {!profile.systemNotifications && permission === 'unsupported' ? <span className="nd-settings-warning">{copy.settings.permission.unsupported}</span> : null}
              {profile.systemNotifications ? <>
                <div className="nd-settings-controls">
                  {permission !== 'granted' ? <span className={permission === 'denied' || permission === 'unsupported' ? 'nd-settings-warning' : 'nd-faint'}>{copy.settings.permission[permission]}</span> : null}
                  {permission === 'default' ? <Button tone="secondary" size="sm" onClick={() => { void requestSystemPermission().then(setPermission); }}>{copy.settings.requestPermission}</Button> : null}
                  {permission === 'granted' ? <Button tone="ghost" size="sm" onClick={() => {
                    const attempt = ++notificationAttempt.current;
                    setPermission(systemPermission());
                    deliver({ title: copy.settings.testTitle, body: copy.settings.testBody, tag: 'test', system: true,
                      onSystemStatus: status => { if (notificationAttempt.current === attempt) setNotificationTest(status); } });
                  }}>{copy.settings.testNotification}</Button> : null}
                </div>
                {permission === 'denied' ? <p className="nd-settings-feedback">{copy.settings.permissionHelp}</p> : null}
                {notificationTest ? <p role="status" className={notificationTest === 'failed' || notificationTest === 'unavailable' || notificationTest === 'unconfirmed' ? 'nd-settings-warning' : 'nd-settings-feedback'}>{copy.settings.testStatus[notificationTest]}</p> : null}
              </> : null}
            </div>
            <Toggle checked={profile.systemNotifications} disabled={permission === 'unsupported'} ariaLabel={copy.settings.systemNotifications} onValueChange={value => {
              notificationAttempt.current += 1;
              actions.updateProfile({ systemNotifications: value });
              setNotificationTest(null);
              setPermission(systemPermission());
              if (value && systemPermission() === 'default') void requestSystemPermission().then(setPermission);
            }} />
          </div>
          <div className="nd-settings-row">
            <div className="nd-setting-text">
              <span className="nd-setting-title">{copy.settings.homeMessages}</span>
              <span className="nd-setting-hint">{activityStatus === 'no-access' ? copy.settings.homeNoAccess : copy.settings.homeMessagesHint}</span>
            </div>
            <Toggle checked={profile.homeMessages} disabled={activityStatus === 'no-access'} ariaLabel={copy.settings.homeMessages} onValueChange={value => actions.updateProfile({ homeMessages: value })} />
          </div>
        </Surface>

        <Surface as="section" tone="card" elevation="base" padding="none" className="nd-settings-card" aria-labelledby="nd-settings-timing">
          <h2 id="nd-settings-timing" className="nd-settings-card-title">{copy.settings.timingHeading}</h2>
          <div className="nd-settings-row nd-settings-row--top">
            <div className="nd-setting-text">
              <span className="nd-setting-title">{copy.settings.quiet}</span>
              <span className="nd-setting-hint">{copy.settings.quietHint}</span>
              {profile.quiet.enabled ? <>
                <div className="nd-settings-times">
                  <label><span>{copy.settings.from}</span><TimeField aria-label={copy.settings.from} value={profile.quiet.start}
                    style={{ width: 104 }} labels={timeFieldLabels(copy, copy.settings.from)}
                    onValueChange={start => actions.updateProfile({ quiet: { ...profile.quiet, start } })} /></label>
                  <label><span>{copy.settings.to}</span><TimeField aria-label={copy.settings.to} value={profile.quiet.end}
                    style={{ width: 104 }} labels={timeFieldLabels(copy, copy.settings.to)}
                    onValueChange={end => actions.updateProfile({ quiet: { ...profile.quiet, end } })} /></label>
                  {profile.quiet.end < profile.quiet.start ? <span className="nd-faint">{copy.settings.nextDay}</span> : null}
                </div>
                {profile.quiet.start === profile.quiet.end ? <p className="nd-settings-warning" role="status">{copy.settings.quietSameTime}</p> : null}
              </> : null}
            </div>
            <Toggle checked={profile.quiet.enabled} ariaLabel={copy.settings.quiet} onValueChange={enabled => actions.updateProfile({ quiet: { ...profile.quiet, enabled } })} />
          </div>
          <div className="nd-settings-row">
            <div className="nd-setting-text"><span className="nd-setting-title">{copy.settings.allDayTime}</span><span className="nd-setting-hint">{copy.settings.allDayHint}</span></div>
            <TimeField aria-label={copy.settings.allDayTime} value={profile.allDayRemindTime}
              style={{ width: 104 }} labels={timeFieldLabels(copy, copy.settings.allDayTime)}
              onValueChange={allDayRemindTime => actions.updateProfile({ allDayRemindTime })} />
          </div>
        </Surface>
        <InlineAlert tone="info" icon={<Info size={16} aria-hidden="true" />} className="nd-settings-note">
          <strong>{copy.settings.runtimeTitle}</strong>
          <details><summary>{copy.settings.runtimeDetails}</summary><p>{copy.settings.aboutRuntime}</p></details>
        </InlineAlert>
      </div>

      <div className="nd-settings-panel" role="tabpanel" id="nd-settings-panel-sources" aria-labelledby="nd-settings-tab-sources" hidden={section !== 'sources'} tabIndex={0}>
        <SettingsSources />
      </div>

      <div className="nd-settings-panel" role="tabpanel" id="nd-settings-panel-agent" aria-labelledby="nd-settings-tab-agent" hidden={section !== 'agent'} tabIndex={0}>
        <p className="nd-settings-intro">{copy.settings.agentIntro}</p>
        <Surface as="section" tone="card" elevation="base" padding="none" className="nd-settings-card" aria-label={copy.settings.agent}>
          <div className="nd-settings-agent-head">
            <div className="nd-settings-agent">
              {profile.appointment ? <AgentAvatar name={desk.agent?.displayName ?? profile.appointment.displayName} url={desk.agent?.avatarUrl ?? profile.appointment.avatarUrl ?? null} size="lg" /> : null}
              <div><strong>{desk.agent?.displayName ?? profile.appointment?.displayName ?? copy.agent.none}</strong>
                {profile.appointment ? <div className="nd-faint">{copy.agent.since(formatInstant(copy, profile.appointment.appointedAt, today))}</div> : null}
              </div>
            </div>
            <Button tone="secondary" size="sm" onClick={ui.appointAgent}>{profile.appointment ? copy.settings.changeAgent : copy.agent.appoint}</Button>
          </div>
          <p className="nd-settings-agent-note">{copy.settings.agentHint}</p>
          {profile.appointment ? <div className="nd-settings-row nd-settings-row--wrap nd-settings-danger-row">
            <div className="nd-setting-text"><span className="nd-setting-title">{copy.settings.unappoint}</span><span className="nd-setting-hint">{copy.settings.unappointHint}</span></div>
            <Button tone="danger" size="sm" onClick={() => setConfirmDismiss(true)}>{copy.settings.unappoint}</Button>
          </div> : null}
        </Surface>
        {profile.appointmentHistory.length > 0 ? <details className="nd-settings-history">
          <summary>{copy.settings.agentHistory}</summary>
          <ul className="nd-changes-list">{[...profile.appointmentHistory].reverse().map((record, index) => <li key={`${record.from}-${index}`}>
            {record.displayName} · {formatInstant(copy, record.from, today)}{record.to ? ` – ${formatInstant(copy, record.to, today)}` : ''}
          </li>)}</ul>
        </details> : null}
        <ConfirmDialog open={confirmDismiss} title={copy.settings.unappointConfirmTitle} message={copy.settings.unappointConfirm}
          confirmLabel={copy.settings.unappoint} cancelLabel={copy.common.cancel} confirmTone="danger" onClose={() => setConfirmDismiss(false)}
          onConfirm={() => { actions.dismissAppointment(); void deskApi.start(null); setConfirmDismiss(false); }} />
      </div>

      <div className="nd-settings-panel" role="tabpanel" id="nd-settings-panel-general" aria-labelledby="nd-settings-tab-general" hidden={section !== 'general'} tabIndex={0}>
        <Surface as="section" tone="card" elevation="base" padding="none" className="nd-settings-card" aria-labelledby="nd-settings-appearance">
          <h2 id="nd-settings-appearance" className="nd-settings-card-title">{copy.settings.appearance}</h2>
          <div className="nd-settings-row nd-settings-row--wrap">
            <span className="nd-setting-title">{copy.settings.theme}</span>
            <SegmentedControl ariaLabel={copy.settings.theme} size="sm" value={profile.theme}
              onValueChange={value => actions.updateProfile({ theme: value as ThemePreference })}
              items={(['system', 'light', 'dark'] as const).map(value => ({ value, label: copy.settings.themes[value] }))} />
          </div>
          <div className="nd-settings-row nd-settings-row--wrap">
            <span className="nd-setting-title">{copy.settings.language}</span>
            <SegmentedControl ariaLabel={copy.settings.language} size="sm" value={profile.language}
              onValueChange={value => actions.updateProfile({ language: value as LanguagePreference })}
              items={(['auto', 'zh', 'en'] as const).map(value => ({ value, label: copy.settings.languages[value] }))} />
          </div>
        </Surface>
        <Surface as="section" tone="card" elevation="base" padding="none" className="nd-settings-card nd-settings-about" aria-labelledby="nd-settings-data">
          <div className="nd-settings-about-heading"><h2 id="nd-settings-data">NimiDay</h2><Chip tone="accent">{copy.settings.version(appPackage.version)}</Chip></div>
          <p>{copy.settings.aboutData}</p>
        </Surface>
      </div>
    </div>
  );
}
