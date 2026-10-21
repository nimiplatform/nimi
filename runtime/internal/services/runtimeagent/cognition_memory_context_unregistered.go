package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
)

const publicChatPreTurnMemoryLimit = 8

func publicChatPreTurnMemoryQuery(messages []publicChatMessagePayload) string {
	parts := make([]string, 0, len(messages))
	for _, message := range messages {
		role := strings.TrimSpace(message.Role)
		if role != "user" && role != publicChatInternalFollowUpInstructionRole {
			continue
		}
		if content := strings.TrimSpace(message.Content); content != "" {
			parts = append(parts, content)
		}
	}
	return strings.Join(parts, "\n")
}

func (r publicChatRuntime) loadPublicChatCognitionMemoryInputs(ctx context.Context, session publicChatAnchorState, req publicChatTurnRequestPayload) ([]agentTurnMemoryInput, cognitionmemory.MemoryReadSet, error) {
	if r.svc == nil {
		return nil, cognitionmemory.MemoryReadSet{}, nil
	}
	inputs, read, err := r.svc.loadLocalAgentCognitionMemoryInputsWithReadSet(ctx, session.LocalAgentRef, publicChatPreTurnMemoryQuery(req.Messages))
	if err != nil {
		if r.svc.logger != nil {
			r.svc.logger.Warn("optional Conversation Memory projection unavailable", "local_agent_ref", session.LocalAgentRef, "error", err)
		}
		return nil, cognitionmemory.MemoryReadSet{}, nil
	}
	return inputs, read, nil
}

func (s *Service) loadLocalAgentCognitionMemoryInputs(ctx context.Context, localAgentRef, query string) ([]agentTurnMemoryInput, error) {
	inputs, _, err := s.loadLocalAgentCognitionMemoryInputsWithReadSet(ctx, localAgentRef, query)
	return inputs, err
}

func (s *Service) loadLocalAgentCognitionMemoryInputsWithReadSet(ctx context.Context, localAgentRef, query string) ([]agentTurnMemoryInput, cognitionmemory.MemoryReadSet, error) {
	if s == nil || s.cognitionMemoryFacade == nil || strings.TrimSpace(query) == "" {
		return nil, cognitionmemory.MemoryReadSet{}, nil
	}
	result, err := s.cognitionMemoryFacade.Recall(ctx, cognitionmemory.RecallIntent{NoModelWork: true, LocalAgentRef: localAgentRef, Query: query, Limit: publicChatPreTurnMemoryLimit, IncludeRecentLife: true})
	if err != nil {
		if s.logger != nil {
			s.logger.Warn("optional Cognition Memory Recall unavailable", "local_agent_ref", localAgentRef, "outcome", result.Outcome, "error", err)
		}
		return nil, cognitionmemory.MemoryReadSet{}, nil
	}
	if result.Outcome != memoryv1.OutcomeReady {
		return nil, cognitionmemory.MemoryReadSet{}, nil
	}
	inputs, err := publicChatCognitionMemoryInputs(result.Hits)
	return inputs, result.ReadSet, err
}

// publicChatCognitionMemoryInputs is the direct-test composition seam used
// before WP9 swaps the active pre-turn loader. It carries complete owner hits
// into the existing whole-item Memory lane without creating Runtime Memory.
func publicChatCognitionMemoryInputs(hits []memoryv1.Memory) ([]agentTurnMemoryInput, error) {
	result := make([]agentTurnMemoryInput, 0, len(hits))
	seen := make(map[string]struct{}, len(hits))
	for index, hit := range hits {
		if strings.TrimSpace(hit.MemoryRef) == "" || strings.TrimSpace(hit.BankRef) == "" || strings.TrimSpace(hit.Content) == "" || strings.TrimSpace(hit.EventRef) == "" || hit.Lifecycle != memoryv1.LifecycleCurrent {
			return nil, fmt.Errorf("Cognition Memory hit is incomplete or non-current")
		}
		if _, duplicate := seen[hit.MemoryRef]; duplicate {
			return nil, fmt.Errorf("duplicate Cognition Memory hit")
		}
		seen[hit.MemoryRef] = struct{}{}
		epistemic := string(hit.EpistemicStatus)
		if epistemic != string(memoryv1.EpistemicExplicit) && epistemic != string(memoryv1.EpistemicInferred) && epistemic != string(memoryv1.EpistemicConsolidated) {
			return nil, fmt.Errorf("Cognition Memory hit epistemic status is invalid")
		}
		text := agentTurnContextTypedContent("Cognition-owned advisory Memory; current request, committed Conversation, and canonical source remain authoritative",
			agentTurnContextTextField{Name: "epistemic_status", Values: []string{epistemic}},
			agentTurnContextTextField{Name: "source_explanation", Values: []string{hit.SourceExplanation}},
			agentTurnContextTextField{Name: "occurred_at", Values: []string{hit.OccurredAt.UTC().Format(time.RFC3339Nano)}},
			agentTurnContextTextField{Name: "updated_at", Values: []string{hit.UpdatedAt.UTC().Format(time.RFC3339Nano)}},
			agentTurnContextTextField{Name: "subject_ref", Values: cognitionMemoryTypedRefValues(hit.Subjects)},
			agentTurnContextTextField{Name: "source_ref", Values: cognitionMemoryTypedRefValues(hit.Sources)},
			agentTurnContextTextField{Name: "memory", Values: []string{hit.Content}},
		)
		result = append(result, agentTurnMemoryInput{
			KnownAt:       hit.UpdatedAt,
			MemoryID:      hit.MemoryRef,
			Scope:         "agent_private",
			ProvenanceRef: hit.EventRef,
			Text:          text,
			RelevanceRank: int64(len(hits) - index),
		})
	}
	return result, nil
}

func cognitionMemoryTypedRefValues(refs []memoryv1.TypedRef) []string {
	values := make([]string, 0, len(refs))
	for _, ref := range refs {
		kind := strings.TrimSpace(ref.Kind)
		value := strings.TrimSpace(ref.Value)
		if kind != "" && value != "" {
			values = append(values, kind+":"+value)
		}
	}
	return values
}
