package agentsession

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
)

const (
	ftsHighConfidenceThreshold = 0.65
	ftsAmbiguityMargin         = 0.15
	maxHandoffHistoryTurns     = 6
	lightQAPromoteTurnNumber   = 4
)

func readerCanAccessSession(decision accountservice.LocalAppCallerDecision, rec *runtimev1.WorkSessionRecord) bool {
	if rec == nil {
		return false
	}
	// Any App activating agent.session.manage (or agent.body.pc) sees the account overview
	// without any hardcoded built-in app_id privilege.
	if hasSessionManage(decision) {
		return true
	}
	if hasCompanionScope(decision) && (rec.GetSessionKind() == "companion" || rec.GetIsPrimaryCompanion()) {
		return true
	}
	scopeKey := subjectScopeKey(decision)
	return scopeKey != "" && rec.GetPublisherScopeKey() != "" &&
		(rec.GetPublisherScopeKey() == scopeKey || strings.HasPrefix(rec.GetPublisherScopeKey(), "channel:"+strings.TrimSpace(decision.RegisteredAppSubject)+":"))
}

func visibilityForReader(decision accountservice.LocalAppCallerDecision) readerVisibilityFilter {
	if hasSessionManage(decision) {
		return readerVisibilityFilter{FullAccount: true}
	}
	return readerVisibilityFilter{
		IncludeCompanion: hasCompanionScope(decision),
		SubjectScopeKey:  subjectScopeKey(decision),
		ChannelPrefix:    "channel:" + strings.TrimSpace(decision.RegisteredAppSubject) + ":",
	}
}

func readerCanAccessAttention(decision accountservice.LocalAppCallerDecision, att *runtimev1.PendingAttentionRecord) bool {
	if att == nil {
		return false
	}
	if hasSessionManage(decision) {
		return true
	}
	scopeKey := subjectScopeKey(decision)
	return scopeKey != "" && att.GetTrustScope() == scopeKey
}

func deriveSessionTitle(text, workspaceRoot string) string {
	trimmed := strings.TrimSpace(text)
	if trimmed != "" {
		runes := []rune(trimmed)
		if len(runes) > 48 {
			return string(runes[:48]) + "…"
		}
		return trimmed
	}
	if ws := strings.TrimSpace(workspaceRoot); ws != "" {
		return filepath.Base(ws)
	}
	return "Untitled Session"
}

func sha256HexString(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// bodyIntentText is the literal user input admitted at the routing boundary.
func bodyIntentText(text, brief, root string, attachments []string, history []map[string]any) string {
	var parts []string
	if len(history) > 0 {
		raw, _ := json.Marshal(history)
		parts = append(parts, "Previous Nimi Home dialogue in chronological order:\n"+string(raw))
	}
	if brief = strings.TrimSpace(brief); brief != "" {
		parts = append(parts, "[Handoff Context]\n"+brief)
	}
	var paths []string
	for _, raw := range attachments {
		if raw = strings.TrimSpace(raw); raw == "" {
			continue
		}
		rel := raw
		if filepath.IsAbs(raw) {
			var err error
			rel, err = filepath.Rel(root, raw)
			if err != nil || root == "" || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
				paths = append(paths, "- "+filepath.Base(raw)+" (outside active workspace; import into workspace to inspect)")
				continue
			}
		}
		paths = append(paths, "- "+filepath.ToSlash(rel))
	}
	if len(paths) > 0 {
		parts = append(parts, "[Attached Workspace Files]\n"+strings.Join(paths, "\n"))
	}
	if text = strings.TrimSpace(text); text != "" {
		parts = append(parts, text)
	}
	return strings.Join(parts, "\n\n")
}

func looksLikePCWorkIntent(req *runtimev1.RouteAndSubmitInputRequest) bool {
	if strings.TrimSpace(req.GetWorkspaceRoot()) != "" || req.GetWorkspaceWritable() {
		return true
	}
	if len(req.GetAttachmentPaths()) > 0 {
		return true
	}
	if strings.TrimSpace(req.GetHandoffBriefText()) != "" {
		return true
	}
	entry := strings.TrimSpace(req.GetEntrySurface())
	if entry == "harness" || entry == "harness_new_session" || entry == "pc_work" {
		return true
	}
	return false
}

func computeSubmissionPayloadHash(agentBinding string, req *runtimev1.RouteAndSubmitInputRequest) string {
	raw, _ := json.Marshal(struct {
		AgentBinding           string   `json:"agentBinding"`
		Text                   string   `json:"text"`
		ExplicitWorkSessionRef string   `json:"explicitWorkSessionRef"`
		SelectedCandidateRef   string   `json:"selectedCandidateRef"`
		EntrySurface           string   `json:"entrySurface"`
		TrustTierHint          string   `json:"trustTierHint"`
		WorkspaceRoot          string   `json:"workspaceRoot"`
		WorkspaceWritable      bool     `json:"workspaceWritable"`
		AttachmentPaths        []string `json:"attachmentPaths"`
		CardSourceSessionRef   string   `json:"cardSourceSessionRef"`
		CardSourceMaxSeq       int64    `json:"cardSourceMaxSeq"`
		HandoffBriefText       string   `json:"handoffBriefText"`
		ReplyToMessageRef      string   `json:"replyToMessageRef"`
		DelegationObjectID     string   `json:"delegationObjectId"`
	}{
		AgentBinding:           agentBinding,
		Text:                   req.GetText(),
		ExplicitWorkSessionRef: strings.TrimSpace(req.GetExplicitWorkSessionRef()),
		SelectedCandidateRef:   strings.TrimSpace(req.GetSelectedCandidateRef()),
		EntrySurface:           strings.TrimSpace(req.GetEntrySurface()),
		TrustTierHint:          strings.TrimSpace(req.GetTrustTierHint()),
		WorkspaceRoot:          strings.TrimSpace(req.GetWorkspaceRoot()),
		WorkspaceWritable:      req.GetWorkspaceWritable(),
		AttachmentPaths:        req.GetAttachmentPaths(),
		CardSourceSessionRef:   strings.TrimSpace(req.GetCardSourceSessionRef()),
		CardSourceMaxSeq:       req.GetCardSourceMaxSeq(),
		HandoffBriefText:       req.GetHandoffBriefText(),
		ReplyToMessageRef:      strings.TrimSpace(req.GetReplyToMessageRef()),
		DelegationObjectID:     strings.TrimSpace(req.GetDelegationObjectId()),
	})
	return sha256HexString(string(raw))
}

func isLowEntropyShortFollowUp(text string) bool {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return false
	}
	if len([]rune(trimmed)) > 16 {
		return false
	}
	lower := strings.ToLower(trimmed)
	for _, cue := range []string{"继续", "接着", "改一下", "再改", "重试", "看下", "怎么样", "好了吗", "continue", "keep going", "fix it", "retry", "update it", "next"} {
		if strings.Contains(lower, cue) {
			return true
		}
	}
	return false
}

