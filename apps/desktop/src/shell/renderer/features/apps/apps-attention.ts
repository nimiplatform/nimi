import type { DesktopAppAIConfigIssue, DesktopAppsEntry } from './apps-panel-projection.js';
import { groupAppsEntries } from './apps-entry-groups.js';

export interface AppsAttentionIssue extends DesktopAppAIConfigIssue {
  readonly key: string;
  readonly apps: readonly DesktopAppsEntry[];
}

// @nimi-authority: rule.nimi.desktop.shell-ui.r102
export function collectAppsAIConfigIssues(entries: readonly DesktopAppsEntry[]): readonly AppsAttentionIssue[] {
  const issues = new Map<string, { issue: DesktopAppAIConfigIssue; apps: DesktopAppsEntry[] }>();
  for (const group of groupAppsEntries(entries)) {
    for (const entry of group.entries) {
      for (const issue of entry.aiConfigSummary?.issues ?? []) {
        // All Local intents consume the same machine selection. Cloud belongs
        // to its App owner, irrespective of how many source registrations exist.
        const key = JSON.stringify([issue.route, issue.route === 'cloud' ? group.appId : '', issue.capabilityContract]);
        let collected = issues.get(key);
        if (!collected) { collected = { issue, apps: [] }; issues.set(key, collected); }
        if (!collected.apps.some(app => app.identity.appId === group.appId)) collected.apps.push(entry);
      }
    }
  }
  return [...issues].map(([key, value]) => ({ key, ...value.issue, apps: value.apps }));
}
