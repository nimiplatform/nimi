import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { i18n } from '@renderer/i18n';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { SendGiftModal } from '@renderer/features/economy/send-gift-modal';
import { prefetchWorldDetailAndHistory } from '@renderer/features/world/world-detail-queries.js';
import { prefetchWorldDetailPanel } from '@renderer/features/world/world-detail-route-state';
import {
  connectRealmPersonaSource,
  realmPersonaSourceAdmissionQueryKey,
  realmPersonaSourceConnectionMessage,
} from '@renderer/features/explore/realm-persona-source-admission';
import {
  sourceDisplayDetailQueryKey,
  fetchSourceDisplayDetail,
} from './source-detail-queries.js';
import { SourceDetailView } from './source-detail-view.js';
import { InlineFeedback, type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';

export function SourceDetailPanel() {
  const authStatus = useAppStore((state) => state.auth.status);
  const selectedProfileId = useAppStore((state) => state.selectedProfileId);
  const selectedSourceRef = useAppStore((state) => state.selectedSourceRef);
  const navigateBack = useAppStore((state) => state.navigateBack);
  const navigateToWorld = useAppStore((state) => state.navigateToWorld);
  const queryClient = useQueryClient();
  const [giftModalOpen, setGiftModalOpen] = useState(false);
  const [feedback, setFeedback] = useState<InlineFeedbackState | null>(null);

  const sourceIdentifier = String(selectedProfileId || '').trim();
  const sourceSelection = selectedSourceRef ?? sourceIdentifier;

  const profileQuery = useQuery({
    queryKey: sourceDisplayDetailQueryKey(sourceSelection),
    queryFn: async () => fetchSourceDisplayDetail(selectedSourceRef ?? sourceIdentifier),
    enabled: authStatus === 'authenticated' && Boolean(selectedSourceRef || sourceIdentifier),
  });
  const source = useMemo(() => {
    if (!profileQuery.data) return null;
    return profileQuery.data.source;
  }, [profileQuery.data]);

  const stats = useMemo(() => {
    if (!profileQuery.data) return null;
    return profileQuery.data.stats;
  }, [profileQuery.data]);

  const worldScore = useMemo(() => {
    if (!profileQuery.data) return 0;
    return profileQuery.data.worldScore;
  }, [profileQuery.data]);

  const handlePrimaryAction = async () => {
    if (!source || source.sourceState === 'source_connected') return;
    try {
      await connectRealmPersonaSource(source);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: realmPersonaSourceAdmissionQueryKey }),
        queryClient.invalidateQueries({ queryKey: sourceDisplayDetailQueryKey(sourceSelection) }),
      ]);
      setFeedback({
        kind: 'success',
        message: i18n.t('Explore.realmPersonaSourceConnectedFeedback', {
          defaultValue: 'Source connected.',
        }),
      });
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : realmPersonaSourceConnectionMessage(),
      });
    }
  };

  if (!selectedSourceRef && !sourceIdentifier) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
        {i18n.t('SourceDetail.noSourceSelected', { defaultValue: 'No source selected' })}
      </div>
    );
  }

  if (!source && !profileQuery.isPending && !profileQuery.isError) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
        {i18n.t('SourceDetail.noSourceDataAvailable', { defaultValue: 'No source data available' })}
      </div>
    );
  }

  return (
    <>
      {feedback ? (
        <div className="px-6 pt-4">
          <InlineFeedback feedback={feedback} onDismiss={() => setFeedback(null)} />
        </div>
      ) : null}
      <SourceDetailView
        source={source!}
        stats={stats}
        worldScore={worldScore}
        loading={profileQuery.isPending}
        error={profileQuery.isError}
        onBack={navigateBack}
        onOpenWorld={() => {
          if (!source?.worldId) {
            return;
          }
          prefetchWorldDetailPanel();
          prefetchWorldDetailAndHistory(source.worldId);
          navigateToWorld(source.worldId);
        }}
        onPrimaryAction={() => {
          void handlePrimaryAction();
        }}
        onSendGift={() => setGiftModalOpen(true)}
      />
      <SendGiftModal
        open={giftModalOpen}
        receiverId={source?.id || ''}
        receiverName={source?.displayName || ''}
        receiverHandle={source?.handle}
        receiverIsSource
        receiverAvatarUrl={source?.avatarUrl}
        onClose={() => setGiftModalOpen(false)}
        onSent={() => {
          setFeedback(null);
        }}
      />
    </>
  );
}