func extractCommittedHandoffEvents(events []*runtimev1.BrainSessionEventEnvelope) ([]map[string]any, int32) {
	var committed []*runtimev1.BrainSessionEventEnvelope
	for _, ev := range events {
		et := strings.ToLower(strings.TrimSpace(ev.GetEventType()))
		if et == "user_message" || et == "assistant_message" {
			committed = append(committed, ev)
		}
	}
	maxEvents := maxHandoffHistoryTurns * 2
	if len(committed) > maxEvents {
		committed = committed[len(committed)-maxEvents:]
	}
	out := make([]map[string]any, 0, len(committed))
	for _, ev := range committed {
		var parsed map[string]any
		_ = json.Unmarshal([]byte(ev.GetPayloadJson()), &parsed)
		out = append(out, map[string]any{
			"seq":       ev.GetSeq(),
			"eventType": ev.GetEventType(),
			"payload":   parsed,
			"createdAt": ev.GetCreatedAt(),
		})
	}
	turns := int32((len(out) + 1) / 2)
	if turns > maxHandoffHistoryTurns {
		turns = maxHandoffHistoryTurns
	}
	return out, turns
}

// RouteAndSubmitInput implements the Zero-Cloud-Model Three-Layer Router:
//   - External channel isolation (always runs before explicit anchor!)
//   - L1: explicit work_session_ref / selected_candidate_ref / alarm reply / handoff / promotion
//   - L2: deterministic rules (workspace binding, general_inbox 2h/10-turn sliding window, 4th-turn promotion)
//   - L3: local SQLite FTS5 Chinese overlapping-bigram BM25 + low-entropy follow-up gate (strictly outside write tx!)
//
// AMBIGUOUS_CANDIDATES returns a pure read-only preflight and NEVER writes runtime_session_submission.
// @nimi-authority: rule.nimi.runtime.agent-participation.multi-session-router
func (s *Service) RouteAndSubmitInput(ctx context.Context, req *runtimev1.RouteAndSubmitInputRequest) (*runtimev1.RouteAndSubmitInputResponse, error) {
	decision, err := s.authorize(ctx, localappop.OperationAgentSessionRouteSubmit)
	if err != nil {
		return nil, err
	}
	if req == nil || strings.TrimSpace(req.GetAgentHandle()) == "" || strings.TrimSpace(req.GetRequestId()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if strings.TrimSpace(req.GetText()) == "" && strings.TrimSpace(req.GetHandoffBriefText()) == "" && len(req.GetAttachmentPaths()) == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	now := s.now().UTC()
	agentBinding, err := s.resolveAgentBinding(ctx, decision, req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	requestID := strings.TrimSpace(req.GetRequestId())
	payloadHash := computeSubmissionPayloadHash(agentBinding, req)

	if (req.GetWorkspaceWritable() || strings.TrimSpace(req.GetWorkspaceRoot()) != "") && !hasSessionManage(decision) {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
	}

	// Fast read-only idempotency check scoped to (account_id, caller_subject, request_id) + payload_hash.
	if existing, err := s.store.LookupSubmission(ctx, decision.AccountID, decision.RegisteredAppSubject, requestID, payloadHash); err != nil {
		if errors.Is(err, errSubmissionPayloadConflict) {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	} else if existing != nil {
		if existing.WorkSessionRecord != nil && !readerCanAccessSession(decision, existing.WorkSessionRecord) {
			existing.WorkSessionRecord = nil
		}
		return existing, nil
	}

	var (
		targetRow                *sessionRow
		existingTargetUpdate     bool
		explicitPermissionChange bool
		closeSourceInboxRef      string
		routeReason              string
		heuristicDowngraded      bool
		promotedTurns            int32
		handoffHistoryPayload    []map[string]any
	)

	callerScope := subjectScopeKey(decision)

	// --- Layer 0 / 2A: External channel isolation MUST run BEFORE explicit anchor for ALL callers ---
	entrySurface := strings.TrimSpace(req.GetEntrySurface())
	trustHint := strings.ToLower(strings.TrimSpace(req.GetTrustTierHint()))
	isExternalChannel := strings.HasPrefix(entrySurface, "channel:") ||
		strings.Contains(strings.ToLower(entrySurface), "external") ||
		trustHint == "external" ||
		trustHint == "external_channel" ||
		trustHint == "untrusted" ||
		trustHint == "tainted"
	if isExternalChannel {
		channelTag := entrySurface
		if channelTag == "" {
			channelTag = "external"
		}
		scopeKey := "channel:" + strings.TrimSpace(decision.RegisteredAppSubject) + ":" + channelTag
		existing, err := s.store.FindActiveExternalChannelSession(ctx, decision.AccountID, agentBinding, scopeKey)
		if err != nil {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
		}
		if existing != nil {
			targetRow = existing
			existingTargetUpdate = true
			routeReason = "l2_external_channel_isolated_continue"
		} else {
			targetRow = &sessionRow{
				AccountID: decision.AccountID,
				Record: &runtimev1.WorkSessionRecord{
					WorkSessionRef:    newID("ws"),
					AgentBinding:      agentBinding,
					SessionKind:       "channel_external",
					OwnerBodyKind:     "brain",
					PublisherScopeKey: scopeKey,
					Title:             deriveSessionTitle(req.GetText(), ""),
					Status:            "active",
					TrustTier:         "external",
					PermissionMode:    "readonly",
					LatestReceiptJson: "{}",
				},
			}
			routeReason = "l2_external_channel_isolated_new"
		}
	}

	// --- Layer 1: Explicit target, __general_inbox__ sentinel, candidate selection, or alarm reply ---
	forceNewSession := entrySurface == "new_session" || entrySurface == "harness_new_session"
	forceGeneralInbox := false
	if targetRow == nil {
		explicitRef := strings.TrimSpace(req.GetExplicitWorkSessionRef())
		if explicitRef == "" {
			explicitRef = strings.TrimSpace(req.GetSelectedCandidateRef())
		}
		if explicitRef == "__general_inbox__" {
			forceGeneralInbox = true
		} else if explicitRef != "" {
			sess, err := s.store.GetSession(ctx, decision.AccountID, explicitRef)
			if errors.Is(err, errSessionNotFound) {
				return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
			}
			if err != nil {
				return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
			}
			if !readerCanAccessSession(decision, sess.Record) {
				return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
			}
			targetRow = sess
			existingTargetUpdate = true
			if strings.TrimSpace(req.GetSelectedCandidateRef()) != "" {
				routeReason = "l1_candidate_confirmed"
			} else {
				routeReason = "l1_explicit_session_ref"
			}
		} else if replyRef := strings.TrimSpace(req.GetReplyToMessageRef()); !forceNewSession && replyRef != "" {
			if resolvedAlarm, rErr := s.ResolveAlarmReplyTarget(ctx, decision.AccountID, agentBinding, replyRef, now); rErr == nil && resolvedAlarm.MatchedAlarm != nil {
				if alarmTarget := strings.TrimSpace(resolvedAlarm.MatchedAlarm.GetTargetWorkSessionRef()); alarmTarget != "" {
					if sess, gErr := s.store.GetSession(ctx, decision.AccountID, alarmTarget); gErr == nil && sess != nil && readerCanAccessSession(decision, sess.Record) {
						targetRow = sess
						existingTargetUpdate = true
						routeReason = "l1_alarm_reply_target"
					}
				}
			}
		} else if !forceNewSession && isLikelyAlarmReplyText(req.GetText()) {
			if resolvedAlarm, rErr := s.ResolveAlarmReplyTarget(ctx, decision.AccountID, agentBinding, "", now); rErr == nil {
				if resolvedAlarm.MatchedAlarm != nil {
					if alarmTarget := strings.TrimSpace(resolvedAlarm.MatchedAlarm.GetTargetWorkSessionRef()); alarmTarget != "" {
						if sess, gErr := s.store.GetSession(ctx, decision.AccountID, alarmTarget); gErr == nil && sess != nil && readerCanAccessSession(decision, sess.Record) {
							targetRow = sess
							existingTargetUpdate = true
							routeReason = "l1_alarm_reply_recent_single"
						}
					}
				} else if len(resolvedAlarm.AmbiguousAlarms) >= 2 {
					candidates := make([]*runtimev1.SessionRouteCandidate, 0, len(resolvedAlarm.AmbiguousAlarms))
					seen := make(map[string]struct{})
					for idx, candAlarm := range resolvedAlarm.AmbiguousAlarms {
						tRef := strings.TrimSpace(candAlarm.GetTargetWorkSessionRef())
						if tRef == "" {
							continue
						}
						if _, dup := seen[tRef]; dup {
							continue
						}
						if sess, gErr := s.store.GetSession(ctx, decision.AccountID, tRef); gErr == nil && sess != nil && readerCanAccessSession(decision, sess.Record) {
							seen[tRef] = struct{}{}
							candidates = append(candidates, &runtimev1.SessionRouteCandidate{
								WorkSessionRef: sess.Record.GetWorkSessionRef(),
								Title:          firstNonEmpty(candAlarm.GetTemplateTitle(), sess.Record.GetTitle()),
								SessionKind:    sess.Record.GetSessionKind(),
								OwnerBodyKind:  sess.Record.GetOwnerBodyKind(),
								UpdatedAt:      candAlarm.GetLastDeliveryAt(),
								Score:          float64(len(resolvedAlarm.AmbiguousAlarms) - idx),
							})
						}
					}
					if len(candidates) >= 2 {
						return &runtimev1.RouteAndSubmitInputResponse{
							Outcome:     runtimev1.RouteAndSubmitOutcome_ROUTE_AND_SUBMIT_OUTCOME_AMBIGUOUS_CANDIDATES,
							RouteReason: "l1_alarm_reply_ambiguous",
							Candidates:  candidates,
						}, nil
					}
				}
			}
		}
	}

	// A Body App can route an intent into its own registered execution surface.
	// Explicit anchors and external-channel isolation take precedence.
	if targetRow == nil && !forceGeneralInbox && strings.HasPrefix(entrySurface, "app."+decision.AppID+".") && decision.HasActivatedDomain(DomainAgentBodyApp) {
		namespace, err := s.appBodyNamespace(ctx, decision, entrySurface)
		if err != nil {
			return nil, err
		}
		targetRow = &sessionRow{AccountID: decision.AccountID, Record: &runtimev1.WorkSessionRecord{
			WorkSessionRef: newID("ws"), AgentBinding: agentBinding, SessionKind: "app_work",
			OwnerBodyKind: namespace, PublisherScopeKey: callerScope, Title: deriveSessionTitle(req.GetText(), ""),
			Status: "active", TrustTier: "trusted", PermissionMode: "plan-readonly", LatestReceiptJson: "{}",
		}}
		routeReason = "l1_registered_app_body"
	}

	// --- Layer 2B: Card promotion / Zhiyu editable brief handoff ---
	if targetRow == nil && !forceGeneralInbox && strings.TrimSpace(req.GetCardSourceSessionRef()) != "" {
		sourceRef := strings.TrimSpace(req.GetCardSourceSessionRef())
		src, err := s.store.GetSession(ctx, decision.AccountID, sourceRef)
		if errors.Is(err, errSessionNotFound) {
			return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
		}
		if err != nil {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
		}
		if !readerCanAccessSession(decision, src.Record) {
			return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
		}
		// Never promote untrusted/external channel sessions into a trusted PC workspace!
		if src.Record.GetTrustTier() != "trusted" || src.Record.GetSessionKind() == "channel_external" {
			return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
		}
		maxSeq := req.GetCardSourceMaxSeq()
		events, err := s.store.ListBrainEvents(ctx, sourceRef, 0, maxSeq, 128)
		if err != nil {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
		}
		handoffHistoryPayload, promotedTurns = extractCommittedHandoffEvents(events)
		permMode := "plan-readonly"
		if req.GetWorkspaceWritable() && strings.TrimSpace(req.GetWorkspaceRoot()) != "" && hasSessionManage(decision) {
			permMode = "workspace-edit"
		}
		if src.Record.GetIsGeneralInbox() {
			closeSourceInboxRef = sourceRef
		}
		targetRow = &sessionRow{
			AccountID:    decision.AccountID,
			TopicSummary: deriveSessionTitle(req.GetText(), req.GetWorkspaceRoot()),
			Record: &runtimev1.WorkSessionRecord{
				WorkSessionRef:       newID("ws"),
				AgentBinding:         agentBinding,
				SessionKind:          "pc_work",
				OwnerBodyKind:        DefaultPCNamespace,
				PublisherScopeKey:    callerScope,
				ForkedFromSessionRef: sourceRef,
				ForkedAtSeq:          maxSeq,
				Title:                deriveSessionTitle(req.GetText(), req.GetWorkspaceRoot()),
				Status:               "active",
				TrustTier:            src.Record.GetTrustTier(),
				WorkspaceRoot:        strings.TrimSpace(req.GetWorkspaceRoot()),
				PermissionMode:       permMode,
				LatestReceiptJson:    "{}",
			},
		}
		routeReason = "l2_light_qa_promoted_to_pc_work"
	}

	if targetRow == nil && !forceGeneralInbox && strings.TrimSpace(req.GetHandoffBriefText()) != "" {
		permMode := "plan-readonly"
		if req.GetWorkspaceWritable() && strings.TrimSpace(req.GetWorkspaceRoot()) != "" && hasSessionManage(decision) {
			permMode = "workspace-edit"
		}
		targetRow = &sessionRow{
			AccountID:    decision.AccountID,
			TopicSummary: deriveSessionTitle(req.GetHandoffBriefText(), req.GetWorkspaceRoot()),
			Record: &runtimev1.WorkSessionRecord{
				WorkSessionRef:    newID("ws"),
				AgentBinding:      agentBinding,
				SessionKind:       "pc_work",
				OwnerBodyKind:     DefaultPCNamespace,
				PublisherScopeKey: callerScope,
				Title:             deriveSessionTitle(req.GetHandoffBriefText(), req.GetWorkspaceRoot()),
				Status:            "active",
				TrustTier:         "trusted",
				WorkspaceRoot:     strings.TrimSpace(req.GetWorkspaceRoot()),
				PermissionMode:    permMode,
				LatestReceiptJson: "{}",
			},
		}
		routeReason = "l2_editable_brief_handoff"
	}

	// --- Layer 2C: Explicit workspace root routing ---
	if targetRow == nil && !forceGeneralInbox && strings.TrimSpace(req.GetWorkspaceRoot()) != "" {
		wsRoot := strings.TrimSpace(req.GetWorkspaceRoot())
		var existing *sessionRow
		if !forceNewSession {
			var err error
			existing, err = s.store.FindActiveSessionByWorkspace(ctx, decision.AccountID, agentBinding, wsRoot)
			if err != nil {
				return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
			}
		}
		if existing != nil && readerCanAccessSession(decision, existing.Record) {
			targetRow = existing
			existingTargetUpdate = true
			routeReason = "l2_workspace_root_match"
		} else {
			permMode := "plan-readonly"
			if req.GetWorkspaceWritable() && hasSessionManage(decision) {
				permMode = "workspace-edit"
			}
			targetRow = &sessionRow{
				AccountID:    decision.AccountID,
				TopicSummary: deriveSessionTitle(req.GetText(), wsRoot),
				Record: &runtimev1.WorkSessionRecord{
					WorkSessionRef:    newID("ws"),
					AgentBinding:      agentBinding,
					SessionKind:       "pc_work",
					OwnerBodyKind:     DefaultPCNamespace,
					PublisherScopeKey: callerScope,
					Title:             deriveSessionTitle(req.GetText(), wsRoot),
					Status:            "active",
					TrustTier:         "trusted",
					WorkspaceRoot:     wsRoot,
					PermissionMode:    permMode,
					LatestReceiptJson: "{}",
				},
			}
			routeReason = "l2_workspace_new_pc_work"
		}
	}

	// --- Layer 3: Local FTS5 Chinese Bigram BM25 + low-entropy short follow-up gate (strictly OUTSIDE write tx!) ---
	if targetRow == nil && !forceGeneralInbox && strings.TrimSpace(req.GetText()) != "" && !forceNewSession {
		matches, err := s.store.QueryFTSCandidates(ctx, decision.AccountID, agentBinding, req.GetText(), 5)
		if err != nil {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
		}
		var visible []ftsMatch
		for _, m := range matches {
			if readerCanAccessSession(decision, m.Row.Record) {
				visible = append(visible, m)
			}
		}
		if len(visible) >= 2 && visible[0].Score >= 0.45 && (visible[0].Score-visible[1].Score) < ftsAmbiguityMargin {
			topN := len(visible)
			if topN > 3 {
				topN = 3
			}
			candidates := make([]*runtimev1.SessionRouteCandidate, 0, topN)
			for _, m := range visible[:topN] {
				candidates = append(candidates, &runtimev1.SessionRouteCandidate{
					WorkSessionRef: m.Row.Record.GetWorkSessionRef(),
					Title:          m.Row.Record.GetTitle(),
					SessionKind:    m.Row.Record.GetSessionKind(),
					OwnerBodyKind:  m.Row.Record.GetOwnerBodyKind(),
					UpdatedAt:      m.Row.Record.GetUpdatedAt(),
					Score:          m.Score,
				})
			}
			return &runtimev1.RouteAndSubmitInputResponse{
				Outcome:     runtimev1.RouteAndSubmitOutcome_ROUTE_AND_SUBMIT_OUTCOME_AMBIGUOUS_CANDIDATES,
				RouteReason: "l3_fts5_ambiguous_candidates",
				Candidates:  candidates,
			}, nil
		}
		if len(visible) >= 1 && visible[0].Score >= ftsHighConfidenceThreshold &&
			(len(visible) == 1 || (visible[0].Score-visible[1].Score) >= ftsAmbiguityMargin) {
			targetRow = visible[0].Row
			existingTargetUpdate = true
			routeReason = "l3_fts5_confident_continue"
			if targetRow.Record.GetSessionKind() == "pc_work" && targetRow.Record.GetPermissionMode() == "workspace-edit" {
				targetRow.Record.PermissionMode = "plan-readonly"
				explicitPermissionChange = true
				heuristicDowngraded = true
			}
		} else if isLowEntropyShortFollowUp(req.GetText()) {
			recentRows, _, _, listErr := s.store.ListSessions(ctx, decision.AccountID, agentBinding, false, []string{"pc_work"}, "active", "", visibilityForReader(decision), 4, "")
			if listErr == nil && len(recentRows) >= 2 {
				topN := len(recentRows)
				if topN > 3 {
					topN = 3
				}
				candidates := make([]*runtimev1.SessionRouteCandidate, 0, topN)
				for _, r := range recentRows[:topN] {
					candidates = append(candidates, &runtimev1.SessionRouteCandidate{
						WorkSessionRef: r.Record.GetWorkSessionRef(),
						Title:          r.Record.GetTitle(),
						SessionKind:    r.Record.GetSessionKind(),
						OwnerBodyKind:  r.Record.GetOwnerBodyKind(),
						UpdatedAt:      r.Record.GetUpdatedAt(),
						Score:          0.5,
					})
				}
				return &runtimev1.RouteAndSubmitInputResponse{
					Outcome:     runtimev1.RouteAndSubmitOutcome_ROUTE_AND_SUBMIT_OUTCOME_AMBIGUOUS_CANDIDATES,
					RouteReason: "l3_low_entropy_followup_ambiguous",
					Candidates:  candidates,
				}, nil
			}
		}
	}

	// --- Layer 2D: Fallback to general_inbox (2h / 10-turn sliding window, 4th-turn auto-promotion) or new pc_work ---
	if targetRow == nil {
		if !forceGeneralInbox && looksLikePCWorkIntent(req) {
			permMode := "plan-readonly"
			if req.GetWorkspaceWritable() && strings.TrimSpace(req.GetWorkspaceRoot()) != "" && hasSessionManage(decision) {
				permMode = "workspace-edit"
			}
			targetRow = &sessionRow{
				AccountID:    decision.AccountID,
				TopicSummary: deriveSessionTitle(req.GetText(), req.GetWorkspaceRoot()),
				Record: &runtimev1.WorkSessionRecord{
					WorkSessionRef:    newID("ws"),
					AgentBinding:      agentBinding,
					SessionKind:       "pc_work",
					OwnerBodyKind:     DefaultPCNamespace,
					PublisherScopeKey: callerScope,
					Title:             deriveSessionTitle(req.GetText(), req.GetWorkspaceRoot()),
					Status:            "active",
					TrustTier:         "trusted",
					WorkspaceRoot:     strings.TrimSpace(req.GetWorkspaceRoot()),
					PermissionMode:    permMode,
					LatestReceiptJson: "{}",
				},
			}
			routeReason = "l2_new_pc_work"
		} else {
			inbox, err := s.store.FindActiveGeneralInbox(ctx, decision.AccountID, agentBinding, visibilityForReader(decision), now)
			if err != nil {
				return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
			}
			if inbox != nil && !forceGeneralInbox && inbox.InboxTurnCount+1 >= lightQAPromoteTurnNumber {
				events, _ := s.store.ListBrainEvents(ctx, inbox.Record.GetWorkSessionRef(), 0, inbox.Record.GetHeadSeq(), 128)
				handoffHistoryPayload, promotedTurns = extractCommittedHandoffEvents(events)
				closeSourceInboxRef = inbox.Record.GetWorkSessionRef()
				targetRow = &sessionRow{
					AccountID:    decision.AccountID,
					TopicSummary: deriveSessionTitle(req.GetText(), ""),
					Record: &runtimev1.WorkSessionRecord{
						WorkSessionRef:       newID("ws"),
						AgentBinding:         agentBinding,
						SessionKind:          "pc_work",
						OwnerBodyKind:        DefaultPCNamespace,
						PublisherScopeKey:    callerScope,
						ForkedFromSessionRef: inbox.Record.GetWorkSessionRef(),
						ForkedAtSeq:          inbox.Record.GetHeadSeq(),
						Title:                deriveSessionTitle(req.GetText(), ""),
						Status:               "active",
						TrustTier:            "trusted",
						PermissionMode:       "plan-readonly",
						LatestReceiptJson:    "{}",
					},
				}
				routeReason = "l2_general_inbox_4th_turn_promoted"
			} else if inbox != nil {
				targetRow = inbox
				existingTargetUpdate = true
				routeReason = "l2_general_inbox_continue"
			} else {
				targetRow = &sessionRow{
					AccountID:      decision.AccountID,
					InboxTurnCount: 1,
					TopicSummary:   deriveSessionTitle(req.GetText(), ""),
					Record: &runtimev1.WorkSessionRecord{
						WorkSessionRef:    newID("ws"),
						AgentBinding:      agentBinding,
						SessionKind:       "general_inbox",
						OwnerBodyKind:     "brain",
						PublisherScopeKey: callerScope,
						IsGeneralInbox:    true,
						Title:             deriveSessionTitle(req.GetText(), ""),
						Status:            "active",
						TrustTier:         "trusted",
						PermissionMode:    "readonly",
						LatestReceiptJson: "{}",
					},
				}
				routeReason = "l2_general_inbox_new"
			}
		}
	}

	if heuristicDowngraded {
		routeReason += "+downgraded_plan_readonly"
	}

	commitIn := routedCommitInput{
		AccountID:                decision.AccountID,
		CallerSubject:            decision.RegisteredAppSubject,
		ClientSubmissionID:       requestID,
		SubmissionPayloadHash:    payloadHash,
		Session:                  targetRow,
		ExistingSessionUpdate:    existingTargetUpdate,
		ExplicitPermissionChange: explicitPermissionChange,
		CloseSourceInboxRef:      closeSourceInboxRef,
		Outcome:                  runtimev1.RouteAndSubmitOutcome_ROUTE_AND_SUBMIT_OUTCOME_ACCEPTED,
		RouteReason:              routeReason,
		PromotedTurns:            promotedTurns,
		Now:                      now,
	}

	if targetRow.Record.GetOwnerBodyKind() != "" && targetRow.Record.GetOwnerBodyKind() != "brain" {
		ns := targetRow.Record.GetOwnerBodyKind()
		deviceID, online, err := s.store.FindActiveCarrierDevice(ctx, decision.AccountID, ns, now)
		if err != nil {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
		}
		existingBoundDev := strings.TrimSpace(targetRow.Record.GetDeviceId())
		if existingTargetUpdate && existingBoundDev != "" && existingBoundDev != "local-default" {
			// Preserve an existing session's bound device rather than silently overwriting it.
			online = online && deviceID == existingBoundDev
			deviceID = existingBoundDev
		} else if deviceID == "" {
			deviceID = existingBoundDev
		}
		if deviceID == "" {
			deviceID = "local-default"
		}
		targetRow.Record.DeviceId = deviceID
		if !online {
			commitIn.Outcome = runtimev1.RouteAndSubmitOutcome_ROUTE_AND_SUBMIT_OUTCOME_DEFERRED_BODY_OFFLINE
			targetRow.Record.Status = "queued_body_offline"
		}
		payloadMap := map[string]any{
			"bodyInputText":     bodyIntentText(req.GetText(), req.GetHandoffBriefText(), targetRow.Record.GetWorkspaceRoot(), req.GetAttachmentPaths(), handoffHistoryPayload),
			"agentHandle":       req.GetAgentHandle(),
			"requestId":         requestID,
			"text":              req.GetText(),
			"entrySurface":      entrySurface,
			"workspaceRoot":     targetRow.Record.GetWorkspaceRoot(),
			"workspaceWritable": req.GetWorkspaceWritable(),
			"permissionMode":    targetRow.Record.GetPermissionMode(),
			"attachmentPaths":   req.GetAttachmentPaths(),
			"handoffBriefText":  req.GetHandoffBriefText(),
			"replyToMessageRef": req.GetReplyToMessageRef(),
			"routeReason":       routeReason,
		}
		if len(handoffHistoryPayload) > 0 {
			payloadMap["handoffHistory"] = handoffHistoryPayload
		}
		payloadBytes, _ := json.Marshal(payloadMap)
		payloadStr := string(payloadBytes)
		outboxEnv := &runtimev1.BodyOutboxEnvelope{
			OutboxId:            newID("outbox"),
			DeviceId:            deviceID,
			CapabilityNamespace: ns,
			WorkSessionRef:      targetRow.Record.GetWorkSessionRef(),
			CommandKind:         runtimev1.BodyOutboxCommandKind_BODY_OUTBOX_COMMAND_KIND_NEW_INTENT,
			PayloadJson:         payloadStr,
			CreatedAt:           formatRFC3339(now),
			AgentBinding:        targetRow.Record.GetAgentBinding(),
		}
		commitIn.OutboxEnvelope = outboxEnv
		commitIn.OutboxPayloadHash = sha256HexString(payloadStr)
	} else {
		payloadBytes, _ := json.Marshal(map[string]any{
			"role":            "user",
			"requestId":       requestID,
			"text":            req.GetText(),
			"attachmentPaths": req.GetAttachmentPaths(),
			"entrySurface":    entrySurface,
		})
		commitIn.BrainEvent = &runtimev1.BrainSessionEventEnvelope{
			EventType:   "user_message",
			PayloadJson: string(payloadBytes),
		}
	}

	resp, deduplicated, err := s.store.CommitRoutedSubmission(ctx, commitIn)
	if err != nil {
		if errors.Is(err, errSubmissionPayloadConflict) {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		if errors.Is(err, errSessionConflict) {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_CONFLICT)
		}
		if errors.Is(err, errSessionNotFound) {
			return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
		}
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	if !deduplicated {
		if commitIn.OutboxEnvelope != nil {
			s.notifyOutboxSubscribers(decision.AccountID, commitIn.OutboxEnvelope.GetDeviceId(), commitIn.OutboxEnvelope.GetCapabilityNamespace(), commitIn.OutboxEnvelope)
		}
		if commitIn.BrainEvent != nil {
			s.notifyBrainEventSubscribers(commitIn.BrainEvent)
			s.maybeStartBrainTurn(decision, targetRow.Record, req.GetText(), requestID)
		}
		s.notifyOverviewChange(decision.AccountID, []*runtimev1.WorkSessionRecord{targetRow.Record}, nil)
	}
	return resp, nil
}

func (s *Service) SplitOrRedirectInput(ctx context.Context, req *runtimev1.SplitOrRedirectInputRequest) (*runtimev1.SplitOrRedirectInputResponse, error) {
	decision, err := s.authorize(ctx, localappop.OperationAgentSessionSplitRedirect)
	if err != nil {
		return nil, err
	}
	if req == nil || strings.TrimSpace(req.GetSourceWorkSessionRef()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	src, err := s.store.GetSession(ctx, decision.AccountID, strings.TrimSpace(req.GetSourceWorkSessionRef()))
	if errors.Is(err, errSessionNotFound) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
	}
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	if !readerCanAccessSession(decision, src.Record) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
	}
	now := s.now().UTC()
	sourceSeq := req.GetSourceEventSeq()
	if sourceSeq <= 0 {
		sourceSeq = src.Record.GetHeadSeq()
	}
	events, err := s.store.ListBrainEvents(ctx, src.Record.GetWorkSessionRef(), max(0, sourceSeq-64), sourceSeq, 64)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	movedText := ""
	var fallbackSeq, movedSeq int64
	fallbackText := ""
	for i := len(events) - 1; i >= 0; i-- {
		ev := events[i]
		if ev == nil {
			continue
		}
		var payload map[string]any
		_ = json.Unmarshal([]byte(ev.GetPayloadJson()), &payload)
		text, _ := payload["text"].(string)
		text = strings.TrimSpace(text)
		if text == "" {
			continue
		}
		if fallbackText == "" {
			fallbackText = text
			fallbackSeq = ev.GetSeq()
		}
		if strings.EqualFold(strings.TrimSpace(ev.GetEventType()), "user_message") {
			movedText = text
			movedSeq = ev.GetSeq()
			break
		}
	}
	if movedText == "" {
		movedText = fallbackText
		movedSeq = fallbackSeq
	}

	targetKind := strings.ToLower(strings.TrimSpace(req.GetTargetSessionKind()))
	if targetKind == "" {
		targetKind = "pc_work"
	}
	switch targetKind {
	case "pc_work", "general_inbox", "channel_external":
	default:
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if (req.GetWorkspaceWritable() || strings.TrimSpace(req.GetWorkspaceRoot()) != "") && !hasSessionManage(decision) {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
	}
	isSourceExternal := src.Record.GetTrustTier() != "trusted" || src.Record.GetSessionKind() == "channel_external"
	if isSourceExternal && targetKind != "channel_external" {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
	}
	ownerBodyKind := DefaultPCNamespace
	if targetKind != "pc_work" {
		ownerBodyKind = "brain"
	}
	title := strings.TrimSpace(req.GetTitle())
	if title == "" {
		if strings.TrimSpace(movedText) != "" {
			title = deriveSessionTitle(movedText, req.GetWorkspaceRoot())
		} else if srcTitle := strings.TrimSpace(src.Record.GetTitle()); srcTitle != "" && srcTitle != "Untitled Session" {
			title = srcTitle
		} else {
			title = deriveSessionTitle(movedText, req.GetWorkspaceRoot())
		}
	}
	permMode := "plan-readonly"
	if req.GetWorkspaceWritable() && strings.TrimSpace(req.GetWorkspaceRoot()) != "" {
		permMode = "workspace-edit"
	}
	targetTrustTier := src.Record.GetTrustTier()
	if targetTrustTier == "" {
		targetTrustTier = "trusted"
	}
	targetRow := &sessionRow{
		AccountID:    decision.AccountID,
		TopicSummary: title,
		Record: &runtimev1.WorkSessionRecord{
			WorkSessionRef:       newID("ws"),
			AgentBinding:         src.Record.GetAgentBinding(),
			SessionKind:          targetKind,
			OwnerBodyKind:        ownerBodyKind,
			PublisherScopeKey:    subjectScopeKey(decision),
			ForkedFromSessionRef: src.Record.GetWorkSessionRef(),
			ForkedAtSeq:          sourceSeq,
			Title:                title,
			Status:               "active",
			TrustTier:            targetTrustTier,
			WorkspaceRoot:        strings.TrimSpace(req.GetWorkspaceRoot()),
			PermissionMode:       permMode,
			LatestReceiptJson:    "{}",
		},
	}

	reqID := strings.TrimSpace(req.GetRequestId())
	if reqID == "" {
		reqID = newID("split")
	}
	commitIn := routedCommitInput{
		AccountID:              decision.AccountID,
		CallerSubject:          decision.RegisteredAppSubject,
		ClientSubmissionID:     reqID,
		SubmissionPayloadHash:  sha256HexString(src.Record.GetWorkSessionRef() + ":" + fmt.Sprintf("%d", sourceSeq) + ":" + targetKind + ":" + title),
		Session:                targetRow,
		MoveSourceEventSession: src.Record.GetWorkSessionRef(),
		MoveSourceEventSeq:     movedSeq,
		Outcome:                runtimev1.RouteAndSubmitOutcome_ROUTE_AND_SUBMIT_OUTCOME_ACCEPTED,
		RouteReason:            "split_or_redirect",
		Now:                    now,
	}
	if ownerBodyKind != "brain" {
		deviceID, _, _ := s.store.FindActiveCarrierDevice(ctx, decision.AccountID, ownerBodyKind, now)
		if deviceID == "" {
			deviceID = "local-default"
			targetRow.Record.Status = "queued_body_offline"
		}
		targetRow.Record.DeviceId = deviceID
		payloadBytes, _ := json.Marshal(map[string]any{
			"requestId":            reqID,
			"text":                 movedText,
			"forkedFromSessionRef": src.Record.GetWorkSessionRef(),
			"forkedAtSeq":          sourceSeq,
			"workspaceRoot":        targetRow.Record.GetWorkspaceRoot(),
			"permissionMode":       targetRow.Record.GetPermissionMode(),
		})
		payloadStr := string(payloadBytes)
		commitIn.OutboxEnvelope = &runtimev1.BodyOutboxEnvelope{
			OutboxId:            newID("outbox"),
			DeviceId:            deviceID,
			CapabilityNamespace: ownerBodyKind,
			WorkSessionRef:      targetRow.Record.GetWorkSessionRef(),
			CommandKind:         runtimev1.BodyOutboxCommandKind_BODY_OUTBOX_COMMAND_KIND_NEW_INTENT,
			PayloadJson:         payloadStr,
			CreatedAt:           formatRFC3339(now),
			AgentBinding:        targetRow.Record.GetAgentBinding(),
		}
		commitIn.OutboxPayloadHash = sha256HexString(payloadStr)
	} else {
		payloadBytes, _ := json.Marshal(map[string]any{"role": "user", "text": movedText, "redirectedFrom": src.Record.GetWorkSessionRef()})
		commitIn.BrainEvent = &runtimev1.BrainSessionEventEnvelope{
			EventType:   "user_message",
			PayloadJson: string(payloadBytes),
		}
	}

	resp, deduplicated, err := s.store.CommitRoutedSubmission(ctx, commitIn)
	if err != nil {
		if errors.Is(err, errSubmissionPayloadConflict) {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	if !deduplicated {
		if commitIn.OutboxEnvelope != nil {
			s.notifyOutboxSubscribers(decision.AccountID, commitIn.OutboxEnvelope.GetDeviceId(), commitIn.OutboxEnvelope.GetCapabilityNamespace(), commitIn.OutboxEnvelope)
		}
		s.notifyOverviewChange(decision.AccountID, []*runtimev1.WorkSessionRecord{targetRow.Record}, nil)
	}
	return &runtimev1.SplitOrRedirectInputResponse{
		TargetWorkSessionRef: resp.GetResolvedWorkSessionRef(),
		OutboxId:             resp.GetOutboxId(),
		WorkSessionRecord:    resp.GetWorkSessionRecord(),
	}, nil
}

func (s *Service) GetSession(ctx context.Context, req *runtimev1.GetSessionRequest) (*runtimev1.GetSessionResponse, error) {
	decision, err := s.authorize(ctx, localappop.OperationAgentSessionGet)
	if err != nil {
		return nil, err
	}
	if req == nil || strings.TrimSpace(req.GetWorkSessionRef()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	sess, err := s.store.GetSession(ctx, decision.AccountID, strings.TrimSpace(req.GetWorkSessionRef()))
	if errors.Is(err, errSessionNotFound) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
	}
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	if !readerCanAccessSession(decision, sess.Record) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
	}
	out := &runtimev1.GetSessionResponse{WorkSessionRecord: sess.Record}
	if req.GetIncludeRecentEvents() {
		limit := int(req.GetMaxEvents())
		if limit <= 0 || limit > 200 {
			limit = 50
		}
		events, err := s.store.ListBrainEvents(ctx, sess.Record.GetWorkSessionRef(), 0, 0, limit)
		if err != nil {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
		}
		out.RecentEvents = events
	}
	return out, nil
}

func (s *Service) ListSessions(ctx context.Context, req *runtimev1.ListSessionsRequest) (*runtimev1.ListSessionsResponse, error) {
	decision, err := s.authorize(ctx, localappop.OperationAgentSessionList)
	if err != nil {
		return nil, err
	}
	agentFilter := strings.TrimSpace(req.GetAgentHandle())
	if agentFilter != "" {
		resolved, rErr := s.resolveAgentBinding(ctx, decision, agentFilter)
		if rErr != nil {
			return nil, rErr
		}
		agentFilter = resolved
	}
	rows, totalVisible, nextPageToken, err := s.store.ListSessions(
		ctx,
		decision.AccountID,
		agentFilter,
		req.GetIncludeArchived(),
		req.GetSessionKinds(),
		req.GetStatusFilter(),
		req.GetSearchQuery(),
		visibilityForReader(decision),
		int(req.GetPageSize()),
		req.GetPageToken(),
	)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	items := make([]*runtimev1.WorkSessionRecord, 0, len(rows))
	for _, r := range rows {
		items = append(items, r.Record)
	}
	return &runtimev1.ListSessionsResponse{
		Items:             items,
		NextPageToken:     nextPageToken,
		TotalVisibleCount: uint32(totalVisible),
	}, nil
}

func (s *Service) UpdateSession(ctx context.Context, req *runtimev1.UpdateSessionRequest) (*runtimev1.UpdateSessionResponse, error) {
	decision, err := s.authorize(ctx, localappop.OperationAgentSessionUpdate)
	if err != nil {
		return nil, err
	}
	if req == nil || strings.TrimSpace(req.GetWorkSessionRef()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	// Strict status & permission_mode allowlists: UpdateSession may never bypass DeleteSession or escalate permissions.
	if st := strings.TrimSpace(req.GetStatus()); st != "" {
		switch st {
		case "active", "archived", "paused":
		default:
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	}
	if pm := strings.TrimSpace(req.GetPermissionMode()); pm != "" {
		switch pm {
		case "readonly", "plan-readonly", "strict", "workspace-edit", "companion":
		default:
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		if (pm == "workspace-edit" || pm == "strict") && !hasSessionManage(decision) {
			return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
		}
	}
	existing, err := s.store.GetSession(ctx, decision.AccountID, strings.TrimSpace(req.GetWorkSessionRef()))
	if errors.Is(err, errSessionNotFound) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
	}
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	if !readerCanAccessSession(decision, existing.Record) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
	}
	updated, err := s.store.UpdateSessionFields(ctx, decision.AccountID, req, s.now().UTC())
	if errors.Is(err, errSessionNotFound) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
	}
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	s.notifyOverviewChange(decision.AccountID, []*runtimev1.WorkSessionRecord{updated.Record}, nil)
	return &runtimev1.UpdateSessionResponse{WorkSessionRecord: updated.Record}, nil
}

func (s *Service) completeSessionDeletion(ctx context.Context, accountID string, existing *sessionRow) (*sessionRow, string, uint32, error) {
	ref := existing.Record.GetWorkSessionRef()
	s.cancelBrainTurn(ref)

	// Tombstone and enqueue Body purge in one sessions.db transaction. The nullable
	// count remains a durable cleanup obligation until Cognition acknowledges it.
	deleted, env, err := s.store.MarkSessionDeletedAndEnqueuePurge(ctx, accountID, ref, s.now().UTC())
	if err != nil {
		return nil, "", 0, err
	}
	if env != nil {
		s.notifyOutboxSubscribers(accountID, env.GetDeviceId(), env.GetCapabilityNamespace(), env)
	}
	s.deleteSessionStepLock(ref)
	s.notifyOverviewChange(accountID, nil, []*runtimev1.WorkSessionRecord{deleted.Record})
	var count sql.NullInt64
	var outboxID string
	err = s.store.readDB.QueryRowContext(ctx, `SELECT forgotten_memory_count,
		COALESCE((SELECT outbox_id FROM runtime_body_outbox WHERE account_id = s.account_id
		AND work_session_ref = s.work_session_ref AND command_kind = ? ORDER BY created_at LIMIT 1), '')
		FROM runtime_session s WHERE account_id = ? AND work_session_ref = ?`,
		runtimev1.BodyOutboxCommandKind_BODY_OUTBOX_COMMAND_KIND_PURGE_SESSION, accountID, ref).Scan(&count, &outboxID)
	if err != nil {
		return nil, "", 0, err
	}
	if !count.Valid {
		var forgotten uint32
		if s.memoryCleanupHook != nil {
			forgotten, err = s.memoryCleanupHook(ctx, accountID, deleted.Record.GetAgentBinding(), ref)
			if err != nil {
				return nil, "", 0, err
			}
		}
		err = s.store.writeDB.QueryRowContext(ctx, `UPDATE runtime_session SET forgotten_memory_count =
			COALESCE(forgotten_memory_count, ?) WHERE account_id = ? AND work_session_ref = ?
			RETURNING forgotten_memory_count`, forgotten, accountID, ref).Scan(&count)
		if err != nil {
			return nil, "", 0, err
		}
	}
	return deleted, outboxID, uint32(count.Int64), nil
}

func (s *Service) DeleteSession(ctx context.Context, req *runtimev1.DeleteSessionRequest) (*runtimev1.DeleteSessionResponse, error) {
	decision, err := s.authorize(ctx, localappop.OperationAgentSessionDelete)
	if err != nil {
		return nil, err
	}
	if req == nil || strings.TrimSpace(req.GetWorkSessionRef()) == "" || !req.GetConfirmed() {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	ref := strings.TrimSpace(req.GetWorkSessionRef())
	// Load live OR durable 'deleting' session so retries after crash/Cognition error converge cleanly!
	existing, err := s.store.GetSessionIncludingDeleting(ctx, decision.AccountID, ref)
	if errors.Is(err, errSessionNotFound) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
	}
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	if !readerCanAccessSession(decision, existing.Record) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
	}

	deletedRow, outboxID, forgottenCount, err := s.completeSessionDeletion(ctx, decision.AccountID, existing)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}

	return &runtimev1.DeleteSessionResponse{
		WorkSessionRef:       ref,
		Deleted:              true,
		BodyPurgePending:     deletedRow.Record.GetBodyPurgePending(),
		OutboxId:             outboxID,
		ForgottenMemoryCount: forgottenCount,
	}, nil
}

func (s *Service) WatchSessionOverview(req *runtimev1.WatchSessionOverviewRequest, stream grpc.ServerStreamingServer[runtimev1.SessionOverviewDelta]) error {
	ctx := stream.Context()
	decision, err := s.authorize(ctx, localappop.OperationAgentSessionOverviewWatch)
	if err != nil {
		return err
	}
	agentFilter := strings.TrimSpace(req.GetAgentHandle())
	if agentFilter != "" {
		resolved, rErr := s.resolveAgentBinding(ctx, decision, agentFilter)
		if rErr != nil {
			return rErr
		}
		agentFilter = resolved
	}
	rows, _, _, err := s.store.ListSessions(ctx, decision.AccountID, agentFilter, req.GetIncludeArchived(), nil, "", "", visibilityForReader(decision), 200, "")
	if err != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	visibleSessions := make([]*runtimev1.WorkSessionRecord, 0, len(rows))
	for _, r := range rows {
		visibleSessions = append(visibleSessions, r.Record)
	}
	allAtt, _ := s.store.ListPendingAttention(ctx, decision.AccountID, s.now().UTC())
	var visibleAtt []*runtimev1.PendingAttentionRecord
	for _, a := range allAtt {
		if readerCanAccessAttention(decision, a) {
			visibleAtt = append(visibleAtt, a)
		}
	}
	_, activePCCarrierAppID, carrierOnline, _ := s.store.FindActiveCarrier(ctx, decision.AccountID, DefaultPCNamespace, s.now().UTC())

	sub := &overviewSubscriber{
		accountID: decision.AccountID,
		decision:  decision,
		agentRef:  agentFilter,
		seq:       1,
		ch:        make(chan *runtimev1.SessionOverviewDelta, 32),
	}
	s.mu.Lock()
	s.overviewSubscribers[sub] = struct{}{}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.overviewSubscribers, sub)
		s.mu.Unlock()
	}()

	if err := stream.Send(&runtimev1.SessionOverviewDelta{
		OverviewSeq:          1,
		FullBaseline:         true,
		UpsertedSessions:     visibleSessions,
		AttentionItems:       visibleAtt,
		CarrierOnline:        carrierOnline,
		ActivePcCarrierAppId: activePCCarrierAppID,
	}); err != nil {
		return fmt.Errorf("send overview baseline: %w", err)
	}

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-decision.SessionInvalidated:
			return grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
		case delta, ok := <-sub.ch:
			if !ok {
				return nil
			}
			if err := stream.Send(delta); err != nil {
				return err
			}
		}
	}
}

