package memoryv1

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
)

type Capability string

const (
	CapabilityFTSIndex    Capability = "fts_index"
	CapabilityTextEmbed   Capability = "text.embed"
	CapabilityVectorIndex Capability = "vector_index"
)

type PipelineName string

const (
	PipelineRememberBaseline PipelineName = "remember.baseline"
	PipelineRecallFTS        PipelineName = "recall.fts"
	PipelineRecallEmbedding  PipelineName = "recall.embedding"
	PipelineForgetExact      PipelineName = "forget.exact"
)

type PipelineDescriptor struct {
	Name         PipelineName
	Operation    string
	Requirements []Capability
}

type CapabilitySnapshot struct {
	ConfigRevision uint64
	Available      []Capability
}

type V1Router struct {
	descriptors []PipelineDescriptor
}

func NewV1Router() V1Router {
	return V1Router{descriptors: []PipelineDescriptor{
		{Name: PipelineRememberBaseline, Operation: "remember"},
		{Name: PipelineRecallFTS, Operation: "recall", Requirements: []Capability{CapabilityFTSIndex}},
		{Name: PipelineRecallEmbedding, Operation: "recall", Requirements: []Capability{CapabilityTextEmbed, CapabilityVectorIndex}},
		{Name: PipelineForgetExact, Operation: "forget"},
	}}
}

func (r V1Router) Descriptors() []PipelineDescriptor {
	result := make([]PipelineDescriptor, len(r.descriptors))
	copy(result, r.descriptors)
	for index := range result {
		result[index].Requirements = append([]Capability(nil), result[index].Requirements...)
	}
	return result
}

// @nimi-authority: rule.nimi.cognition.memory.r009
// @nimi-authority: rule.nimi.cognition.memory.r010
func (r V1Router) SelectRecall(ctx context.Context, core *Core, bankRef string, snapshot CapabilitySnapshot) (PipelineDescriptor, Outcome, error) {
	if core == nil || !validOpaqueRef(bankRef) || !validCapabilitySnapshot(snapshot) {
		return PipelineDescriptor{}, OutcomeInvalid, contractError(OutcomeInvalid, "recall_route_input")
	}
	version, readiness, err := core.derivedReadiness(ctx, bankRef)
	if err != nil {
		return PipelineDescriptor{}, OutcomeUnavailable, err
	}
	_ = version
	available := capabilitySet(snapshot.Available)
	if available[CapabilityTextEmbed] && available[CapabilityVectorIndex] && readiness["embedding"] == "ready" {
		return descriptorByName(r.descriptors, PipelineRecallEmbedding), OutcomeReady, nil
	}
	if available[CapabilityFTSIndex] && readiness["fts"] == "ready" {
		return descriptorByName(r.descriptors, PipelineRecallFTS), OutcomeReady, nil
	}
	if readiness["embedding"] == "building" || readiness["fts"] == "building" || len(readiness) == 0 {
		return PipelineDescriptor{}, OutcomePending, contractError(OutcomeUnavailable, "recall_index_building")
	}
	return PipelineDescriptor{}, OutcomeUnavailable, contractError(OutcomeUnavailable, "recall_pipeline_unavailable")
}

type RememberPipeline interface {
	Descriptor() PipelineDescriptor
	Revision() string
	Plan(CommitRequest) (MutationPlan, error)
}

type BaselineRemember struct{}

func (BaselineRemember) Descriptor() PipelineDescriptor {
	return PipelineDescriptor{Name: PipelineRememberBaseline, Operation: "remember"}
}

func (BaselineRemember) Revision() string { return "baseline-1" }

