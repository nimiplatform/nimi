/**
 * dialogue-session-page.tsx — SJ-DIAL-001 ~ 019
 * Full dialogue session UI with streaming text generation.
 * Route: /session/:sessionId
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ulid } from 'ulid';
import {
  sqliteGetSession,
  sqliteGetDialogueTurns,
  type Session,
  type DialogueTurn,
} from '@renderer/bridge/sqlite-bridge.js';
import {
  runDialoguePipelineStreaming,
  type DialoguePipelineOutput,
} from '@renderer/engine/dialogue-pipeline.js';
import type { Choice, SceneType } from '@renderer/engine/types.js';
import { useAppStore } from '@renderer/app-shell/app-store.js';

// ── Display types ─────────────────────────────────────────────────────────

type DisplayTurn = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sceneType: SceneType;
  choices: Choice[];
  isStreaming: boolean;
  interrupted: boolean;
};

type PageStatus =
  | 'loading'
  | 'ready'
  | 'generating'
  | 'interrupted'
  | 'error'
  | 'not-found';

// ── Main component ────────────────────────────────────────────────────────

export default function DialogueSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [session, setSession] = useState<Session | null>(null);
  const [turns, setTurns] = useState<DisplayTurn[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [status, setStatus] = useState<PageStatus>('loading');
  const [streamingText, setStreamingText] = useState('');
  const [currentChoices, setCurrentChoices] = useState<Choice[]>([]);
  const [temporalLabel, setTemporalLabel] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [pendingRetry, setPendingRetry] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamingTurnIdRef = useRef<string | null>(null);

  const activeProfile = useAppStore((s) => s.activeProfile);
  const sessionTimerMinutes = useAppStore((s) => s.sessionTimerMinutes);

  // ── Load session + history on mount ──────────────────────────────────────

  useEffect(() => {
    if (!sessionId) {
      setStatus('not-found');
      return;
    }

    async function loadSession() {
      try {
        const loadedSession = await sqliteGetSession(sessionId!);
        if (!loadedSession) {
          setStatus('not-found');
          return;
        }
        setSession(loadedSession);

        const dbTurns = await sqliteGetDialogueTurns(sessionId!);
        const displayTurns: DisplayTurn[] = dbTurns
          .filter((t) => t.role === 'user' || t.role === 'assistant')
          .map((t): DisplayTurn => ({
            id: t.id,
            role: t.role as 'user' | 'assistant',
            content: t.content,
            sceneType: t.sceneType as SceneType,
            choices: [],
            isStreaming: false,
            interrupted: false,
          }));
        setTurns(displayTurns);

        if (loadedSession.sessionStatus === 'completed') {
          setStatus('ready'); // readonly review mode
        } else {
          setStatus('ready');
          // Auto-generate first greeting if session is fresh
          if (dbTurns.length === 0) {
            await runTurn('', loadedSession);
          }
        }
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : t('session.loadError'));
        setStatus('error');
      }
    }

    void loadSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ── Auto-scroll on new content ────────────────────────────────────────────

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [turns, streamingText]);

  // ── Core turn runner ──────────────────────────────────────────────────────

  const runTurn = useCallback(
    async (userInput: string, sessionOverride?: Session) => {
      const activeSession = sessionOverride ?? session;
      if (!activeSession || !sessionId) return;

      // Cancel any in-flight generation
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setStatus('generating');
      setStreamingText('');
      setCurrentChoices([]);

      // Add user turn to display immediately (if non-empty)
      if (userInput.trim()) {
        const userTurnId = ulid();
        setTurns((prev) => [
          ...prev,
          {
            id: userTurnId,
            role: 'user',
            content: userInput,
            sceneType: 'crisis',
            choices: [],
            isStreaming: false,
            interrupted: false,
          },
        ]);
      }

      // Add streaming assistant turn placeholder
      const assistantTurnId = ulid();
      streamingTurnIdRef.current = assistantTurnId;
      setTurns((prev) => [
        ...prev,
        {
          id: assistantTurnId,
          role: 'assistant',
          content: '',
          sceneType: 'crisis',
          choices: [],
          isStreaming: true,
          interrupted: false,
        },
      ]);

      try {
        const result: DialoguePipelineOutput = await runDialoguePipelineStreaming({
          sessionId,
          userInput,
          onChunk: (chunk) => {
            setStreamingText((prev) => prev + chunk);
          },
          signal: controller.signal,
        });

        // Replace streaming placeholder with final result
        setTurns((prev) =>
          prev.map((t) =>
            t.id === assistantTurnId
              ? {
                  ...t,
                  id: result.assistantTurnId,
                  content: result.assistantText,
                  sceneType: result.sceneType,
                  choices: result.choices,
                  isStreaming: false,
                  interrupted: result.interrupted,
                }
              : t,
          ),
        );

        setStreamingText('');
        setCurrentChoices(result.choices);
        setTemporalLabel(result.temporalLabel);

        if (result.interrupted) {
          setPendingRetry(userInput);
          setStatus('interrupted');
        } else {
          setStatus('ready');
          // Focus input after generation
          setTimeout(() => inputRef.current?.focus(), 100);
        }
      } catch (err) {
        if (controller.signal.aborted) {
          // User-cancelled — remove the placeholder
          setTurns((prev) => prev.filter((t) => t.id !== assistantTurnId));
          setStatus('ready');
          return;
        }
        const message = err instanceof Error ? err.message : t('error.generic');
        setErrorMessage(message);
        // Update placeholder to show error state
        setTurns((prev) =>
          prev.map((t) =>
            t.id === assistantTurnId
              ? { ...t, content: `[${message}]`, isStreaming: false, interrupted: true }
              : t,
          ),
        );
        setStatus('error');
      } finally {
        setStreamingText('');
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [session, sessionId, t],
  );

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text || status === 'generating') return;
    setInputValue('');
    void runTurn(text);
  }, [inputValue, status, runTurn]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleRetry = useCallback(() => {
    const retryInput = pendingRetry ?? '';
    setPendingRetry(null);
    // Remove the last assistant turn (the interrupted one)
    setTurns((prev) => {
      const lastAssistant = [...prev].reverse().findIndex((t) => t.role === 'assistant');
      if (lastAssistant === -1) return prev;
      const idx = prev.length - 1 - lastAssistant;
      return prev.filter((_, i) => i !== idx);
    });
    void runTurn(retryInput);
  }, [pendingRetry, runTurn]);

  const handleChoiceSelect = useCallback(
    (choice: Choice) => {
      if (status === 'generating') return;
      // Send choice as user message with context
      const message = `${choice.label}. ${choice.description}`;
      setInputValue('');
      void runTurn(message);
    },
    [status, runTurn],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleExit = useCallback(() => {
    abortRef.current?.abort();
    navigate(-1);
  }, [navigate]);

  // ── Render helpers ────────────────────────────────────────────────────────

  if (status === 'not-found') {
    return (
      <div className="h-screen flex items-center justify-center bg-stone-950">
        <div className="text-center text-stone-400">
          <p className="text-lg">{t('session.noSession')}</p>
          <button
            onClick={() => navigate('/explore')}
            className="mt-4 text-amber-400 hover:text-amber-300 text-sm underline"
          >
            {t('nav.explore')}
          </button>
        </div>
      </div>
    );
  }

  const isGenerating = status === 'generating';
  const isInterrupted = status === 'interrupted';
  const canSend = inputValue.trim().length > 0 && !isGenerating;

  return (
    <div className="h-screen w-screen flex flex-col bg-stone-950 text-stone-100 overflow-hidden">
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-stone-800 shrink-0">
        <button
          onClick={handleExit}
          className="text-stone-400 hover:text-stone-200 text-sm flex items-center gap-1.5"
        >
          <span>←</span>
          <span>{t('session.exit')}</span>
        </button>

        {/* Temporal header (SJ-DIAL-019) */}
        {temporalLabel ? (
          <span className="text-amber-400/80 text-xs font-medium tracking-wide">
            {temporalLabel}
          </span>
        ) : (
          <span className="text-stone-600 text-xs">
            {activeProfile?.displayName ?? ''}
          </span>
        )}

        {/* Session timer indicator (SJ-SHELL-005:4) */}
        {sessionTimerMinutes != null && (
          <span className="text-stone-500 text-xs">
            {sessionTimerMinutes}{t('settings.timerUnit')}
          </span>
        )}
      </div>

      {/* ── Message list ─────────────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
      >
        {turns.map((turn) => (
          <TurnBubble
            key={turn.id}
            turn={turn}
            streamingText={turn.isStreaming ? streamingText : undefined}
          />
        ))}

        {/* Generation spinner */}
        {isGenerating && turns[turns.length - 1]?.isStreaming === false && (
          <div className="flex items-center gap-2 text-stone-500 text-sm">
            <span className="animate-pulse">●</span>
            <span>{t('session.generating')}</span>
          </div>
        )}

        {/* Interrupted banner */}
        {isInterrupted && (
          <div className="flex items-center justify-between bg-amber-900/30 border border-amber-700/40 rounded-lg px-4 py-2 text-amber-300 text-sm">
            <span>{t('session.interrupted')}</span>
            <button
              onClick={handleRetry}
              className="text-amber-400 hover:text-amber-200 font-medium ml-4"
            >
              {t('session.retry')}
            </button>
          </div>
        )}

        {/* Error banner */}
        {status === 'error' && errorMessage && (
          <div className="bg-red-900/30 border border-red-700/40 rounded-lg px-4 py-2 text-red-300 text-sm">
            {errorMessage}
          </div>
        )}
      </div>

      {/* ── Choice panel (SJ-DIAL-005:6) ─────────────────────────────────── */}
      {currentChoices.length >= 2 && !isGenerating && (
        <div className="px-4 pb-3 space-y-2 shrink-0">
          <p className="text-stone-500 text-xs">{t('session.choicePrompt')}</p>
          <div className="grid grid-cols-2 gap-2">
            {currentChoices.map((choice) => (
              <button
                key={choice.key}
                onClick={() => handleChoiceSelect(choice)}
                className="text-left bg-stone-800 hover:bg-stone-700 border border-stone-700 hover:border-amber-600 rounded-lg px-3 py-2.5 transition-colors"
              >
                <span className="text-amber-400 font-semibold text-sm mr-1.5">
                  {choice.label}.
                </span>
                <span className="text-stone-200 text-sm">{choice.description}</span>
                {choice.consequencePreview && (
                  <p className="text-stone-500 text-xs mt-1">{choice.consequencePreview}</p>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Input area ───────────────────────────────────────────────────── */}
      <div className="border-t border-stone-800 px-4 py-3 shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isGenerating ? t('session.generating') : t('session.inputPlaceholder')}
            disabled={isGenerating}
            rows={2}
            className="flex-1 bg-stone-800 border border-stone-700 focus:border-amber-600 rounded-lg px-3 py-2 text-stone-100 placeholder-stone-500 text-sm resize-none outline-none transition-colors disabled:opacity-50"
          />
          {isGenerating ? (
            <button
              onClick={handleStop}
              className="bg-stone-700 hover:bg-stone-600 text-stone-300 rounded-lg px-4 py-2 text-sm font-medium transition-colors shrink-0"
            >
              {t('session.stop')}
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!canSend}
              className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors shrink-0"
            >
              {t('session.send')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── TurnBubble sub-component ──────────────────────────────────────────────

type TurnBubbleProps = {
  turn: DisplayTurn;
  streamingText?: string;
};

function TurnBubble({ turn, streamingText }: TurnBubbleProps) {
  const displayContent = turn.isStreaming
    ? (streamingText ?? turn.content)
    : turn.content;

  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-amber-900/40 border border-amber-800/50 rounded-2xl rounded-tr-sm px-4 py-2.5 text-stone-100 text-sm leading-relaxed">
          {displayContent}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-1">
        <div
          className={[
            'bg-stone-800/80 border rounded-2xl rounded-tl-sm px-4 py-3 text-stone-100 text-sm leading-relaxed whitespace-pre-wrap',
            turn.isStreaming ? 'border-amber-700/30' : 'border-stone-700/50',
            turn.interrupted ? 'border-amber-700/60' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {displayContent || (
            <span className="animate-pulse text-stone-500">●●●</span>
          )}
          {turn.isStreaming && displayContent && (
            <span className="animate-pulse text-amber-400 ml-0.5">▌</span>
          )}
        </div>
        {turn.interrupted && (
          <p className="text-amber-600/70 text-xs px-1">⚠ Generation interrupted</p>
        )}
      </div>
    </div>
  );
}