func (s *Service) SubscribeBrainSessionEvents(req *runtimev1.SubscribeBrainSessionEventsRequest, stream grpc.ServerStreamingServer[runtimev1.BrainSessionEventEnvelope]) error {
	ctx := stream.Context()
	decision, err := s.authorize(ctx, localappop.OperationAgentSessionBrainEventsSubscribe)
	if err != nil {
		return err
	}
	if req == nil || strings.TrimSpace(req.GetWorkSessionRef()) == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	ref := strings.TrimSpace(req.GetWorkSessionRef())
	sess, err := s.store.GetSession(ctx, decision.AccountID, ref)
	if errors.Is(err, errSessionNotFound) {
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
	}
	if err != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	if !readerCanAccessSession(decision, sess.Record) {
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
	}

	sub := &brainEventSubscriber{ch: make(chan *runtimev1.BrainSessionEventEnvelope, 64)}
	s.mu.Lock()
	if s.brainEventSubscribers[ref] == nil {
		s.brainEventSubscribers[ref] = make(map[*brainEventSubscriber]struct{})
	}
	s.brainEventSubscribers[ref][sub] = struct{}{}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.brainEventSubscribers[ref], sub)
		if len(s.brainEventSubscribers[ref]) == 0 {
			delete(s.brainEventSubscribers, ref)
		}
		s.mu.Unlock()
	}()

	if err := stream.SendHeader(nil); err != nil {
		return err
	}
	backlog, err := s.store.ListBrainEvents(ctx, ref, req.GetAfterSeq(), 0, 200)
	if err != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	lastSeq := req.GetAfterSeq()
	for _, ev := range backlog {
		if err := stream.Send(ev); err != nil {
			return err
		}
		if ev.GetSeq() > lastSeq {
			lastSeq = ev.GetSeq()
		}
	}

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-decision.SessionInvalidated:
			return grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
		case ev, ok := <-sub.ch:
			if !ok {
				return nil
			}
			// Ephemeral streaming deltas (Seq == 0) are never persisted and must
			// pass through; only deduplicate persisted events (Seq > 0).
			if ev.GetSeq() > 0 && ev.GetSeq() <= lastSeq {
				continue
			}
			if err := stream.Send(ev); err != nil {
				return err
			}
			if ev.GetSeq() > lastSeq {
				lastSeq = ev.GetSeq()
			}
		}
	}
}

