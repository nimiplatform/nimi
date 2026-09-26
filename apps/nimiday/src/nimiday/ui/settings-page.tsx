import { useState } from 'react';
import { Button, SegmentedControl, SelectField, Toggle } from '@nimiplatform/kit/ui';
import { sourceGroupFor, sourcePreferenceFor } from '../domain/sources.js';
import { toLocalDate } from '../domain/time.js';
import type { LanguagePreference, ThemePreference } from '../domain/types.js';
import { formatInstant } from '../i18n/index.js';
import { useDayStore, useDesk, useEngine, useNimiDay } from '../app/context.js';
import { deliver, requestSystemPermission, systemPermission, type SystemPermission } from '../platform/notifier.js';
import { AgentAvatar, Card, Chip, Hint, PageHead } from './common.js';
import { SourceCoverageNote } from './source-row.js';
import { useUi } from './ui-context.js';

import appPackage from '../../../package.json';

export function SettingsPage() {
  const { copy, actions, desk: deskApi } = useNimiDay();
  const { state } = useDayStore();
  const desk = useDesk();
  const { now, sourceApps, activityStatus } = useEngine();
  const ui = useUi();
  const [permission, setPermission] = useState<SystemPermission>(systemPermission);
  const profile = state.profile;
  const today = toLocalDate(now);

  const circleOptions = [
    { value: 'auto', label: copy.settings.sourceAuto },
    ...state.circles.filter((circle) => circle.status !== 'ended').map((circle) => ({ value: circle.id, label: circle.name })),
  ];
  const groupOptions = [{ value: 'auto', label: copy.settings.sourceGroupFollow }, ...circleOptions.slice(1)];

  return (
    <div className="nd-page nd-page--narrow" data-testid="nd-settings">
      <PageHead title={copy.settings.title} />
      <div className="nd-stack">
        <Card title={copy.settings.agent} hint={copy.settings.agentHint}>
          <div className="nd-split">
            <div className="nd-inline-actions" style={{ gap: 12 }}>
              {desk.agent ? <AgentAvatar name={desk.agent.displayName} url={desk.agent.avatarUrl} /> : null}
              <div>
                <strong>{desk.agent?.displayName ?? profile.appointment?.displayName ?? copy.agent.none}</strong>
                {profile.appointment ? <div className="nd-faint">{copy.agent.since(formatInstant(copy, profile.appointment.appointedAt, today))}</div> : null}
              </div>
            </div>
            <div className="nd-inline-actions">
              <Button tone="secondary" size="sm" onClick={ui.appointAgent}>{profile.appointment ? copy.settings.changeAgent : copy.agent.appoint}</Button>
              {profile.appointment ? (
                <Button tone="ghost" size="sm" onClick={() => { actions.dismissAppointment(); void deskApi.start(null); }}>{copy.settings.unappoint}</Button>
              ) : null}
            </div>
          </div>
          {profile.appointmentHistory.length > 1 ? (
            <ul className="nd-changes-list">
              {[...profile.appointmentHistory].reverse().slice(0, 6).map((record) => (
                <li key={`${record.displayName}-${record.from}`}>
                  {record.displayName} · {formatInstant(copy, record.from, today)}{record.to ? ` – ${formatInstant(copy, record.to, today)}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        <Card title={copy.settings.reminders}>
          <div className="nd-setting">
            <div className="nd-setting-text">
              <span className="nd-setting-title">{copy.settings.systemNotifications}</span>
              <span className="nd-setting-hint">{copy.settings.systemNotificationsHint} · {copy.settings.permission[permission]}</span>
            </div>
            <div className="nd-inline-actions">
              {permission === 'default' ? (
                <Button tone="ghost" size="sm" onClick={() => { void requestSystemPermission().then(setPermission); }}>{copy.settings.requestPermission}</Button>
              ) : null}
              {permission === 'granted' && profile.systemNotifications ? (
                <Button tone="ghost" size="sm" onClick={() => deliver({ title: copy.settings.testTitle, body: copy.settings.testBody, tag: 'test', system: true })}>{copy.settings.testNotification}</Button>
              ) : null}
              <Toggle checked={profile.systemNotifications} ariaLabel={copy.settings.systemNotifications} onValueChange={(value) => {
                actions.updateProfile({ systemNotifications: value });
                if (value && systemPermission() === 'default') void requestSystemPermission().then(setPermission);
              }} />
            </div>
          </div>
          <div className="nd-setting">
            <div className="nd-setting-text">
              <span className="nd-setting-title">{copy.settings.homeMessages}</span>
              <span className="nd-setting-hint">{activityStatus === 'no-access' ? copy.settings.homeNoAccess : copy.settings.homeMessagesHint}</span>
            </div>
            <Toggle checked={profile.homeMessages} ariaLabel={copy.settings.homeMessages} onValueChange={(value) => actions.updateProfile({ homeMessages: value })} />
          </div>
          <div className="nd-setting">
            <div className="nd-setting-text">
              <span className="nd-setting-title">{copy.settings.quiet}</span>
              <span className="nd-setting-hint">{copy.settings.quietHint}</span>
            </div>
            <div className="nd-inline-actions">
              <input className="nd-native-input" type="time" aria-label={copy.settings.from} value={profile.quiet.start} disabled={!profile.quiet.enabled}
                onChange={(event) => actions.updateProfile({ quiet: { ...profile.quiet, start: event.target.value || profile.quiet.start } })} />
              <span className="nd-faint">–</span>
              <input className="nd-native-input" type="time" aria-label={copy.settings.to} value={profile.quiet.end} disabled={!profile.quiet.enabled}
                onChange={(event) => actions.updateProfile({ quiet: { ...profile.quiet, end: event.target.value || profile.quiet.end } })} />
              <Toggle checked={profile.quiet.enabled} ariaLabel={copy.settings.quiet} onValueChange={(value) => actions.updateProfile({ quiet: { ...profile.quiet, enabled: value } })} />
            </div>
          </div>
          <div className="nd-setting">
            <span className="nd-setting-title">{copy.settings.allDayTime}</span>
            <input className="nd-native-input" type="time" aria-label={copy.settings.allDayTime} value={profile.allDayRemindTime}
              onChange={(event) => actions.updateProfile({ allDayRemindTime: event.target.value || profile.allDayRemindTime })} />
          </div>
        </Card>

        <Card title={copy.settings.sources} hint={copy.settings.sourcesHint}>
          {activityStatus === 'no-access' ? (
            <>
              <p className="nd-muted" style={{ margin: 0, fontSize: 13 }}>{copy.today.sourcesNoAccess}</p>
              <p className="nd-faint" style={{ margin: '6px 0 0' }}>{copy.today.sourcesNoAccessBody}</p>
            </>
          ) : sourceApps.length === 0 ? <Hint>{copy.settings.sourcesEmpty}</Hint> : sourceApps.map((app) => {
            const preference = sourcePreferenceFor(profile, app.appId);
            return (
              <div key={app.appId} className="nd-setting" data-testid="nd-source-setting">
                <div className="nd-setting-text">
                  <span className="nd-setting-title">{app.appName}</span>
                  <span className="nd-setting-hint">{copy.settings.sourceMeta(app.count, formatInstant(copy, app.latestAt, today))}</span>
                </div>
                <div className="nd-inline-actions">
                  <span className="nd-faint">{copy.settings.sourceCircle}</span>
                  <SelectField
                    aria-label={copy.settings.sourceCircle}
                    value={preference.circleId ?? 'auto'}
                    options={circleOptions}
                    onValueChange={(value) => actions.setSourcePreference({ ...preference, circleId: value === 'auto' ? null : value })}
                  />
                  <span className="nd-inline-actions" style={{ gap: 8 }}>
                    <span className="nd-faint">{copy.settings.sourceFollow}</span>
                    <Toggle checked={preference.enabled} ariaLabel={`${copy.settings.sourceFollow} · ${app.appName}`} onValueChange={(value) => actions.setSourcePreference({ ...preference, enabled: value })} />
                  </span>
                </div>
                {app.groups.length >= 2 || (app.groups.length >= 1 && app.ungrouped.count > 0) ? (
                  <div className="nd-source-groups" data-testid="nd-source-groups">
                    <p className="nd-faint" style={{ margin: 0 }}>{copy.settings.sourceGroupsHint(app.appName)}</p>
                    {app.groups.map((group, index) => (
                      <div key={group.key} className="nd-setting" data-testid="nd-source-group">
                        <div className="nd-setting-text">
                          <span className="nd-setting-title">{copy.settings.sourceGroup(index + 1)}</span>
                          <span className="nd-setting-hint">{group.examples.join('、')}</span>
                        </div>
                        <SelectField
                          aria-label={copy.settings.sourceGroup(index + 1)}
                          value={sourceGroupFor(profile, group.key)?.circleId ?? 'auto'}
                          options={groupOptions}
                          onValueChange={(value) => actions.setSourceGroup({ key: group.key, appId: app.appId, circleId: value === 'auto' ? null : value })}
                        />
                      </div>
                    ))}
                    {app.groups.length > 0 && app.ungrouped.count > 0 ? (
                      <p className="nd-faint" style={{ margin: '4px 0 0' }}>{copy.settings.sourceUngrouped(app.ungrouped.examples.join('、'))}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          <SourceCoverageNote />
        </Card>

        <Card title={copy.settings.appearance}>
          <div className="nd-setting">
            <span className="nd-setting-title">{copy.settings.theme}</span>
            <SegmentedControl
              ariaLabel={copy.settings.theme}
              size="sm"
              value={profile.theme}
              onValueChange={(value) => actions.updateProfile({ theme: value as ThemePreference })}
              items={(['system', 'light', 'dark'] as const).map((value) => ({ value, label: copy.settings.themes[value] }))}
            />
          </div>
          <div className="nd-setting">
            <span className="nd-setting-title">{copy.settings.language}</span>
            <SegmentedControl
              ariaLabel={copy.settings.language}
              size="sm"
              value={profile.language}
              onValueChange={(value) => actions.updateProfile({ language: value as LanguagePreference })}
              items={(['auto', 'zh', 'en'] as const).map((value) => ({ value, label: copy.settings.languages[value] }))}
            />
          </div>
        </Card>

        <Card title={copy.settings.about}>
          <p className="nd-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>{copy.settings.aboutRuntime}</p>
          <p className="nd-muted" style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.6 }}>{copy.settings.aboutData}</p>
          <div className="nd-row-meta" style={{ marginTop: 10 }}>
            <Chip>{copy.settings.version(appPackage.version)}</Chip>
          </div>
        </Card>
      </div>
    </div>
  );
}
