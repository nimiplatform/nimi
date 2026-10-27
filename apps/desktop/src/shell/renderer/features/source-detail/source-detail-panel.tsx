import { useHomeNavigation, useHomeDestination } from '../../app-shell/providers/app-store.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAppStore, useAppStoreApi } from '../../app-shell/providers/app-store';
import { captureAccountActionScope } from '../../app-shell/providers/account-action-scope.js';
import { captureHomeNavigationScope } from '../../app-shell/providers/home-navigation.js';
import { characterSourceMaterializationFailureMessage, characterSourceMaterializationMessage, characterSourceRefKey, resolveCharacterSourceState } from '../explore/character-source-materialization';
import { CharacterSourceConfirmationPendingError, createAnotherCharacterSourcePartner, ensureCharacterSourceMaterialized } from '../relationship/character-source-launch-target.js';
import { localAgentListQueryKey } from '../agents/local-agent-list-model';
import { isSameCharacter, readPartnerDirectoryForSource } from '../agents/partner-directory-model.js';
import { openPartnerConversation } from '../agents/partner-navigation.js';
import { AgentLifecycleStatus } from '@nimiplatform/sdk/runtime/wire-types';
import { launchAgentConversationFromDisplay } from '../chat/agent-conversation-launcher.js';

import { sourceDisplayDetailQueryKey, fetchSourceDisplayDetail } from './source-detail-queries.js';
import { SourceDetailView } from './source-detail-view.js';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import type { CharacterSourceRefV3 } from '../realm-source/realm-source-identity.js';

