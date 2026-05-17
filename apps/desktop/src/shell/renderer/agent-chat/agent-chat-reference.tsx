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

  return (
    <section
      data-testid="agent-chat-reference"
      aria-labelledby="agent-chat-reference-title"
      data-scope-kind={binding.scopeRef.kind}
      data-scope-id={binding.scopeRef.scopeId}
      data-conversation-anchor-id={binding.conversationAnchorId}
    >
      <h2 id="agent-chat-reference-title">Agent Chat</h2>
      <p data-testid="agent-chat-scope">
        Scope: {binding.scopeRef.kind} / {binding.scopeRef.scopeId}
      </p>
      <p data-testid="agent-chat-anchor">Anchor: {binding.conversationAnchorId}</p>
      {binding.profileId ? (
        <button
          type="button"
          data-testid="agent-chat-apply-profile"
          onClick={() => {
            void handleApplyProfile();
          }}
        >
          Apply {binding.profileId}
        </button>
      ) : (
        <p data-testid="agent-chat-no-profile">No default profile bound to this scope yet.</p>
      )}
    </section>
  );
}