func (BaselineRemember) Plan(request CommitRequest) (MutationPlan, error) {
	switch request.Fact.Kind {
	case EventKindCorrection:
		fact := request.Fact.Correction
		if fact == nil {
			return MutationPlan{}, contractError(OutcomeInvalid, "correction_fact")
		}
		return MutationPlan{Outcome: OutcomeAdmitted, Mutations: []MemoryMutation{{Kind: MutationCorrection, TargetMemoryRef: fact.TargetMemoryRef, Content: fact.CorrectedContent, EpistemicStatus: EpistemicExplicit, OccurredAt: request.CommittedAt, SourceExplanation: "Committed user correction"}}}, nil
	case EventKindRelationship:
		fact := request.Fact.Relationship
		if fact == nil || forbiddenMemoryContent(fact.BoundedFact) {
			return MutationPlan{Outcome: OutcomeRejected}, nil
		}
		return MutationPlan{Outcome: OutcomeAdmitted, Mutations: []MemoryMutation{{Kind: MutationRemember, Content: fact.BoundedFact, EpistemicStatus: EpistemicExplicit, OccurredAt: request.CommittedAt, SourceExplanation: "Committed relationship event"}}}, nil
	case EventKindActivity:
		fact := request.Fact.Activity
		if fact == nil || fact.BoundedOutcome == "" || forbiddenMemoryContent(fact.BoundedOutcome) {
			return MutationPlan{Outcome: OutcomeRejected}, nil
		}
		content := strings.TrimSpace(string(fact.State) + ": " + fact.BoundedOutcome)
		return MutationPlan{Outcome: OutcomeAdmitted, Mutations: []MemoryMutation{{Kind: MutationRemember, Content: content, EpistemicStatus: EpistemicInferred, OccurredAt: request.CommittedAt, SourceExplanation: "Committed activity terminal"}}}, nil
	case EventKindMessage:
		fact := request.Fact.Message
		if fact == nil || fact.Actor != ActorUser {
			return MutationPlan{Outcome: OutcomeNoEffect}, nil
		}
		text := committedMessageText(fact)
		if text == "" {
			return MutationPlan{Outcome: OutcomeNoEffect}, nil
		}
		if forbiddenMemoryContent(text) {
			return MutationPlan{Outcome: OutcomeRejected}, nil
		}
		if !baselineLongTermCue(text) {
			return MutationPlan{Outcome: OutcomeNoEffect}, nil
		}
		return MutationPlan{Outcome: OutcomeAdmitted, Mutations: []MemoryMutation{{Kind: MutationRemember, Content: text, EpistemicStatus: EpistemicExplicit, OccurredAt: request.CommittedAt, SourceExplanation: "Committed user message"}}}, nil
	case EventKindTurnTerminal:
		return MutationPlan{Outcome: OutcomeNoEffect}, nil
	default:
		return MutationPlan{}, contractError(OutcomeUnsupported, "event_kind")
	}
}

func (c *Core) ExecuteRemember(ctx context.Context, operationID string) (DecisionResult, error) {
	return c.executeRememberWithPipeline(ctx, operationID, BaselineRemember{})
}

func (c *Core) executeRememberWithPipeline(ctx context.Context, operationID string, pipeline RememberPipeline) (DecisionResult, error) {
	if pipeline == nil || pipeline.Descriptor().Name == "" || pipeline.Descriptor().Operation != "remember" || pipeline.Revision() == "" {
		return DecisionResult{Outcome: OutcomeInvalid}, contractError(OutcomeInvalid, "remember_pipeline")
	}
	if prior, ok, err := c.terminalDecision(ctx, operationID); err != nil {
		return DecisionResult{Outcome: OutcomeUnavailable}, err
	} else if ok {
		return prior, nil
	}
	request, err := c.loadCustody(ctx, operationID)
	if err != nil {
		return DecisionResult{Outcome: errorOutcome(err)}, err
	}
	if _, err := c.bindRoute(ctx, routeBindingRequest{OperationID: operationID, OperationKind: "remember", BankRef: request.BankRef, Pipeline: pipeline.Descriptor().Name, AlgorithmRevision: pipeline.Revision(), Snapshot: CapabilitySnapshot{Available: []Capability{}}}); err != nil {
		return DecisionResult{Outcome: errorOutcome(err)}, err
	}
	if _, err := c.MarkProcessing(ctx, operationID); err != nil {
		return DecisionResult{Outcome: errorOutcome(err)}, err
	}
	plan, err := pipeline.Plan(request)
	if err != nil {
		return DecisionResult{Outcome: errorOutcome(err)}, err
	}
	result, err := c.CommitDecision(ctx, operationID, plan)
	if err != nil {
		return result, err
	}
	if err := c.FinalizeTerminal(ctx, operationID); err != nil {
		return result, err
	}
	if result.Outcome == OutcomeAdmitted {
		if err := c.RebuildFTS(ctx, request.BankRef); err != nil {
			return result, fmt.Errorf("execute remember: rebuild fts: %w", err)
		}
	}
	return result, nil
}

