package agentsession

import (
	"context"
	"crypto/sha256"
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
	// Core first-party Home and Harness are authorized for full account overview.
	if decision.AppID == "nimi.desktop" || decision.AppID == CorePCBodyAppID {
		return true
	}
	// Zhiyu sees its own companion & app-scoped sessions.
	if decision.AppID == "nimi.zhiyu" {
		return rec.GetSessionKind() == "companion" ||
			rec.GetIsPrimaryCompanion() ||
			rec.GetPublisherScopeKey() == "app:nimi.zhiyu"
	}
	// Ordinary Apps only see sessions bound to their own publisher_scope_key.
	return rec.GetPublisherScopeKey() != "" && rec.GetPublisherScopeKey() == "app:"+decision.AppID
}

func readerCanAccessAttention(decision accountservice.LocalAppCallerDecision, att *runtimev1.PendingAttentionRecord) bool {
	if att == nil {
		return false
	}
	if decision.AppID == "nimi.desktop" || decision.AppID == CorePCBodyAppID {
		return true
	}
	return att.GetTrustScope() == "app:"+decision.AppID
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

func looksLikePCWorkIntent(req *runtimev1.RouteAndSubmitInputRequest) bool {
	if strings.TrimSpace(req.GetWorkspaceRoot()) != "" || req.GetWorkspaceWritable() {
		return true
	}
	if strings.TrimSpace(req.GetHandoffBriefText()) != "" {
		return true
	}
	if strings.TrimSpace(req.GetEntrySurface()) == "harness" || strings.TrimSpace(req.GetEntrySurface()) == "pc_work" {
		return true
	}
	return false
}

// RouteAndSubmitInput implements the Zero-Cloud-Model Three-Layer Router:
//   - L1: explicit work_session_ref / selected_candidate_ref / handoff / promotion
//   - L2: deterministic rules (external channel isolation, workspace binding, general_inbox 2h/10-turn sliding window, 4th-turn promotion)
//   - L3: local SQLite FTS5 Chinese overlapping-bigram BM25 (run strictly outside write tx!)
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
	agentBinding := strings.TrimSpace(req.GetAgentHandle())
	requestID := strings.TrimSpace(req.GetRequestId())

	// Fast read-only idempotency check before routing.
	if existing, err := s.store.LookupSubmission(ctx, decision.AccountID, requestID); err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	} else if existing != nil {
		return existing, nil
	}

	var (
		targetRow             *sessionRow
		routeReason           string
		heuristicDowngraded   bool
		promotedTurns         int32
		handoffHistoryPayload []map[string]any
	)

	// --- Layer 1: Explicit target or candidate selection ---
	explicitRef := strings.TrimSpace(req.GetExplicitWorkSessionRef())
	if explicitRef == "" {
		explicitRef = strings.TrimSpace(req.GetSelectedCandidateRef())
	}
	if explicitRef != "" {
		sess, err := s.store.GetSession(ctx, decision.AccountID, explicitRef)
		if errors.Is(err, errSessionNotFound) || !readerCanAccessSession(decision, sess.Record) {
			return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
		}
		if err != nil {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
		}
		targetRow = sess
		if strings.TrimSpace(req.GetSelectedCandidateRef()) != "" {
			routeReason = "l1_candidate_confirmed"
		} else {
			routeReason = "l1_explicit_session_ref"
		}
	}

	// --- Layer 2A: External channel isolation (never shares with pc_work / companion) ---
	entrySurface := strings.TrimSpace(req.GetEntrySurface())
	if targetRow == nil && (strings.HasPrefix(entrySurface, "channel:") || strings.EqualFold(strings.TrimSpace(req.GetTrustTierHint()), "external")) {
		scopeKey := entrySurface
		if scopeKey == "" {
			scopeKey = "channel:external:" + decision.AppID
		}
		existing, err := s.store.FindActiveExternalChannelSession(ctx, decision.AccountID, agentBinding, scopeKey)
		if err != nil {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
		}
		if existing != nil {
			targetRow = existing
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

	// --- Layer 2B: Card promotion / Zhiyu editable brief handoff ---
	if targetRow == nil && strings.TrimSpace(req.GetCardSourceSessionRef()) != "" {
		sourceRef := strings.TrimSpace(req.GetCardSourceSessionRef())
		src, err := s.store.GetSession(ctx, decision.AccountID, sourceRef)
		if err != nil || !readerCanAccessSession(decision, src.Record) {
			return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
		}
		maxSeq := req.GetCardSourceMaxSeq()
		events, err := s.store.ListBrainEvents(ctx, sourceRef, 0, maxSeq, 64)
		if err != nil {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
		}
		// Keep at most 6 committed turns (user/assistant pairs up to 12 events) in handoff_history.
		start := 0
		maxEvents := maxHandoffHistoryTurns * 2
		if len(events) > maxEvents {
			start = len(events) - maxEvents
		}
		for _, ev := range events[start:] {
			var parsed map[string]any
			_ = json.Unmarshal([]byte(ev.GetPayloadJson()), &parsed)
			handoffHistoryPayload = append(handoffHistoryPayload, map[string]any{
				"seq":       ev.GetSeq(),
				"eventType": ev.GetEventType(),
				"payload":   parsed,
				"createdAt": ev.GetCreatedAt(),
			})
		}
		promotedTurns = int32((len(handoffHistoryPayload) + 1) / 2)
		if promotedTurns > maxHandoffHistoryTurns {
			promotedTurns = maxHandoffHistoryTurns
		}
		permMode := "plan-readonly"
		if req.GetWorkspaceWritable() && strings.TrimSpace(req.GetWorkspaceRoot()) != "" {
			permMode = "workspace-edit"
		}
		targetRow = &sessionRow{
			AccountID:    decision.AccountID,
			TopicSummary: deriveSessionTitle(req.GetText(), req.GetWorkspaceRoot()),
			Record: &runtimev1.WorkSessionRecord{
				WorkSessionRef:       newID("ws"),
				AgentBinding:         agentBinding,
				SessionKind:          "pc_work",
				OwnerBodyKind:        DefaultPCNamespace,
				PublisherScopeKey:    "app:" + decision.AppID,
				ForkedFromSessionRef: sourceRef,
				ForkedAtSeq:          maxSeq,
				Title:                deriveSessionTitle(req.GetText(), req.GetWorkspaceRoot()),
				Status:               "active",
				TrustTier:            "trusted",
				WorkspaceRoot:        strings.TrimSpace(req.GetWorkspaceRoot()),
				PermissionMode:       permMode,
				LatestReceiptJson:    "{}",
			},
		}
		routeReason = "l2_light_qa_promoted_to_pc_work"
	}

	if targetRow == nil && strings.TrimSpace(req.GetHandoffBriefText()) != "" {
		permMode := "plan-readonly"
		if req.GetWorkspaceWritable() && strings.TrimSpace(req.GetWorkspaceRoot()) != "" {
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
				PublisherScopeKey: "app:" + decision.AppID,
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
	if targetRow == nil && strings.TrimSpace(req.GetWorkspaceRoot()) != "" {
		wsRoot := strings.TrimSpace(req.GetWorkspaceRoot())
		existing, err := s.store.FindActiveSessionByWorkspace(ctx, decision.AccountID, agentBinding, wsRoot)
		if err != nil {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
		}
		if existing != nil && readerCanAccessSession(decision, existing.Record) {
			targetRow = existing
			routeReason = "l2_workspace_root_match"
		} else {
			permMode := "plan-readonly"
			if req.GetWorkspaceWritable() {
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
					PublisherScopeKey: "app:" + decision.AppID,
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

	// --- Layer 3: Local FTS5 Chinese Bigram BM25 (strictly OUTSIDE write transaction!) ---
	if targetRow == nil && strings.TrimSpace(req.GetText()) != "" && entrySurface != "new_session" {
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
			// Pure read-only preflight: NEVER write runtime_session_submission or outbox!
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
			routeReason = "l3_fts5_confident_continue"
			// Heuristic auto-continuation onto an active workspace-edit session MUST downgrade
			// permission_mode to plan-readonly until explicitly confirmed!
			if targetRow.Record.GetSessionKind() == "pc_work" && targetRow.Record.GetPermissionMode() == "workspace-edit" {
				targetRow.Record.PermissionMode = "plan-readonly"
				heuristicDowngraded = true
			}
		}
	}

	// --- Layer 2D: Fallback to general_inbox (2h / 10-turn sliding window, 4th-turn auto-promotion) or new pc_work ---
	if targetRow == nil {
		if looksLikePCWorkIntent(req) {
			permMode := "plan-readonly"
			if req.GetWorkspaceWritable() && strings.TrimSpace(req.GetWorkspaceRoot()) != "" {
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
					PublisherScopeKey: "app:" + decision.AppID,
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
			inbox, err := s.store.FindActiveGeneralInbox(ctx, decision.AccountID, agentBinding, now)
			if err != nil {
				return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
			}
			if inbox != nil && inbox.InboxTurnCount+1 >= lightQAPromoteTurnNumber {
				// 4th turn in light Q&A automatically promotes to a fresh pc_work session with <= 6 committed turns!
				events, _ := s.store.ListBrainEvents(ctx, inbox.Record.GetWorkSessionRef(), 0, inbox.Record.GetHeadSeq(), 64)
				start := 0
				maxEvents := maxHandoffHistoryTurns * 2
				if len(events) > maxEvents {
					start = len(events) - maxEvents
				}
				for _, ev := range events[start:] {
					var parsed map[string]any
					_ = json.Unmarshal([]byte(ev.GetPayloadJson()), &parsed)
					handoffHistoryPayload = append(handoffHistoryPayload, map[string]any{
						"seq":       ev.GetSeq(),
						"eventType": ev.GetEventType(),
						"payload":   parsed,
						"createdAt": ev.GetCreatedAt(),
					})
				}
				promotedTurns = int32((len(handoffHistoryPayload) + 1) / 2)
				if promotedTurns > maxHandoffHistoryTurns {
					promotedTurns = maxHandoffHistoryTurns
				}
				targetRow = &sessionRow{
					AccountID:    decision.AccountID,
					TopicSummary: deriveSessionTitle(req.GetText(), ""),
					Record: &runtimev1.WorkSessionRecord{
						WorkSessionRef:       newID("ws"),
						AgentBinding:         agentBinding,
						SessionKind:          "pc_work",
						OwnerBodyKind:        DefaultPCNamespace,
						PublisherScopeKey:    "app:" + decision.AppID,
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
				inbox.InboxTurnCount++
				targetRow = inbox
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
						PublisherScopeKey: "app:" + decision.AppID,
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

	// Build either Body outbox envelope or Brain event envelope.
	commitIn := routedCommitInput{
		AccountID:          decision.AccountID,
		ClientSubmissionID: requestID,
		Session:            targetRow,
		Outcome:            runtimev1.RouteAndSubmitOutcome_ROUTE_AND_SUBMIT_OUTCOME_ACCEPTED,
		RouteReason:        routeReason,
		PromotedTurns:      promotedTurns,
		Now:                now,
	}

	if targetRow.Record.GetOwnerBodyKind() != "" && targetRow.Record.GetOwnerBodyKind() != "brain" {
		ns := targetRow.Record.GetOwnerBodyKind()
		deviceID, online, err := s.store.FindActiveCarrierDevice(ctx, decision.AccountID, ns, now)
		if err != nil {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
		}
		if deviceID == "" {
			deviceID = targetRow.Record.GetDeviceId()
		}
		if deviceID == "" {
			deviceID = "local-default"
		}
		targetRow.Record.DeviceId = deviceID
		if !online {
			commitIn.Outcome = runtimev1.RouteAndSubmitOutcome_ROUTE_AND_SUBMIT_OUTCOME_DEFERRED_BODY_OFFLINE
		}
		payloadMap := map[string]any{
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
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	if !deduplicated {
		if commitIn.OutboxEnvelope != nil {
			s.notifyOutboxSubscribers(decision.AccountID, commitIn.OutboxEnvelope.GetDeviceId(), commitIn.OutboxEnvelope.GetCapabilityNamespace(), commitIn.OutboxEnvelope)
		}
		if commitIn.BrainEvent != nil {
			s.notifyBrainEventSubscribers(commitIn.BrainEvent)
			// Trigger optional brain turn executor (for general_inbox inline light Q&A) asynchronously.
			s.maybeStartBrainTurn(decision.AccountID, targetRow.Record, req.GetText(), requestID)
		}
		s.notifyOverviewChange(decision.AccountID, []*runtimev1.WorkSessionRecord{targetRow.Record}, nil)
	}
	return resp, nil
}

func (s *Service) SplitOrRedirectInput(ctx context.Context, req *runtimev1.SplitOrRedirectInputRequest) (*runtimev1.SplitOrRedirectInputResponse, error) {
	decision, err := s.authorize(ctx, localappop.OperationAgentSessionRouteSubmit)
	if err != nil {
		return nil, err
	}
	if req == nil || strings.TrimSpace(req.GetSourceWorkSessionRef()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	src, err := s.store.GetSession(ctx, decision.AccountID, strings.TrimSpace(req.GetSourceWorkSessionRef()))
	if errors.Is(err, errSessionNotFound) || !readerCanAccessSession(decision, src.Record) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
	}
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	now := s.now().UTC()
	sourceSeq := req.GetSourceEventSeq()
	if sourceSeq <= 0 {
		sourceSeq = src.Record.GetHeadSeq()
	}
	events, err := s.store.ListBrainEvents(ctx, src.Record.GetWorkSessionRef(), 0, sourceSeq, 64)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	movedText := ""
	if len(events) > 0 {
		last := events[len(events)-1]
		var payload map[string]any
		_ = json.Unmarshal([]byte(last.GetPayloadJson()), &payload)
		if t, ok := payload["text"].(string); ok {
			movedText = t
		}
	}

	targetKind := strings.TrimSpace(req.GetTargetSessionKind())
	if targetKind == "" {
		targetKind = "pc_work"
	}
	ownerBodyKind := DefaultPCNamespace
	if targetKind != "pc_work" {
		ownerBodyKind = "brain"
	}
	title := strings.TrimSpace(req.GetTitle())
	if title == "" {
		title = deriveSessionTitle(movedText, req.GetWorkspaceRoot())
	}
	permMode := "plan-readonly"
	if req.GetWorkspaceWritable() && strings.TrimSpace(req.GetWorkspaceRoot()) != "" {
		permMode = "workspace-edit"
	}
	targetRow := &sessionRow{
		AccountID:    decision.AccountID,
		TopicSummary: title,
		Record: &runtimev1.WorkSessionRecord{
			WorkSessionRef:       newID("ws"),
			AgentBinding:         src.Record.GetAgentBinding(),
			SessionKind:          targetKind,
			OwnerBodyKind:        ownerBodyKind,
			PublisherScopeKey:    "app:" + decision.AppID,
			ForkedFromSessionRef: src.Record.GetWorkSessionRef(),
			ForkedAtSeq:          sourceSeq,
			Title:                title,
			Status:               "active",
			TrustTier:            "trusted",
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
		AccountID:          decision.AccountID,
		ClientSubmissionID: reqID,
		Session:            targetRow,
		Outcome:            runtimev1.RouteAndSubmitOutcome_ROUTE_AND_SUBMIT_OUTCOME_ACCEPTED,
		RouteReason:        "split_or_redirect",
		Now:                now,
	}
	if ownerBodyKind != "brain" {
		deviceID, _, _ := s.store.FindActiveCarrierDevice(ctx, decision.AccountID, ownerBodyKind, now)
		if deviceID == "" {
			deviceID = "local-default"
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
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	if !deduplicated {
		if sourceSeq > 0 {
			_ = s.store.MarkBrainEventMovedTo(ctx, src.Record.GetWorkSessionRef(), sourceSeq, resp.GetResolvedWorkSessionRef())
		}
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
	if errors.Is(err, errSessionNotFound) || !readerCanAccessSession(decision, sess.Record) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
	}
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
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
	rows, err := s.store.ListSessions(
		ctx,
		decision.AccountID,
		req.GetAgentHandle(),
		req.GetIncludeArchived(),
		req.GetSessionKinds(),
		req.GetStatusFilter(),
		req.GetSearchQuery(),
	)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	var items []*runtimev1.WorkSessionRecord
	for _, r := range rows {
		if readerCanAccessSession(decision, r.Record) {
			items = append(items, r.Record)
		}
	}
	total := uint32(len(items))
	if pageSize := int(req.GetPageSize()); pageSize > 0 && len(items) > pageSize {
		items = items[:pageSize]
	}
	return &runtimev1.ListSessionsResponse{
		Items:             items,
		TotalVisibleCount: total,
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
	existing, err := s.store.GetSession(ctx, decision.AccountID, strings.TrimSpace(req.GetWorkSessionRef()))
	if errors.Is(err, errSessionNotFound) || !readerCanAccessSession(decision, existing.Record) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
	}
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	updated, err := s.store.UpdateSessionFields(ctx, decision.AccountID, req, s.now().UTC())
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	s.notifyOverviewChange(decision.AccountID, []*runtimev1.WorkSessionRecord{updated.Record}, nil)
	return &runtimev1.UpdateSessionResponse{WorkSessionRecord: updated.Record}, nil
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
	existing, err := s.store.GetSession(ctx, decision.AccountID, ref)
	if errors.Is(err, errSessionNotFound) || !readerCanAccessSession(decision, existing.Record) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
	}
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}

	// Step 1: Neutralize Cognition outbox & forget session-lineage memories BEFORE marking session deleted
	// (preventing asynchronous outbox replay from resurrecting deleted session memories!).
	var forgottenCount uint32
	if s.memoryCleanupHook != nil {
		n, cleanErr := s.memoryCleanupHook(ctx, decision.AccountID, existing.Record.GetAgentBinding(), ref)
		if cleanErr != nil {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
		}
		forgottenCount = n
	}

	// Step 2: Cancel any in-flight brain turn for this session.
	s.cancelBrainTurn(ref)

	// Step 3: Mark session deleted + enqueue PURGE_SESSION tombstone into runtime_body_outbox.
	deletedRow, purgeEnv, err := s.store.MarkSessionDeletedAndEnqueuePurge(ctx, decision.AccountID, ref, s.now().UTC())
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	outboxID := ""
	if purgeEnv != nil {
		outboxID = purgeEnv.GetOutboxId()
		s.notifyOutboxSubscribers(decision.AccountID, purgeEnv.GetDeviceId(), purgeEnv.GetCapabilityNamespace(), purgeEnv)
	}
	s.notifyOverviewChange(decision.AccountID, nil, []string{ref})

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
	rows, err := s.store.ListSessions(ctx, decision.AccountID, req.GetAgentHandle(), req.GetIncludeArchived(), nil, "", "")
	if err != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	var visibleSessions []*runtimev1.WorkSessionRecord
	for _, r := range rows {
		if readerCanAccessSession(decision, r.Record) {
			visibleSessions = append(visibleSessions, r.Record)
		}
	}
	allAtt, _ := s.store.ListPendingAttention(ctx, decision.AccountID)
	var visibleAtt []*runtimev1.PendingAttentionRecord
	for _, a := range allAtt {
		if readerCanAccessAttention(decision, a) {
			visibleAtt = append(visibleAtt, a)
		}
	}
	_, carrierOnline, _ := s.store.FindActiveCarrierDevice(ctx, decision.AccountID, DefaultPCNamespace, s.now().UTC())

	sub := &overviewSubscriber{
		accountID: decision.AccountID,
		decision:  decision,
		agentRef:  strings.TrimSpace(req.GetAgentHandle()),
		ch:        make(chan *runtimev1.SessionOverviewDelta, 32),
	}
	s.mu.Lock()
	seq := s.overviewSeq
	s.overviewSubscribers[sub] = struct{}{}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.overviewSubscribers, sub)
		s.mu.Unlock()
	}()

	if err := stream.Send(&runtimev1.SessionOverviewDelta{
		OverviewSeq:      seq,
		FullBaseline:     true,
		UpsertedSessions: visibleSessions,
		AttentionItems:   visibleAtt,
		CarrierOnline:    carrierOnline,
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
	if errors.Is(err, errSessionNotFound) || !readerCanAccessSession(decision, sess.Record) {
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
	}
	if err != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
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
			if ev.GetSeq() <= lastSeq {
				continue
			}
			if err := stream.Send(ev); err != nil {
				return err
			}
			lastSeq = ev.GetSeq()
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
	if errors.Is(err, errSessionNotFound) || !readerCanAccessSession(decision, sess.Record) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
	}
	stopped := s.cancelBrainTurn(ref)
	return &runtimev1.StopBrainSessionTurnResponse{
		WorkSessionRef: ref,
		Stopped:        stopped,
	}, nil
}