func (s *Service) StopBrainSessionTurn(ctx context.Context, req *runtimev1.StopBrainSessionTurnRequest) (*runtimev1.StopBrainSessionTurnResponse, error) {
	decision, err := s.authorize(ctx, localappop.OperationAgentSessionBrainTurnStop)
	if err != nil {
		return nil, err
	}
	if req == nil || strings.TrimSpace(req.GetWorkSessionRef()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	ref := strings.TrimSpace(req.GetWorkSessionRef())
	sess, err := s.store.GetSession(ctx, decision.AccountID, ref)
	if errors.Is(err, errSessionNotFound) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
	}
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	if !readerCanAccessSession(decision, sess.Record) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
	}
	stopped := s.cancelBrainTurnExpected(ref, req.GetExpectedTurnRef())
	return &runtimev1.StopBrainSessionTurnResponse{
		WorkSessionRef: ref,
		Stopped:        stopped,
	}, nil
}

func isLikelyAlarmReplyText(raw string) bool {
	lower := strings.ToLower(strings.TrimSpace(raw))
	if lower == "" || len(lower) > 160 {
		return false
	}
	for _, kw := range []string{"reminder", "alarm", "snooze", "提醒", "闹钟", "推迟", "延后", "取消提醒"} {
		if strings.Contains(lower, kw) {
			return true
		}
	}
	return false
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if trimmed := strings.TrimSpace(v); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