func (c *Core) loadCustody(ctx context.Context, operationID string) (CommitRequest, error) {
	var payload []byte
	if err := c.db.QueryRowContext(ctx, `SELECT payload FROM memory_receipts WHERE operation_id = ?`, operationID).Scan(&payload); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return CommitRequest{}, contractError(OutcomeInvalid, "unknown_operation")
		}
		return CommitRequest{}, fmt.Errorf("load remember custody: %w", err)
	}
	if len(payload) == 0 {
		return CommitRequest{}, contractError(OutcomeConflict, "payload_compacted")
	}
	var request CommitRequest
	if err := json.Unmarshal(payload, &request); err != nil {
		return CommitRequest{}, contractError(OutcomeFailed, "custody_payload")
	}
	return request, nil
}

func (c *Core) terminalDecision(ctx context.Context, operationID string) (DecisionResult, bool, error) {
	var outcome Outcome
	var raw []byte
	err := c.db.QueryRowContext(ctx, `SELECT outcome, result_json FROM memory_operations WHERE operation_id = ? AND operation_kind = 'commit'`, operationID).Scan(&outcome, &raw)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return DecisionResult{}, false, contractError(OutcomeInvalid, "unknown_operation")
		}
		return DecisionResult{}, false, fmt.Errorf("load terminal decision: %w", err)
	}
	if !outcome.TerminalRemember() {
		return DecisionResult{}, false, nil
	}
	var result DecisionResult
	if len(raw) == 0 || json.Unmarshal(raw, &result) != nil {
		return DecisionResult{}, false, contractError(OutcomeFailed, "stored_result")
	}
	return result, true, nil
}

func committedMessageText(fact *MessageFact) string {
	var parts []string
	for _, part := range fact.Parts {
		if part.Kind == "text" || part.Kind == "transcription" {
			if text := strings.TrimSpace(part.Text); text != "" {
				parts = append(parts, text)
			}
		}
	}
	return strings.Join(parts, "\n")
}

func baselineLongTermCue(text string) bool {
	normalized := strings.ToLower(text)
	for _, cue := range []string{"i prefer", "i like", "my favorite", "please remember", "remember that", "我喜欢", "我偏好", "请记住", "记住我"} {
		if strings.Contains(normalized, cue) {
			return true
		}
	}
	return false
}

func descriptorByName(descriptors []PipelineDescriptor, name PipelineName) PipelineDescriptor {
	for _, descriptor := range descriptors {
		if descriptor.Name == name {
			return descriptor
		}
	}
	return PipelineDescriptor{}
}

func validCapabilitySnapshot(snapshot CapabilitySnapshot) bool {
	seen := map[Capability]struct{}{}
	for _, capability := range snapshot.Available {
		switch capability {
		case CapabilityFTSIndex, CapabilityTextEmbed, CapabilityVectorIndex:
		default:
			return false
		}
		if _, duplicate := seen[capability]; duplicate {
			return false
		}
		seen[capability] = struct{}{}
	}
	return true
}

func capabilitySet(capabilities []Capability) map[Capability]bool {
	result := make(map[Capability]bool, len(capabilities))
	for _, capability := range capabilities {
		result[capability] = true
	}
	return result
}

func canonicalCapabilities(snapshot CapabilitySnapshot) []Capability {
	result := append([]Capability(nil), snapshot.Available...)
	sort.Slice(result, func(i, j int) bool { return result[i] < result[j] })
	return result
}