export function SourceDetailPanel({
  sourceRef: sourceRefProp,
  onBack,
}: {
  // Embedded hosts may supply an explicit source; otherwise navigation owns it.
  sourceRef?: CharacterSourceRefV3 | null;
  onBack?: (() => void) | null;
} = {}) {

  const navigation = useHomeNavigation();
  const bindings = useDesktopRendererBindings();
  const appStore = useAppStoreApi();
  const i18n = useDesktopI18nResource().instance;
  const queryClient = useQueryClient();
  const authStatus = useAppStore((state) => state.auth.status);
  const ownerUserId = useAppStore((state) => String(state.auth.user?.id || '').trim());
  const realmBaseUrl = useAppStore((state) => state.runtimeDefaults?.realm.realmBaseUrl ?? '');
  const authorizationRevision = useAppStore((state) => state.auth.authorizationRevision);
  const storeSelectedSourceRef = useHomeDestination().sourceRef ?? null;
  const selectedSourceRef = sourceRefProp === undefined ? storeSelectedSourceRef : sourceRefProp;

  const setAgentConversationTargetSnapshot = useAppStore((state) => state.setAgentConversationTargetSnapshot);
  const setPendingAgentComposerPrefill = useAppStore((state) => state.setPendingAgentComposerPrefill);
  const setFeedback = emitFeedbackToast;
  // Only track an in-flight action. Availability belongs to current owner data.
  const [sourceMaterialization, setSourceMaterialization] = useState<{
    sourceKey: string;
    ownerUserId: string;
  } | null>(null);
  const currentAction = useRef<{ sourceKey: string; ownerUserId: string } | null>(null);
  const materializationInFlight = useRef(false);
  const selectedSourceKey = selectedSourceRef ? characterSourceRefKey(selectedSourceRef) : '';
  currentAction.current = { sourceKey: selectedSourceKey, ownerUserId };
  useEffect(() => {
    currentAction.current = { sourceKey: selectedSourceKey, ownerUserId };
    return () => { currentAction.current = null; };
  }, [selectedSourceKey, ownerUserId]);

  const profileQuery = useQuery({
    queryKey: selectedSourceRef
      ? [...sourceDisplayDetailQueryKey(selectedSourceRef), realmBaseUrl, ownerUserId, authorizationRevision]
      : ['source-display-detail', 'missing-character-source-ref-v3'],
    queryFn: async () => selectedSourceRef
      ? fetchSourceDisplayDetail(selectedSourceRef, bindings.sdk)
      : null,
    enabled: authStatus === 'authenticated' && Boolean(selectedSourceRef),
  });
  const source = useMemo(() => {
    if (!profileQuery.data) return null;
    return profileQuery.data.source;
  }, [profileQuery.data]);

  const localAgentListQuery = useQuery({
    queryKey: ['source-detail-partners', ownerUserId, realmBaseUrl, authorizationRevision],
    queryFn: () => readPartnerDirectoryForSource(bindings.sdk, ownerUserId),
    enabled: authStatus === 'authenticated' && Boolean(ownerUserId), staleTime: 15_000, networkMode: 'always',
  });
  const matchingPartners = useMemo(() => (localAgentListQuery.data ?? []).filter(partner => isSameCharacter(partner.sourceRef, source?.sourceRef ?? null)), [localAgentListQuery.data, source?.sourceRef]);
  const currentSourceKey = source?.sourceRef ? characterSourceRefKey(source.sourceRef) : null;
  const sourceForView = useMemo(() => {
    if (!source) return null;
    const base = resolveCharacterSourceState(source, [], {
      runtimeInventoryPending: Boolean(ownerUserId) && localAgentListQuery.isPending,
      runtimeInventoryUnavailable: !ownerUserId || localAgentListQuery.isError,
    });
    const sourceState = !localAgentListQuery.isPending && !localAgentListQuery.isError && matchingPartners.length
      ? (matchingPartners.length === 1 ? 'local_agent_available' : 'local_agent_ambiguous') : base;
    return { ...source, sourceState };
  }, [source, ownerUserId, localAgentListQuery.isPending, localAgentListQuery.isError, matchingPartners]);
  const openPartner = (localAgentRef: string) => {
    if (!matchingPartners.some(partner => partner.localAgentRef === localAgentRef)) return;
    void navigation.push({ id: 'explore', exploreSection: 'partners', partner: { localAgentRef } });
  };

  const stats = useMemo(() => {
    if (!profileQuery.data) return null;
    return profileQuery.data.stats;
  }, [profileQuery.data]);

  const ensureCharacterSourceReady = async (isCurrent: () => boolean, another: boolean) => {
    if (!source) {
      throw new Error(characterSourceMaterializationMessage(i18n.t));
    }

    const createdRef = await (another ? createAnotherCharacterSourcePartner : ensureCharacterSourceMaterialized)(source, ownerUserId, i18n.t, bindings.sdk, isCurrent);
    await queryClient.invalidateQueries({ queryKey: ['source-detail-partners', ownerUserId] });
    await queryClient.invalidateQueries({ queryKey: ['home-partners', ownerUserId] });
    await queryClient.invalidateQueries({ queryKey: ['source-detail-local-agents'], exact: false });
    await queryClient.invalidateQueries({ queryKey: localAgentListQueryKey(ownerUserId), exact: true });
    await queryClient.invalidateQueries({ queryKey: ['desktop-local-app-agent-references'], exact: false });
    return createdRef;
  };

  const handlePrimaryAction = async (another = false) => {
    if (!another && matchingPartners.length === 1) { openPartner(matchingPartners[0]!.localAgentRef); return; }
    if (!another && matchingPartners.length > 1) return;
    if (!currentSourceKey) {
      return;
    }
    if (materializationInFlight.current) {
      return;
    }
    const scope = captureAccountActionScope(appStore);
    if (!scope || scope.accountId !== ownerUserId) { scope?.dispose(); return; }
    const position = captureHomeNavigationScope(navigation);
    const isCurrent = () => scope.isCurrent() && position.isCurrent()
      && currentAction.current?.sourceKey === currentSourceKey
      && currentAction.current?.ownerUserId === ownerUserId;
    if (!isCurrent()) { scope.dispose(); position.dispose(); return; }
    materializationInFlight.current = true;
    setSourceMaterialization({ sourceKey: currentSourceKey, ownerUserId });
    try {
      const createdRef = await ensureCharacterSourceReady(isCurrent, another);
      if (!isCurrent()) return;
      setFeedback({
        kind: 'success',
        message: i18n.t('Explore.characterSourceMaterializedFeedback', { defaultValue: 'Partner added.' }),
      });
      void navigation.push({ id: 'explore', exploreSection: 'partners', partner: { localAgentRef: createdRef } });
    } catch (error) {
      if (!isCurrent()) return;
      setFeedback({
        kind: 'error',
        message: characterSourceMaterializationFailureMessage(error, i18n.t),
      });
      if (error instanceof CharacterSourceConfirmationPendingError) {
        // The write already succeeded. The exact detail's Retry only reads;
        // returning to a creation button here could duplicate this partner.
        void queryClient.invalidateQueries({ queryKey: ['source-detail-partners', ownerUserId] });
        void queryClient.invalidateQueries({ queryKey: ['home-partners', ownerUserId] });
        void navigation.push({ id: 'explore', exploreSection: 'partners', partner: { localAgentRef: error.localAgentRef } });
      }
    } finally {
      scope.dispose(); position.dispose();
      materializationInFlight.current = false;
      setSourceMaterialization((pending) => pending?.sourceKey === currentSourceKey && pending.ownerUserId === ownerUserId ? null : pending);
    }
  };

  // @nimi-authority: rule.nimi.runtime.agent-participation.r197
  const handleStartChat = async (initialComposerText?: string, selectedLocalAgentRef?: string) => {
    const scope = captureAccountActionScope(appStore);
    if (!scope || scope.accountId !== ownerUserId) { scope?.dispose(); return; }
    const position = captureHomeNavigationScope(navigation);
    const isCurrent = () => scope.isCurrent() && position.isCurrent()
      && currentAction.current?.sourceKey === currentSourceKey
      && currentAction.current?.ownerUserId === ownerUserId;
    if (!isCurrent()) { scope.dispose(); position.dispose(); return; }
    try {
      const prefillText = String(initialComposerText || '').trim();
      const selected = selectedLocalAgentRef ?? (matchingPartners.length === 1 ? matchingPartners[0]!.localAgentRef : null);
      const conversationTarget = source?.sourceRef && selected
        ? await openPartnerConversation({ sdk: bindings.sdk, accountId: ownerUserId, localAgentRef: selected, expectedSource: source.sourceRef, isCurrent }) : null;
      if (!isCurrent()) return;
      if (conversationTarget) {
        await launchAgentConversationFromDisplay({
          target: conversationTarget,
          initialComposerText: prefillText || null,
          navigation,

          setAgentConversationTargetSnapshot,
          setPendingAgentComposerPrefill,
        });
        return;
      }
      setPendingAgentComposerPrefill({ text: '' });

      setFeedback({
        kind: 'error',
        message: i18n.t('SourceDetail.partnerUnavailable', {
          defaultValue: 'This partner is no longer available. Choose a current partner from the chat list.',
        }),
      });
    } catch (error) {
      if (!isCurrent()) return;
      setFeedback({
        kind: 'error',
        message: characterSourceMaterializationFailureMessage(error, i18n.t),
      });
    } finally {
      scope.dispose(); position.dispose();
    }
  };

  if (!selectedSourceRef) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--nimi-text-muted)]">
        {i18n.t('SourceDetail.noSourceSelected', { defaultValue: 'No source selected' })}
      </div>
    );
  }

  if (!source && !profileQuery.isPending && !profileQuery.isError) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--nimi-text-muted)]">
        {i18n.t('SourceDetail.noSourceDataAvailable', { defaultValue: 'No source data available' })}
      </div>
    );
  }

  return (
    <>
      <SourceDetailView
        source={sourceForView!}
        stats={stats}
        loading={profileQuery.isPending}
        error={profileQuery.isError}
        retrying={profileQuery.isFetching}
        onRetry={() => { void profileQuery.refetch(); }}
        primaryActionJoining={sourceMaterialization?.sourceKey === currentSourceKey
          && sourceMaterialization.ownerUserId === ownerUserId}
        onBack={onBack === null ? undefined : (onBack ?? navigation.back)}
        onOpenWorld={() => {
          if (!source?.worldId) {
            return;
          }
          navigation.push({ id: 'world-detail', worldId: source.worldId });
        }}
        onPrimaryAction={() => {
          void handlePrimaryAction();
        }}
        partners={matchingPartners.map(partner => ({ localAgentRef: partner.localAgentRef, displayName: partner.displayName, capturedAt: partner.createdAt ?? undefined }))}
        onCreateAnother={matchingPartners.length && !localAgentListQuery.isError && source?.viewerRelation.state === 'connectable' ? () => { void handlePrimaryAction(true); } : undefined}
        onSelectPartner={openPartner}
        onStartChat={matchingPartners.length === 1 && matchingPartners[0]!.lifecycle === AgentLifecycleStatus.ACTIVE ? (initialComposerText) => { void handleStartChat(initialComposerText); } : undefined}
      />
    </>
  );
}
