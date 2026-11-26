import { hasElectronInvoke, openShellFileDialog } from '@nimiplatform/kit/shell/renderer/bridge';
import { Button, Popover, PopoverContent, PopoverTrigger, ScrollArea } from '@nimiplatform/kit/ui';
import {
  RouteAndSubmitOutcome,
  type RouteAndSubmitInputResponse,
  type SessionRouteCandidate,
  type WorkSessionRecord,
} from '@nimiplatform/sdk/runtime/generated';
import {
  ArrowUp,
  AtSign,
  Bot,
  ExternalLink,
  FileText,
  FolderOpen,
  Hash,
  Paperclip,
  Plus,
  ShieldAlert,
  Sparkles,
  Split,
  Square,
  UserRound,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useDesktopRendererCommands, useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast.js';
import type { LocalAgentListItem } from '../agents/local-agent-list-model.js';
import {
  addReadOnlyAttachmentPaths,
  bindWritableWorkspaceRoot,
  buildRouteAndSubmitRequest,
  clearWritableWorkspaceRoot,
  EMPTY_OMNI_ATTACHMENTS,
  hasOmniFileContext,
  isAmbiguousRouteOutcome,
  isLightQaRouteResponse,
  isPcWorkRouteResponse,
  parseBrainSessionEvent,
  parseOmniTriggerToken,
  readPinnedPartnerHandle,
  removeReadOnlyAttachmentPath,
  resolveEffectivePartnerMode,
  stripOmniTriggerToken,
  toggleOmniPartnerMode,
  writePinnedPartnerHandle,
  type OmniAttachmentState,
  type OmniDisambiguationState,
  type OmniLightQaCardState,
  type OmniTargetSelection,
  type OmniTriggerMatch,
} from './home-omni-composer-model.js';

export type OmniHumanContactOption = Readonly<{
  contactId: string;
  displayName: string;
  handle?: string | null;
}>;

export type HomeOmniComposerProps = Readonly<{
  accountKey: string | null;
  partners: readonly LocalAgentListItem[];
  humanContacts?: readonly OmniHumanContactOption[];
  recentSessions?: readonly WorkSessionRecord[];
  cloudRouteActive?: boolean;
  cloudRouteStatus?: 'cloud' | 'local' | 'loading' | 'unknown';
  cloudModelLabel?: string | null;
  onOpenHumanChatDraft: (contactId: string, draftText: string) => void;
  onOpenPartnerZhiyu: (localAgentRef: string, draftText?: string) => void;
  onOpenHarness: (workSessionRef?: string) => void;
  onOpenModelSwitch: () => void;
}>;

function isOtherEditableElement(target: EventTarget | null, composerInput: HTMLTextAreaElement | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  if (target === composerInput) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function randomRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r015
// @nimi-authority: rule.nimi.desktop.product-surfaces.home-omni-composer
export function HomeOmniComposer({
  accountKey,
  partners,
  humanContacts = [],
  recentSessions = [],
  cloudRouteActive = false,
  cloudRouteStatus,
  cloudModelLabel = null,
  onOpenHumanChatDraft,
  onOpenPartnerZhiyu,
  onOpenHarness,
  onOpenModelSwitch,
}: HomeOmniComposerProps) {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const commands = useDesktopRendererCommands();

  const [draft, setDraft] = useState('');
  const [caretIndex, setCaretIndex] = useState(0);
  const [target, setTarget] = useState<OmniTargetSelection>({ kind: 'auto' });
  const [attachments, setAttachments] = useState<OmniAttachmentState>(EMPTY_OMNI_ATTACHMENTS);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [disambiguation, setDisambiguation] = useState<OmniDisambiguationState | null>(null);
  useEffect(() => { setDisambiguation(null); }, [attachments]);
  const [lightQa, setLightQa] = useState<OmniLightQaCardState | null>(null);
  const [pinnedPartnerHandle, setPinnedPartnerHandle] = useState<string | null>(() =>
    readPinnedPartnerHandle(accountKey),
  );
  const [sessionSearchItems, setSessionSearchItems] = useState<readonly WorkSessionRecord[]>(recentSessions);
  const [activeOptionIndex, setActiveOptionIndex] = useState(0);

  const isComposingRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const accountGenerationRef = useRef(0);
  const pendingSubmit = useRef<{ key: string; id: string } | null>(null);
  const submittingNow = useRef(false);

  useEffect(() => {
    accountGenerationRef.current += 1;
    pendingSubmit.current = null;
    submittingNow.current = false;
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    setDraft('');
    setCaretIndex(0);
    setTarget({ kind: 'auto' });
    setAttachments(EMPTY_OMNI_ATTACHMENTS);
    setPlusMenuOpen(false);
    setSubmitting(false);
    setSubmitError(null);
    setDisambiguation(null);
    setLightQa(null);
    setActiveOptionIndex(0);
    setPinnedPartnerHandle(readPinnedPartnerHandle(accountKey));
  }, [accountKey]);

  useEffect(() => {
    setSessionSearchItems(recentSessions);
  }, [recentSessions]);

  useEffect(() => () => {
    streamAbortRef.current?.abort();
  }, []);

  const defaultPartner = useMemo(() => {
    if (pinnedPartnerHandle) {
      const matched = partners.find((item) => item.localAgentRef === pinnedPartnerHandle);
      if (matched) return matched;
    }
    return partners[0] ?? null;
  }, [partners, pinnedPartnerHandle]);

  const activeTrigger: OmniTriggerMatch | null = useMemo(
    () => parseOmniTriggerToken(draft, caretIndex),
    [draft, caretIndex],
  );

  // Query Runtime sessions (including archived) when `#` recall popup is active.
  useEffect(() => {
    if (activeTrigger?.kind !== 'session') return;
    let canceled = false;
    const capturedGeneration = accountGenerationRef.current;
    const query = activeTrigger.query.trim();
    void sdk.accountProduct().sessions
      .listSessions({
        agentHandle: '',
        includeArchived: true,
        searchQuery: query,
        sessionKinds: [],
        statusFilter: '',
        pageSize: 8,
        pageToken: '',
      })
      .then((res) => {
        if (!canceled && capturedGeneration === accountGenerationRef.current && Array.isArray(res.items)) {
          setSessionSearchItems(res.items);
        }
      })
      .catch(() => {
        // Keep last known session list if Runtime is temporarily unreachable.
      });
    return () => {
      canceled = true;
    };
  }, [activeTrigger?.kind, activeTrigger?.query, sdk]);

  const triggerOptions = useMemo(() => {
    if (!activeTrigger) return [];
    const q = activeTrigger.query.trim().toLowerCase();
    if (activeTrigger.kind === 'human') {
      return humanContacts
        .filter((item) => !q || item.displayName.toLowerCase().includes(q) || (item.handle ?? '').toLowerCase().includes(q))
        .slice(0, 6)
        .map((item) => ({
          id: `human:${item.contactId}`,
          label: item.displayName,
          sublabel: item.handle ? `@${item.handle}` : t('runtimeConfig.overview.omni.humanTag'),
          onSelect: () => {
            setTarget({
              kind: 'human',
              contactId: item.contactId,
              displayName: item.displayName,
              handle: item.handle,
            });
            setDraft((prev) => stripOmniTriggerToken(prev, activeTrigger));
            setCaretIndex(0);
          },
        }));
    }
    if (activeTrigger.kind === 'partner') {
      return partners
        .filter((item) => !q || item.displayName.toLowerCase().includes(q) || item.localAgentRef.toLowerCase().includes(q))
        .slice(0, 6)
        .map((item) => ({
          id: `partner:${item.localAgentRef}`,
          label: item.displayName,
          sublabel: item.localAgentRef,
          onSelect: () => {
            setTarget({
              kind: 'partner',
              agentHandle: item.localAgentRef,
              displayName: item.displayName,
              mode: resolveEffectivePartnerMode('harness', attachments),
            });
            setDraft((prev) => stripOmniTriggerToken(prev, activeTrigger));
            setCaretIndex(0);
          },
        }));
    }
    return sessionSearchItems
      .filter((item) => !q || (item.title || item.workSessionRef).toLowerCase().includes(q))
      .slice(0, 6)
      .map((item) => ({
        id: `session:${item.workSessionRef}`,
        label: item.title || item.workSessionRef,
        sublabel: item.archivedAt
          ? t('runtimeConfig.overview.omni.archivedSessionTag')
          : item.sessionKind,
        onSelect: () => {
          setTarget({
            kind: 'session',
            workSessionRef: item.workSessionRef,
            sessionKind: item.sessionKind,
            title: item.title || item.workSessionRef,
            archived: Boolean(item.archivedAt),
            agentHandle: item.agentBinding,
          });
          setDraft((prev) => stripOmniTriggerToken(prev, activeTrigger));
          setCaretIndex(0);
        },
      }));
  }, [activeTrigger, attachments, humanContacts, partners, sessionSearchItems, t]);

  useEffect(() => {
    setDisambiguation(null);
  }, [target, pinnedPartnerHandle]);

  useEffect(() => {
    setActiveOptionIndex(0);
  }, [activeTrigger?.kind, activeTrigger?.query]);

  const startBrainEventStream = useCallback((workSessionRef: string, afterSeq: number) => {
    streamAbortRef.current?.abort();
    const controller = new AbortController();
    streamAbortRef.current = controller;

    void (async () => {
      try {
        const stream = await sdk.accountProduct().sessions.subscribeBrainSessionEvents(
          {
            workSessionRef,
            afterSeq: String(afterSeq),
          },
          { signal: controller.signal },
        );
        for await (const envelope of stream) {
          if (controller.signal.aborted) break;
          const parsed = parseBrainSessionEvent(envelope);
          setLightQa((current) => {
            if (!current || current.workSessionRef !== workSessionRef) return current;
            const nextSeq = Math.max(current.lastSeq, parsed.seq);
            if (parsed.kind === 'assistant_delta') {
              const messages = [...current.messages];
              const last = messages.at(-1);
              if (last && last.role === 'assistant' && last.streaming) {
                messages[messages.length - 1] = {
                  ...last,
                  text: `${last.text}${parsed.text}`,
                  seq: nextSeq,
                };
              } else {
                messages.push({
                  id: `assistant-${nextSeq}`,
                  role: 'assistant',
                  text: parsed.text,
                  seq: nextSeq,
                  streaming: true,
                });
              }
              return { ...current, messages, lastSeq: nextSeq, streaming: true, errorMessage: null };
            }
            if (parsed.kind === 'assistant_done') {
              const messages = [...current.messages];
              const last = messages.at(-1);
              if (last && last.role === 'assistant' && last.streaming) {
                messages[messages.length - 1] = {
                  ...last,
                  text: parsed.text || last.text,
                  seq: nextSeq,
                  streaming: false,
                };
              } else if (parsed.text) {
                messages.push({
                  id: `assistant-${nextSeq}`,
                  role: 'assistant',
                  text: parsed.text,
                  seq: nextSeq,
                  streaming: false,
                });
              }
              return { ...current, messages, lastSeq: nextSeq, streaming: false, errorMessage: null };
            }
            if (parsed.kind === 'error') {
              return { ...current, lastSeq: nextSeq, streaming: false, errorMessage: parsed.message };
            }
            return { ...current, lastSeq: nextSeq };
          });
        }
      } catch {
        if (!controller.signal.aborted) {
          setLightQa((current) => (current ? { ...current, streaming: false } : current));
        }
      }
    })();
  }, [sdk]);

  const handleRouteResponse = useCallback(
    (
      response: RouteAndSubmitInputResponse,
      submittedText: string,
      requestId: string,
      agentHandle: string,
      agentDisplayName: string,
    ) => {
      if (isAmbiguousRouteOutcome(response)) {
        // Pure read-only preflight: preserve draft & exact requestId for low-entropy 1/2/3 choice (FT-02).
        setDisambiguation({
          requestId,
          draftText: submittedText,
          candidates: response.candidates ?? [],
        });
        return;
      }

      const queued = response.outcome === RouteAndSubmitOutcome.DEFERRED_BODY_OFFLINE;
      if (!response.resolvedWorkSessionRef || (response.outcome !== RouteAndSubmitOutcome.ACCEPTED && !queued)) {
        setSubmitError(t('runtimeConfig.overview.omni.routeUnconfirmed'));
        return;
      }
      pendingSubmit.current = null;
      setDisambiguation(null);
      setDraft(current => current.trim() === submittedText ? '' : current);
      setCaretIndex(0);
      setAttachments(current => current === attachments ? EMPTY_OMNI_ATTACHMENTS : current);

      if (isLightQaRouteResponse(response)) {
        const resolvedRef = response.resolvedWorkSessionRef;
        setLightQa((prev) => {
          const sameSession = prev && prev.workSessionRef === resolvedRef;
          const prevMessages = sameSession ? prev.messages : [];
          const nextTurnCount = sameSession ? prev.turnCount + 1 : 1;
          return {
            workSessionRef: resolvedRef,
            agentHandle,
            agentDisplayName,
            messages: [
              ...prevMessages,
              {
                id: `user-${requestId}`,
                role: 'user',
                text: submittedText,
                seq: sameSession ? prev.lastSeq : 0,
              },
            ],
            lastSeq: sameSession ? prev.lastSeq : 0,
            streaming: true,
            turnCount: nextTurnCount,
            promotedToSessionRef: null,
            promotedHandoffTurns: 0,
            errorMessage: null,
          };
        });
        const startAfterSeq = lightQa && lightQa.workSessionRef === resolvedRef ? lightQa.lastSeq : 0;
        startBrainEventStream(resolvedRef, startAfterSeq);
        return;
      }

      if (isPcWorkRouteResponse(response)) {
        if (response.promotedHandoffTurns > 0) {
          setLightQa((prev) => (prev ? {
            ...prev,
            streaming: false,
            promotedToSessionRef: response.resolvedWorkSessionRef,
            promotedHandoffTurns: response.promotedHandoffTurns,
          } : prev));
        }
        onOpenHarness(response.resolvedWorkSessionRef);
      } else {
        emitFeedbackToast({
          kind: 'info',
          message: t(queued ? 'runtimeConfig.overview.omni.appTaskQueued' : 'runtimeConfig.overview.omni.appTaskSubmitted'),
        });
      }
    },
    [attachments, lightQa?.lastSeq, lightQa?.workSessionRef, onOpenHarness, startBrainEventStream, t],
  );

  const submitToRuntime = useCallback(
    async (textToSend: string, options?: { requestId?: string; selectedCandidateRef?: string }) => {
      const trimmed = textToSend.trim();
      if (!trimmed) return;

      // @Human guard: NEVER auto-send to human contacts (02 §2.1).
      if (target.kind === 'human') {
        setDraft('');
        setCaretIndex(0);
        onOpenHumanChatDraft(target.contactId, trimmed);
        return;
      }

      // ~Partner in Zhiyu companion mode (only when no files/workspace attached).
      if (target.kind === 'partner' && resolveEffectivePartnerMode(target.mode, attachments) === 'zhiyu') {
        setDraft('');
        setCaretIndex(0);
        onOpenPartnerZhiyu(target.agentHandle, trimmed);
        return;
      }

      const resolvedPartner = target.kind === 'partner'
        ? { handle: target.agentHandle, name: target.displayName }
        : target.kind === 'session' && target.agentHandle
          ? { handle: target.agentHandle, name: partners.find((p) => p.localAgentRef === target.agentHandle)?.displayName ?? target.agentHandle }
          : defaultPartner
            ? { handle: defaultPartner.localAgentRef, name: defaultPartner.displayName }
            : null;

      if (!resolvedPartner) {
        setSubmitError(t('runtimeConfig.overview.omni.noPartnerConfigured'));
        return;
      }

      if (submittingNow.current) return;
      submittingNow.current = true;
      const capturedGeneration = accountGenerationRef.current;
      setSubmitting(true);
      setSubmitError(null);
      try {
        const request = buildRouteAndSubmitRequest({
          requestId: '',
          text: trimmed,
          agentHandle: resolvedPartner.handle,
          target,
          attachments,
          activeLightQa: lightQa,
          selectedCandidateRef: options?.selectedCandidateRef,
        });
        const key = JSON.stringify(request);
        const requestId = options?.requestId ?? (pendingSubmit.current?.key === key ? pendingSubmit.current.id : randomRequestId());
        pendingSubmit.current = { key, id: requestId };
        const response = await sdk.accountProduct().sessions.routeAndSubmitInput({ ...request, requestId });
        if (capturedGeneration !== accountGenerationRef.current) return;
        handleRouteResponse(response, trimmed, requestId, resolvedPartner.handle, resolvedPartner.name);
      } catch (error) {
        if (capturedGeneration !== accountGenerationRef.current) return;
        const message = error instanceof Error && error.message.trim()
          ? error.message
          : t('runtimeConfig.overview.omni.submitFailed');
        setSubmitError(message);
      } finally {
        if (capturedGeneration === accountGenerationRef.current) {
          submittingNow.current = false;
          setSubmitting(false);
        }
      }
    },
    [
      attachments,
      defaultPartner,
      handleRouteResponse,
      lightQa,
      onOpenHumanChatDraft,
      onOpenPartnerZhiyu,
      partners,
      sdk,
      t,
      target,
    ],
  );

  const handleSelectCandidate = useCallback(
    (candidate: SessionRouteCandidate | 'new_light_qa') => {
      if (!disambiguation) return;
      const { requestId, draftText } = disambiguation;
      setDisambiguation(null);
      if (candidate === 'new_light_qa') {
        void submitToRuntime(draftText, { requestId, selectedCandidateRef: '__general_inbox__' });
        return;
      }
      void submitToRuntime(draftText, { requestId, selectedCandidateRef: candidate.workSessionRef });
    },
    [disambiguation, submitToRuntime],
  );

  // Keyboard shortcuts `1`/`2`/`3` when disambiguation strip is open.
  useEffect(() => {
    if (!disambiguation) return;
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isComposingRef.current || event.isComposing || event.keyCode === 229) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isOtherEditableElement(event.target, inputRef.current)) return;
      if (document.activeElement === inputRef.current && draft.trim() !== disambiguation.draftText.trim()) return;
      if (event.key === '1' || event.key === '2' || event.key === '3') {
        const idx = Number(event.key) - 1;
        const candidate = disambiguation.candidates[idx];
        if (candidate) {
          event.preventDefault();
          handleSelectCandidate(candidate);
        }
      } else if (event.key === 'Escape') {
        setDisambiguation(null);
      }
    };
    window.addEventListener('keydown', onWindowKeyDown);
    return () => window.removeEventListener('keydown', onWindowKeyDown);
  }, [disambiguation, draft, handleSelectCandidate]);

  const handleStopLightQa = async () => {
    if (!lightQa) return;
    streamAbortRef.current?.abort();
    setLightQa((current) => (current ? { ...current, streaming: false } : current));
    await sdk.accountProduct().sessions
      .stopBrainSessionTurn({
        workSessionRef: lightQa.workSessionRef,
        expectedTurnRef: '',
      })
      .catch(() => undefined);
  };

  const handleSplitLightQaToTask = async () => {
    if (!lightQa || submittingNow.current) return;
    submittingNow.current = true;
    setSubmitting(true);
    const capturedGeneration = accountGenerationRef.current;
    setSubmitError(null);
    try {
      const payload = {
        agentHandle: lightQa.agentHandle,
        sourceWorkSessionRef: lightQa.workSessionRef,
        sourceEventSeq: String(lightQa.lastSeq),
        targetWorkSessionRef: '',
        targetSessionKind: 'pc_work',
        workspaceRoot: attachments.workspaceRoot ?? '',
        workspaceWritable: attachments.workspaceWritable,
        title: '',
      };
      const key = JSON.stringify(payload);
      const id = pendingSubmit.current?.key === key ? pendingSubmit.current.id : randomRequestId();
      pendingSubmit.current = { key, id };
      const response = await sdk.accountProduct().sessions.splitOrRedirectInput({ ...payload, requestId: id });
      if (capturedGeneration !== accountGenerationRef.current) return;
      pendingSubmit.current = null;
      setAttachments(current => current === attachments ? EMPTY_OMNI_ATTACHMENTS : current);
      setLightQa((current) => (current ? {
        ...current,
        streaming: false,
        promotedToSessionRef: response.targetWorkSessionRef,
      } : current));
      onOpenHarness(response.targetWorkSessionRef);
    } catch (error) {
      if (capturedGeneration !== accountGenerationRef.current) return;
      setSubmitError(error instanceof Error ? error.message : t('runtimeConfig.overview.omni.submitFailed'));
    } finally {
      if (capturedGeneration === accountGenerationRef.current) {
        submittingNow.current = false;
        setSubmitting(false);
      }
    }
  };

  const handleAttachReadOnlyFile = async () => {
    setPlusMenuOpen(false);
    const capturedGeneration = accountGenerationRef.current;
    const dialogResult = await openShellFileDialog({
      kind: 'file',
      title: t('runtimeConfig.overview.omni.menuAttachReadOnly'),
      filters: [{ name: 'All Files', extensions: ['*'] }],
    }).catch(() => null);
    const picked = dialogResult && !dialogResult.canceled ? dialogResult.paths[0]?.trim() : undefined;
    if (!picked || capturedGeneration !== accountGenerationRef.current) return;
    setAttachments((prev) => addReadOnlyAttachmentPaths(prev, [picked]));
    setTarget((prev) => (prev.kind === 'partner' ? { ...prev, mode: 'harness' } : prev));
  };

  const handleAuthorizeWorkspace = async () => {
    setPlusMenuOpen(false);
    const capturedGeneration = accountGenerationRef.current;
    let pickedDir: string | null = null;
    if (hasElectronInvoke()) {
      const dialogResult = await openShellFileDialog({
        kind: 'directory',
        title: t('runtimeConfig.overview.omni.menuAuthorizeWorkspace'),
      }).catch(() => null);
      pickedDir = dialogResult && !dialogResult.canceled ? (dialogResult.paths[0]?.trim() || null) : null;
    } else {
      pickedDir = await commands.pickLocalRuntimeAssetDirectory().catch(() => null);
    }
    if (!pickedDir || capturedGeneration !== accountGenerationRef.current) return;
    setAttachments((prev) => bindWritableWorkspaceRoot(prev, pickedDir!));
    setTarget((prev) => (prev.kind === 'partner' ? { ...prev, mode: 'harness' } : prev));
  };

  const [isDragOver, setIsDragOver] = useState(false);
  const dragDepthRef = useRef(0);
  const focusInputOnMenuCloseRef = useRef(false);

  const handleDropFiles = (event: DragEvent<HTMLFormElement>) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragOver(false);
    const resolveElectronFilePath = (
      globalThis as { __NIMI_DESKTOP_FILE_PATH__?: (file: File) => string }
    ).__NIMI_DESKTOP_FILE_PATH__;
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;
    const droppedPaths: string[] = [];
    for (const file of files) {
      const electronPath = typeof resolveElectronFilePath === 'function' ? resolveElectronFilePath(file) : '';
      const rawPath = (electronPath || (file as File & { path?: string }).path || '').trim();
      // Never fall back to bare file.name — require a real OS filesystem path.
      if (rawPath && (rawPath.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(rawPath) || rawPath.startsWith('\\\\'))) {
        droppedPaths.push(rawPath);
      }
    }
    if (droppedPaths.length === 0) {
      setSubmitError(t('runtimeConfig.overview.omni.dropPathUnavailable', {
        defaultValue: 'Could not read local file path from drag-and-drop. Use the + button to attach files.',
      }));
      return;
    }
    setSubmitError(null);
    // Strict v2.1 rule: drag-and-drop ALWAYS defaults to read-only attachments, NEVER silently grants workspace write!
    setAttachments((prev) => addReadOnlyAttachmentPaths(prev, droppedPaths));
    setTarget((prev) => (prev.kind === 'partner' ? { ...prev, mode: 'harness' } : prev));
  };

  const requiresSessionDraft = target.kind === 'session' && target.sessionKind !== 'pc_work';
  const dispatchEmptySubmitByTarget = () => {
    if (requiresSessionDraft) return;
    if (target.kind === 'human') {
      onOpenHumanChatDraft(target.contactId, '');
      return;
    }
    if (target.kind === 'partner' && resolveEffectivePartnerMode(target.mode, attachments) === 'zhiyu') {
      onOpenPartnerZhiyu(target.agentHandle, '');
      return;
    }
    if (target.kind === 'session') {
      onOpenHarness(target.workSessionRef);
      return;
    }
    onOpenHarness();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Chinese IME composition guard: never intercept keys during IME composition.
    if (isComposingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) {
      return;
    }

    if (activeTrigger && triggerOptions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveOptionIndex((idx) => (idx + 1) % triggerOptions.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveOptionIndex((idx) => (idx - 1 + triggerOptions.length) % triggerOptions.length);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        triggerOptions[activeOptionIndex]?.onSelect();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setCaretIndex(0);
        return;
      }
    }

    if (event.key === 'Escape' && disambiguation) {
      event.preventDefault();
      setDisambiguation(null);
      return;
    }

    if (event.key === 'Tab' && target.kind === 'partner') {
      event.preventDefault();
      setDisambiguation(null);
      setTarget((prev) => toggleOmniPartnerMode(prev, attachments));
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (disambiguation) {
        handleSelectCandidate('new_light_qa');
        return;
      }
      if (!draft.trim()) {
        dispatchEmptySubmitByTarget();
        return;
      }
      void submitToRuntime(draft);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.trim()) {
      dispatchEmptySubmitByTarget();
      return;
    }
    void submitToRuntime(draft);
  };

  const hasDraft = draft.trim().length > 0;
  const isHumanTarget = target.kind === 'human';
  const effectivePartnerMode = target.kind === 'partner'
    ? resolveEffectivePartnerMode(target.mode, attachments)
    : null;
  const effectiveCloudRouteStatus = cloudRouteStatus ?? (cloudRouteActive ? 'cloud' : 'local');
  const showCloudDataNotice = hasOmniFileContext(attachments)
    && (
      effectiveCloudRouteStatus === 'cloud'
      || effectiveCloudRouteStatus === 'unknown'
      || effectiveCloudRouteStatus === 'loading'
    );

  const submitLabel = isHumanTarget
    ? t('runtimeConfig.overview.omni.openHumanChatWithDraft')
    : hasDraft || requiresSessionDraft
      ? t('runtimeConfig.overview.quickStart.submitDraft')
      : t('runtimeConfig.overview.omni.openHarnessAction');

  return (
    <div className="relative z-30 flex min-w-0 flex-col gap-3" data-testid="home-omni-composer">
      <form
        onSubmit={handleSubmit}
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            dragDepthRef.current += 1;
            setIsDragOver(true);
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (event.dataTransfer.types.includes('Files') && !isDragOver) {
            setIsDragOver(true);
          }
        }}
        onDragLeave={() => {
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) {
            setIsDragOver(false);
          }
        }}
        onDrop={handleDropFiles}
        data-testid="home-quick-start-bar"
        data-drag-over={isDragOver ? 'true' : undefined}
        className={`relative flex min-w-0 flex-col gap-2 rounded-3xl px-4 py-3 shadow-[var(--nimi-home-porcelain-pill-shadow)] transition-[background-color,border-color,box-shadow] duration-150 focus-within:shadow-[var(--nimi-home-porcelain-shadow-hover)] focus-within:ring-2 focus-within:ring-[var(--nimi-focus-ring-color)]/30 ${
          isDragOver
            ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_6%,var(--nimi-home-porcelain-card))] ring-2 ring-[var(--nimi-action-primary-bg)]'
            : 'bg-[var(--nimi-home-porcelain-card)]'
        }`}
      >
        {/* Top Target & Attachment Pills Row */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {target.kind === 'auto' ? (
            <span
              data-testid="home-omni-target-pill:auto"
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--nimi-home-soft-well)] px-2.5 py-1 text-[var(--nimi-text-secondary)]"
            >
              <Sparkles size={12} aria-hidden="true" className="text-[var(--nimi-action-primary-bg)]" />
              <span>
                {defaultPartner
                  ? t('runtimeConfig.overview.omni.autoRouteWithPartner', { name: defaultPartner.displayName })
                  : t('runtimeConfig.overview.omni.autoRouteLabel')}
              </span>
              {partners.length > 1 && defaultPartner ? (
                <button
                  type="button"
                  onClick={() => {
                    const idx = partners.findIndex((p) => p.localAgentRef === defaultPartner.localAgentRef);
                    const next = partners[(idx + 1) % partners.length];
                    if (next) {
                      setPinnedPartnerHandle(next.localAgentRef);
                      writePinnedPartnerHandle(accountKey, next.localAgentRef);
                    }
                  }}
                  className="ml-1 rounded-full px-1 text-[11px] font-medium text-[var(--nimi-action-primary-bg)] hover:underline"
                >
                  {t('runtimeConfig.overview.omni.switchPartner')}
                </button>
              ) : null}
            </span>
          ) : null}

          {target.kind === 'human' ? (
            <span
              data-testid="home-omni-target-pill:human"
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--nimi-status-info-soft-bg)] px-2.5 py-1 font-medium text-[var(--nimi-action-primary-bg)]"
            >
              <UserRound size={12} aria-hidden="true" />
              <span>{t('runtimeConfig.overview.omni.humanTargetPill', { name: target.displayName })}</span>
              <button
                type="button"
                aria-label={t('runtimeConfig.overview.omni.clearTarget')}
                onClick={() => setTarget({ kind: 'auto' })}
                className="rounded-full p-0.5 transition-[transform,background-color] duration-150 hover:bg-[var(--nimi-action-ghost-hover)] active:scale-[0.95] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)]"
              >
                <X size={11} aria-hidden="true" />
              </button>
            </span>
          ) : null}

          {target.kind === 'partner' ? (
            <span
              data-testid="home-omni-target-pill:partner"
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--nimi-home-soft-well)] px-2.5 py-1 font-medium text-[var(--nimi-text-primary)]"
            >
              <Bot size={12} aria-hidden="true" className="text-[var(--nimi-action-primary-bg)]" />
              <span>{target.displayName}</span>
              <button
                type="button"
                data-testid="home-omni-partner-mode-toggle"
                disabled={hasOmniFileContext(attachments)}
                onClick={() => setTarget((prev) => toggleOmniPartnerMode(prev, attachments))}
                className="rounded-full bg-[var(--nimi-surface-card)] px-2 py-0.5 text-[11px] text-[var(--nimi-action-primary-bg)] shadow-xs transition-[transform,background-color] duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)] disabled:opacity-60"
                title={t('runtimeConfig.overview.omni.partnerModeHint')}
              >
                {effectivePartnerMode === 'harness'
                  ? t('runtimeConfig.overview.omni.modeHarness')
                  : t('runtimeConfig.overview.omni.modeZhiyu')}
              </button>
              <button
                type="button"
                aria-label={t('runtimeConfig.overview.omni.clearTarget')}
                onClick={() => setTarget({ kind: 'auto' })}
                className="rounded-full p-0.5 transition-[transform,background-color] duration-150 hover:bg-[var(--nimi-action-ghost-hover)] active:scale-[0.95] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)]"
              >
                <X size={11} aria-hidden="true" />
              </button>
            </span>
          ) : null}

          {target.kind === 'session' ? (
            <span
              data-testid="home-omni-target-pill:session"
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--nimi-home-soft-well)] px-2.5 py-1 font-medium text-[var(--nimi-text-primary)]"
            >
              <Hash size={12} aria-hidden="true" className="text-[var(--nimi-action-primary-bg)]" />
              <span className="max-w-[200px] truncate">{target.title}</span>
              <button
                type="button"
                aria-label={t('runtimeConfig.overview.omni.clearTarget')}
                onClick={() => setTarget({ kind: 'auto' })}
                className="rounded-full p-0.5 transition-[transform,background-color] duration-150 hover:bg-[var(--nimi-action-ghost-hover)] active:scale-[0.95] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)]"
              >
                <X size={11} aria-hidden="true" />
              </button>
            </span>
          ) : null}

          {attachments.attachmentPaths.map((filePath) => (
            <span
              key={filePath}
              data-testid="home-omni-readonly-attachment"
              className="inline-flex items-center gap-1 rounded-full bg-[var(--nimi-home-soft-well)] px-2 py-0.5 text-[11px] text-[var(--nimi-text-secondary)]"
            >
              <FileText size={11} aria-hidden="true" />
              <span className="max-w-[160px] truncate">{filePath.split(/[\\/]/u).at(-1) || filePath}</span>
              <span className="text-[10px] opacity-75">({t('runtimeConfig.overview.omni.readOnlyTag')})</span>
              <button
                type="button"
                aria-label={t('runtimeConfig.overview.omni.removeAttachment')}
                onClick={() => setAttachments((prev) => removeReadOnlyAttachmentPath(prev, filePath))}
                className="rounded-full p-0.5 transition-[transform,background-color] duration-150 hover:bg-[var(--nimi-action-ghost-hover)] active:scale-[0.95] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)]"
              >
                <X size={10} aria-hidden="true" />
              </button>
            </span>
          ))}

          {attachments.workspaceRoot ? (
            <span
              data-testid="home-omni-writable-workspace"
              className="inline-flex items-center gap-1 rounded-full bg-[var(--nimi-status-warning-soft-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--nimi-status-warning-soft-text)]"
            >
              <FolderOpen size={11} aria-hidden="true" />
              <span className="max-w-[180px] truncate">{attachments.workspaceRoot}</span>
              <span>({t('runtimeConfig.overview.omni.writableWorkspaceTag')})</span>
              <button
                type="button"
                aria-label={t('runtimeConfig.overview.omni.removeWorkspace')}
                onClick={() => setAttachments((prev) => clearWritableWorkspaceRoot(prev))}
                className="rounded-full p-0.5 transition-[transform,background-color] duration-150 hover:bg-[var(--nimi-action-ghost-hover)] active:scale-[0.95] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)]"
              >
                <X size={10} aria-hidden="true" />
              </button>
            </span>
          ) : null}
        </div>

        {/* Main Input Row */}
        <div className="flex min-w-0 items-end gap-2">
          <Popover open={plusMenuOpen} onOpenChange={setPlusMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={t('runtimeConfig.overview.omni.openPlusMenu')}
                aria-haspopup="menu"
                aria-expanded={plusMenuOpen}
                data-testid="home-omni-plus-button"
                className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-[var(--nimi-home-soft-well)] text-[var(--nimi-text-secondary)] transition-[transform,background-color,color] duration-150 hover:bg-[var(--nimi-home-soft-well-hover)] hover:text-[var(--nimi-text-primary)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)]"
              >
                <Plus size={16} aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              side="bottom"
              sideOffset={8}
              onCloseAutoFocus={(event) => {
                if (focusInputOnMenuCloseRef.current) {
                  event.preventDefault();
                  focusInputOnMenuCloseRef.current = false;
                  inputRef.current?.focus();
                }
              }}
              className="w-72 rounded-2xl border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-overlay)] p-1.5 text-xs shadow-[var(--nimi-elevation-floating)]"
            >
              <div
                role="menu"
                aria-label={t('runtimeConfig.overview.omni.openPlusMenu')}
                data-testid="home-omni-plus-menu"
                onKeyDown={(event) => {
                  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                  const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
                  if (items.length === 0) return;
                  event.preventDefault();
                  const current = items.indexOf(document.activeElement as HTMLButtonElement);
                  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
                    : event.key === 'ArrowDown' ? (current + 1) % items.length : (current - 1 + items.length) % items.length;
                  items[next]?.focus();
                }}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    focusInputOnMenuCloseRef.current = true;
                    setPlusMenuOpen(false);
                    const next = `${draft}${draft && !draft.endsWith(' ') ? ' ' : ''}@`;
                    setDraft(next);
                    setCaretIndex(next.length);
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[var(--nimi-text-primary)] transition-[transform,background-color] duration-150 hover:bg-[var(--nimi-home-soft-well)] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)]"
                >
                  <AtSign size={14} aria-hidden="true" className="text-[var(--nimi-action-primary-bg)]" />
                  <span>{t('runtimeConfig.overview.omni.menuHuman')}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    focusInputOnMenuCloseRef.current = true;
                    setPlusMenuOpen(false);
                    const next = `${draft}${draft && !draft.endsWith(' ') ? ' ' : ''}~`;
                    setDraft(next);
                    setCaretIndex(next.length);
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[var(--nimi-text-primary)] transition-[transform,background-color] duration-150 hover:bg-[var(--nimi-home-soft-well)] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)]"
                >
                  <Bot size={14} aria-hidden="true" className="text-[var(--nimi-action-primary-bg)]" />
                  <span>{t('runtimeConfig.overview.omni.menuPartner')}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    focusInputOnMenuCloseRef.current = true;
                    setPlusMenuOpen(false);
                    const next = `${draft}${draft && !draft.endsWith(' ') ? ' ' : ''}#`;
                    setDraft(next);
                    setCaretIndex(next.length);
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[var(--nimi-text-primary)] transition-[transform,background-color] duration-150 hover:bg-[var(--nimi-home-soft-well)] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)]"
                >
                  <Hash size={14} aria-hidden="true" className="text-[var(--nimi-action-primary-bg)]" />
                  <span>{t('runtimeConfig.overview.omni.menuSession')}</span>
                </button>
                <div role="separator" className="my-1 border-t border-[var(--nimi-border-subtle)]" />
                <button
                  type="button"
                  role="menuitem"
                  data-testid="home-omni-menu-attach-readonly"
                  onClick={() => void handleAttachReadOnlyFile()}
                  className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[var(--nimi-text-primary)] transition-[transform,background-color] duration-150 hover:bg-[var(--nimi-home-soft-well)] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)]"
                >
                  <Paperclip size={14} aria-hidden="true" />
                  <span>{t('runtimeConfig.overview.omni.menuAttachReadOnly')}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="home-omni-menu-authorize-workspace"
                  onClick={() => void handleAuthorizeWorkspace()}
                  className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[var(--nimi-text-primary)] transition-[transform,background-color] duration-150 hover:bg-[var(--nimi-home-soft-well)] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)]"
                >
                  <FolderOpen size={14} aria-hidden="true" />
                  <span>{t('runtimeConfig.overview.omni.menuAuthorizeWorkspace')}</span>
                </button>
              </div>
            </PopoverContent>
          </Popover>

          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            disabled={submitting}
            onCompositionStart={() => { isComposingRef.current = true; }}
            onCompositionEnd={(event) => {
              isComposingRef.current = false;
              setCaretIndex(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
            }}
            onChange={(event) => {
              setDraft(event.target.value);
              setCaretIndex(event.target.selectionStart ?? event.target.value.length);
              if (disambiguation) setDisambiguation(null);
              if (submitError) setSubmitError(null);
            }}
            onSelect={(event) => {
              setCaretIndex(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('runtimeConfig.overview.quickStart.placeholder')}
            aria-label={t('runtimeConfig.overview.quickStart.label')}
            data-testid="home-quick-start-input"
            className="max-h-28 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[0.9375rem] leading-6 text-[var(--nimi-text-primary)] placeholder:text-[var(--nimi-text-muted)] focus:outline-none"
          />

          <button
            type="submit"
            disabled={submitting || (requiresSessionDraft && !hasDraft)}
            aria-label={submitLabel}
            title={submitLabel}
            data-testid="home-quick-start-submit"
            className={`inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full transition-[transform,opacity,background-color,border-color,color] duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)] ${
              isHumanTarget
                ? 'bg-[var(--nimi-status-info-soft-bg)] px-3.5 text-xs font-semibold text-[var(--nimi-action-primary-bg)] hover:opacity-90'
                : hasDraft
                  ? 'w-9 bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)] shadow-[var(--nimi-elevation-base)] hover:opacity-90'
                  : 'w-9 bg-[var(--nimi-home-soft-well)] text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-home-soft-well-hover)] hover:text-[var(--nimi-text-primary)]'
            }`}
          >
            {isHumanTarget ? <span>{submitLabel}</span> : <ArrowUp size={16} aria-hidden="true" />}
          </button>
        </div>

        {/* Cloud Data Destination Transparency Notice (02 §2.2) */}
        {showCloudDataNotice ? (
          <div
            data-testid="home-omni-cloud-notice"
            className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-[var(--nimi-status-warning-soft-bg)] px-3 py-1.5 text-[11px] text-[var(--nimi-status-warning-soft-text)]"
          >
            <span className="inline-flex items-center gap-1.5">
              <ShieldAlert size={12} aria-hidden="true" />
              <span>
                {effectiveCloudRouteStatus === 'loading'
                  ? t('runtimeConfig.overview.omni.cloudDataDestinationLoading', {
                    defaultValue: 'Checking whether your active model runs locally or in the cloud before sharing local files…',
                  })
                  : effectiveCloudRouteStatus === 'unknown'
                    ? t('runtimeConfig.overview.omni.cloudDataDestinationUnknown', {
                      defaultValue: 'Current model route could not be verified; review your active model before sharing local files.',
                    })
                    : t('runtimeConfig.overview.omni.cloudDataDestinationNotice', {
                      model: cloudModelLabel || t('runtimeConfig.systemEntry.cloud'),
                    })}
              </span>
            </span>
            <button
              type="button"
              onClick={onOpenModelSwitch}
              className="font-semibold underline hover:opacity-80"
            >
              {t('runtimeConfig.overview.omni.switchLocalModel')}
            </button>
          </div>
        ) : null}

        {submitError ? (
          <p role="alert" data-testid="home-omni-error" className="text-xs text-[var(--nimi-status-danger-soft-text)]">
            {submitError}
          </p>
        ) : null}

        {/* Symbol Trigger Autocomplete Popover (@ / ~ / #) */}
        {activeTrigger && triggerOptions.length > 0 ? (
          <div
            role="listbox"
            data-testid={`home-omni-trigger-popover:${activeTrigger.kind}`}
            className="absolute top-full right-0 left-0 z-50 mt-2 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-1.5 shadow-xl"
          >
            {triggerOptions.map((opt, idx) => (
              <button
                key={opt.id}
                type="button"
                role="option"
                aria-selected={idx === activeOptionIndex}
                onPointerDown={(event) => {
                  event.preventDefault();
                  opt.onSelect();
                }}
                onMouseDown={(event) => {
                  if (event.defaultPrevented) {
                    return;
                  }
                  event.preventDefault();
                  opt.onSelect();
                }}
                className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs ${
                  idx === activeOptionIndex
                    ? 'bg-[var(--nimi-home-soft-well)] font-medium text-[var(--nimi-text-primary)]'
                    : 'text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-home-soft-well)]'
                }`}
              >
                <span className="truncate">{opt.label}</span>
                <span className="shrink-0 text-[11px] opacity-70">{opt.sublabel}</span>
              </button>
            ))}
          </div>
        ) : null}
      </form>

      {/* Low-entropy 1/2/3 Disambiguation Strip (FT-02 / FT-23) */}
      {disambiguation ? (
        <section
          data-testid="home-omni-disambiguation-strip"
          aria-label={t('runtimeConfig.overview.omni.disambiguationLabel')}
          className="flex flex-col gap-2 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-home-porcelain-card)] p-3 text-xs shadow-[var(--nimi-home-porcelain-shadow)]"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-[var(--nimi-text-primary)]">
              {t('runtimeConfig.overview.omni.disambiguationPrompt')}
            </span>
            <button
              type="button"
              aria-label={t('Common.close', { defaultValue: 'Dismiss' })}
              onClick={() => setDisambiguation(null)}
              className="-m-1 inline-flex size-6 items-center justify-center rounded-md text-[var(--nimi-text-muted)] transition-[transform,color,background-color] duration-150 hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)]"
            >
              <X size={13} aria-hidden="true" />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {disambiguation.candidates.slice(0, 3).map((candidate, index) => (
              <Button
                key={candidate.workSessionRef}
                tone="secondary"
                size="sm"
                data-testid={`home-omni-candidate:${index + 1}`}
                onClick={() => handleSelectCandidate(candidate)}
              >
                <kbd className="mr-1.5 font-mono text-[10px] opacity-75">{index + 1}</kbd>
                <span>{candidate.title || candidate.workSessionRef}</span>
              </Button>
            ))}
            <Button
              tone="ghost"
              size="sm"
              data-testid="home-omni-candidate:light-qa"
              onClick={() => handleSelectCandidate('new_light_qa')}
            >
              {t('runtimeConfig.overview.omni.disambiguationLightQa')}
            </Button>
          </div>
        </section>
      ) : null}

      {/* Inline Streaming Light Q&A Card (02 §2, non-focus-stealing) */}
      {lightQa ? (
        <section
          data-testid="home-omni-light-qa-card"
          aria-label={t('runtimeConfig.overview.omni.lightQaCardLabel')}
          className="flex min-w-0 flex-col gap-2.5 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-home-porcelain-card)] p-4 text-sm shadow-[var(--nimi-home-porcelain-shadow)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--nimi-border-subtle)] pb-2 text-xs">
            <span className="font-medium text-[var(--nimi-text-primary)]">
              {t('runtimeConfig.overview.omni.lightQaHeader', { name: lightQa.agentDisplayName })}
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {lightQa.streaming ? (
                <Button
                  tone="ghost"
                  size="sm"
                  data-testid="home-omni-light-qa-stop"
                  onClick={() => void handleStopLightQa()}
                >
                  <Square size={12} aria-hidden="true" className="mr-1" />
                  {t('runtimeConfig.overview.omni.stopStreaming')}
                </Button>
              ) : null}
              <Button
                tone="ghost"
                size="sm"
                data-testid="home-omni-light-qa-split"
                onClick={() => void handleSplitLightQaToTask()}
              >
                <Split size={12} aria-hidden="true" className="mr-1" />
                {t('runtimeConfig.overview.omni.splitToTask')}
              </Button>
              {lightQa.promotedToSessionRef && (<Button
                tone="ghost"
                size="sm"
                data-testid="home-omni-light-qa-open-harness"
                onClick={() => { if (lightQa.promotedToSessionRef) onOpenHarness(lightQa.promotedToSessionRef); }}
              >
                <ExternalLink size={12} aria-hidden="true" className="mr-1" />
                {t('runtimeConfig.overview.omni.openInHarness')}
              </Button>)}
              <button
                type="button"
                aria-label={t('runtimeConfig.overview.omni.dismissLightQa')}
                onClick={() => {
                  streamAbortRef.current?.abort();
                  setLightQa(null);
                }}
                className="rounded-lg p-1 text-[var(--nimi-text-muted)] hover:text-[var(--nimi-text-primary)]"
              >
                <X size={13} aria-hidden="true" />
              </button>
            </div>
          </div>

          <ScrollArea className="max-h-56 min-w-0" contentClassName="flex flex-col gap-2 pr-1">
            {lightQa.messages.map((msg) => (
              <div
                key={msg.id}
                data-testid={`home-omni-light-qa-msg:${msg.role}`}
                className={
                  msg.role === 'user'
                    ? 'self-end rounded-2xl bg-[var(--nimi-home-soft-well)] px-3 py-1.5 text-xs text-[var(--nimi-text-primary)]'
                    : 'whitespace-pre-wrap text-sm leading-relaxed text-[var(--nimi-text-primary)]'
                }
              >
                {msg.text || (msg.streaming ? '…' : '')}
              </div>
            ))}
          </ScrollArea>

          {lightQa.promotedToSessionRef ? (
            <div
              data-testid="home-omni-promotion-banner"
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--nimi-status-info-soft-bg)] px-3 py-2 text-xs text-[var(--nimi-action-primary-bg)]"
            >
              <span>
                {t('runtimeConfig.overview.omni.promotedNotice', {
                  turns: lightQa.promotedHandoffTurns || Math.min(lightQa.turnCount, 6),
                })}
              </span>
              <Button
                tone="ghost"
                size="sm"
                onClick={() => onOpenHarness(lightQa.promotedToSessionRef!)}
              >
                {t('runtimeConfig.overview.omni.openInHarness')} →
              </Button>
            </div>
          ) : null}

          {lightQa.errorMessage ? (
            <p role="alert" className="text-xs text-[var(--nimi-status-danger-soft-text)]">
              {lightQa.errorMessage}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
