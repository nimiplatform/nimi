package runtimeagent

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	publicChatPreTurnMemoryLimit  = 8
	publicChatPreTurnMemoryHeader = "Runtime recalled memory context:"
)

func (r publicChatRuntime) assemblePublicChatSystemPrompt(
	ctx context.Context,
	session publicChatAnchorState,
	req publicChatTurnRequestPayload,
) (string, error) {
	base := strings.TrimSpace(session.SystemPrompt)
	resp, err := r.queryPublicChatPreTurnMemory(ctx, session, req)
	if err != nil {
		return "", err
	}
	addendum := publicChatPreTurnMemoryPrompt(resp)
	if addendum == "" {
		return base, nil
	}
	if base == "" {
		return addendum, nil
	}
	return base + "\n\n" + addendum, nil
}

func (r publicChatRuntime) queryPublicChatPreTurnMemory(
	ctx context.Context,
	session publicChatAnchorState,
	req publicChatTurnRequestPayload,
) (*runtimev1.QueryAgentMemoryResponse, error) {
	if r.svc == nil {
		return nil, nil
	}
	if strings.TrimSpace(session.SubjectUserID) == "" {
		return nil, status.Error(codes.FailedPrecondition, "public chat pre-turn memory requires subject_user_id")
	}
	return r.svc.QueryAgentMemory(ctx, &runtimev1.QueryAgentMemoryRequest{
		Context: &runtimev1.AgentRequestContext{
			AppId:         strings.TrimSpace(session.CallerAppID),
			SubjectUserId: strings.TrimSpace(session.SubjectUserID),
			OwnerUserId:   strings.TrimSpace(session.OwnerUserID),
			RealmAgentId:  strings.TrimSpace(session.RealmAgentID),
			LocalAgentRef: strings.TrimSpace(session.LocalAgentRef),
		},
		AgentId:          strings.TrimSpace(session.AgentID),
		Query:            publicChatPreTurnMemoryQuery(req.Messages),
		Limit:            publicChatPreTurnMemoryLimit,
		CanonicalClasses: []runtimev1.MemoryCanonicalClass{runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC},
	})
}

func publicChatPreTurnMemoryQuery(messages []publicChatMessagePayload) string {
	parts := make([]string, 0, len(messages))
	for _, message := range messages {
		if strings.TrimSpace(message.Role) != "user" {
			continue
		}
		if content := strings.TrimSpace(message.Content); content != "" {
			parts = append(parts, content)
		}
	}
	return strings.Join(parts, "\n")
}

func publicChatPreTurnMemoryPrompt(resp *runtimev1.QueryAgentMemoryResponse) string {
	if resp == nil || len(resp.GetMemories()) == 0 {
		return ""
	}
	lines := make([]string, 0, len(resp.GetMemories())+1)
	lines = append(lines, publicChatPreTurnMemoryHeader)
	for _, view := range resp.GetMemories() {
		text := publicChatMemoryViewPromptText(view)
		if text == "" {
			continue
		}
		record := view.GetRecord()
		memoryID := strings.TrimSpace(record.GetMemoryId())
		if memoryID == "" {
			memoryID = "memory"
		}
		lines = append(lines, "- ["+memoryID+" "+view.GetCanonicalClass().String()+"] "+text)
	}
	if len(lines) == 1 {
		return ""
	}
	return strings.Join(lines, "\n")
}

func publicChatMemoryViewPromptText(view *runtimev1.CanonicalMemoryView) string {
	if view == nil || view.GetRecord() == nil {
		return ""
	}
	record := view.GetRecord()
	switch payload := record.GetPayload().(type) {
	case *runtimev1.MemoryRecord_Observational:
		return compactPublicChatMemoryText(payload.Observational.GetObservation())
	case *runtimev1.MemoryRecord_Semantic:
		parts := []string{
			payload.Semantic.GetSubject(),
			payload.Semantic.GetPredicate(),
			payload.Semantic.GetObject(),
		}
		return compactPublicChatMemoryText(strings.Join(parts, " "))
	case *runtimev1.MemoryRecord_Episodic:
		return compactPublicChatMemoryText(payload.Episodic.GetSummary())
	default:
		return ""
	}
}

func compactPublicChatMemoryText(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}
