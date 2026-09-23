import { useMemo } from 'react';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { mergeActivitySnapshots } from './home-app-activity-model.js';
import { useHomeAppActivity, type HomeAppActivity } from './home-app-activity.js';
import {
  activityMessage,
  isHideableMessage,
  realmPostMessage,
  type HomeMessage,
  type HomeSystemItemMessage,
} from './home-messages-model.js';
import {
  isHiddenFromHome,
  isSourceOffHome,
  useHomeMessagePreferences,
  type HomeMessagePreferences,
  type HomeMessagePreferencesController,
  type HomeMessagePreferencesStorage,
} from './home-messages-preferences.js';
import { HOME_REALM_POST_PREVIEW, useHomeRealmPosts, type HomeRealmPosts } from './home-realm-posts.js';

/** Where a message stands relative to the Home preview. */
export type HomeMessagePlacement = 'shown' | 'hidden' | 'source-off';

export type HomeMessages = Readonly<{
  /** Every loaded message of every source. */
  messages: readonly HomeMessage[];
  /** Messages the Home preview may show; null while display preferences load. */
  homeMessages: readonly HomeMessage[] | null;
  /** Loaded messages kept off Home by hiding or a source display choice. */
  offHomeCount: number;
  app: HomeAppActivity;
  realm: HomeRealmPosts;
  preferences: HomeMessagePreferencesController;
  placement: (message: HomeMessage) => HomeMessagePlacement;
  open: (message: HomeMessage) => void;
  markRead: (message: HomeMessage) => void;
  /** Hides exactly these messages from Home (a card or a group snapshot); true once saved. */
  hide: (messages: readonly HomeMessage[]) => Promise<boolean>;
  showOnHome: (message: HomeMessage) => void;
}>;

function placementOf(message: HomeMessage, preferences: HomeMessagePreferences | null): HomeMessagePlacement {
  if (!preferences) return 'shown';
  if (isHiddenFromHome(message, preferences)) return 'hidden';
  return isSourceOffHome(message, preferences) ? 'source-off' : 'shown';
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r036
/**
 * One consumption layer for the Home preview and the Message center: each
 * source keeps its owner, cursor and actions, and entering the center starts
 * no second App activity subscription. Mounted once per account.
 */
export function useHomeMessages(input: Readonly<{
  systemMessages: readonly HomeSystemItemMessage[];
}>): HomeMessages {
  const sdk = useDesktopRendererSdk();
  const openActivityPost = useAppStore((state) => state.openActivityPost);
  const app = useHomeAppActivity();
  const realm = useHomeRealmPosts(true);
  const storage = useMemo<HomeMessagePreferencesStorage>(() => ({
    readJson: (relativePath) => sdk.appProduct().storage.readJson(relativePath),
    writeJson: (relativePath, value) => sdk.appProduct().storage.writeJson(relativePath, value),
  }), [sdk]);
  const preferences = useHomeMessagePreferences(storage);
  const ready = preferences.state.status === 'ready' ? preferences.state.preferences : null;

  const messages = useMemo<HomeMessage[]>(() => [
    ...input.systemMessages,
    ...mergeActivitySnapshots(app.pending, app.recent).map(activityMessage),
    ...realm.posts.map(realmPostMessage),
  ], [app.pending, app.recent, input.systemMessages, realm.posts]);

  const { homeMessages, offHomeCount } = useMemo(() => {
    if (preferences.state.status === 'loading') return { homeMessages: null, offHomeCount: 0 };
    // Unreadable preferences keep every message visible rather than guessing.
    const onHome = messages.filter((message) => placementOf(message, ready) === 'shown');
    let realmPosts = 0;
    return {
      homeMessages: onHome.filter((message) => message.sourceKind !== 'realm-post' || (realmPosts += 1) <= HOME_REALM_POST_PREVIEW),
      offHomeCount: messages.length - onHome.length,
    };
  }, [messages, preferences.state.status, ready]);

  return {
    messages,
    homeMessages,
    offHomeCount,
    app,
    realm,
    preferences,
    placement: (message) => placementOf(message, ready),
    open: (message) => {
      if (message.sourceKind === 'system') message.system.open();
      else if (message.sourceKind === 'realm-post') openActivityPost(message.post.id);
      else app.open(message.record);
    },
    markRead: (message) => {
      if (message.sourceKind === 'app' || message.sourceKind === 'runtime-agent') app.markRead(message.record);
    },
    hide: (targets) => {
      const hideable = targets.filter(isHideableMessage);
      if (!hideable.length) return Promise.resolve(false);
      return preferences.apply({
        kind: 'hide',
        activities: hideable.flatMap((message) => (message.sourceKind === 'app' || message.sourceKind === 'runtime-agent'
          ? [{ activityId: message.record.activityId, revision: message.record.revision }]
          : [])),
        realmPostIds: hideable.flatMap((message) => (message.sourceKind === 'realm-post' ? [message.post.id] : [])),
      });
    },
    showOnHome: (message) => {
      if (message.sourceKind === 'realm-post') void preferences.apply({ kind: 'show', realmPostId: message.post.id });
      else if (message.sourceKind !== 'system') void preferences.apply({ kind: 'show', activityId: message.record.activityId });
    },
  };
}
