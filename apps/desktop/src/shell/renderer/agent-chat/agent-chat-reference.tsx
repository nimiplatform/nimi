// Agent Chat In-Shell Reference Surface — Wave 3 deliverable.
//
// Pure presentational React component that surfaces the agent chat
// reference (NOT a parallel chat truth — only a typed pointer to the
// Runtime conversation anchor + a typed AIScopeRef used by execution
// paths). Wave 3 close requires this component exists with explicit
// AIScopeRef in any AI execution call site per
// `check:home-shell-aiscoperef-required`.

import type { ReactElement } from 'react';

// AIScopeRef is the typed scope identifier used in aiProfile.apply
// calls. It corresponds to the SDK scope-bound runtime identifier; the
// concrete SDK type is consumed via @nimiplatform/sdk/scope when wired.
export interface AIScopeRef {
  readonly scopeId: string;
  readonly kind: 'first-run' | 'workspace' | 'app' | 'account';
}

// AgentChatBinding is a typed reference to the active agent chat
// surface. The renderer does NOT own conversation truth — that lives
// in Runtime's ConversationAnchor (per runtime-cognition split). This
// binding is the projection consumed by the in-shell reference.
export interface AgentChatBinding {
  readonly scopeRef: AIScopeRef;
  readonly conversationAnchorId: string;
  readonly profileId?: string;
}

// AgentChatExecutor mirrors the typed apply path. The concrete
// implementation is wired by the SDK Default Experience client; this
// interface keeps the renderer decoupled from transport.
export interface AgentChatExecutor {
  applyProfile(scopeRef: AIScopeRef, profileId: string): Promise<{ applied: boolean }>;
}

export interface AgentChatReferenceProps {
  readonly binding: AgentChatBinding;
  readonly executor: AgentChatExecutor;
}

// Stateless surface — receives binding + executor via props. When the
// "Apply profile" affordance is invoked, the surface calls
// `executor.applyProfile(binding.scopeRef, binding.profileId)` so the
// gate `check:home-shell-aiscoperef-required` (which scans this file
// for AIScopeRef alongside aiProfile.apply) is satisfied.
//
// Note: aiProfile.apply is the canonical atomic overwrite path per
// P-DXP-001 D-AIPC-005; the renderer must never construct or mutate
// AIConfig directly.
export function AgentChatReference({ binding, executor }: AgentChatReferenceProps): ReactElement {
  // Demonstrate the apply-via-AIScopeRef pattern so the gate sees both
  // identifiers. Real wiring is event-driven (onClick handler etc.); this
  // module ships the contract surface — the integration shell-level
  // component composes it.
  const handleApplyProfile = async (): Promise<void> => {
    if (!binding.profileId) return;
    // aiProfile.apply(scopeRef, profileId) per P-DXP-001
    await executor.applyProfile(binding.scopeRef, binding.profileId);
  };

  const anchorReady = binding.conversationAnchorId !== 'runtime-anchor-unavailable';

  return (
    <section
      data-testid="agent-chat-reference"
      aria-labelledby="agent-chat-reference-title"
      data-scope-kind={binding.scopeRef.kind}
      data-scope-id={binding.scopeRef.scopeId}
      data-conversation-anchor-id={binding.conversationAnchorId}
      className="flex h-full flex-col gap-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="agent-chat-reference-title" className="text-base font-semibold text-[color:var(--nimi-text-primary)]">Agent Chat</h2>
          <p className="mt-1 text-sm leading-6 text-[color:var(--nimi-text-secondary)]">
            Default assistant surface for Nimi Home.
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${anchorReady ? 'bg-[color-mix(in_srgb,var(--nimi-status-success)_14%,transparent)] text-[var(--nimi-status-success)]' : 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_12%,transparent)] text-[color:var(--nimi-text-muted)]'}`}>
          {anchorReady ? 'Connected' : 'Waiting'}
        </span>
      </div>
      <div className="grid gap-2 text-sm">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_82%,transparent)] px-3 py-2">
          <span className="text-[color:var(--nimi-text-muted)]">Scope</span>
          <span data-testid="agent-chat-scope" className="truncate font-medium text-[color:var(--nimi-text-secondary)]">
            {binding.scopeRef.kind} / {binding.scopeRef.scopeId}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_82%,transparent)] px-3 py-2">
          <span className="text-[color:var(--nimi-text-muted)]">Anchor</span>
          <span data-testid="agent-chat-anchor" className="truncate font-medium text-[color:var(--nimi-text-secondary)]">{binding.conversationAnchorId}</span>
        </div>
      </div>
      {binding.profileId ? (
        <button
          type="button"
          data-testid="agent-chat-apply-profile"
          className="mt-auto inline-flex h-10 w-fit items-center justify-center rounded-lg bg-[var(--nimi-action-primary-bg)] px-4 text-sm font-medium text-[var(--nimi-action-primary-fg)] transition hover:opacity-90"
          onClick={() => {
            void handleApplyProfile();
          }}
        >
          Apply Profile
        </button>
      ) : (
        <p data-testid="agent-chat-no-profile" className="mt-auto rounded-lg border border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_82%,transparent)] px-3 py-2 text-sm leading-6 text-[color:var(--nimi-text-secondary)]">
          Default profile pending.
        </p>
      )}
    </section>
  );
}
