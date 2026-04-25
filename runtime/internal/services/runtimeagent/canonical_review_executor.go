package runtimeagent

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"google.golang.org/protobuf/encoding/protojson"
)

const (
	canonicalReviewPromptMaxTokens = 1024
	canonicalReviewExecutorAppID   = "runtime.agent.internal.canonical_review"
	canonicalReviewExecutorModelID = "local/default"
)

type canonicalReviewScenarioExecutor interface {
	ExecuteScenario(context.Context, *runtimev1.ExecuteScenarioRequest) (*runtimev1.ExecuteScenarioResponse, error)
}

type aiBackedCanonicalReviewExecutor struct {
	ai canonicalReviewScenarioExecutor
}

type canonicalReviewExecutorProjection struct {
	Summary    string
	TokensUsed *int64
	Narratives []canonicalReviewNarrativeProjection
	Truths     []canonicalReviewTruthProjection
	Relations  []canonicalReviewRelationProjection
}

type canonicalReviewNarrativeProjection struct {
	NarrativeID     string
	Topic           string
	Content         string
	SourceVersion   string
	Status          string
	SourceMemoryIDs []string
}

type canonicalReviewTruthProjection struct {
	TruthID           string
	Dimension         string
	NormalizedKey     string
	Statement         string
	Confidence        float64
	SourceCount       *int32
	ReviewCount       *int32
	FirstReviewAt     string
	LastReviewAt      string
	Status            string
	SupersedesTruthID string
	SourceMemoryIDs   []string
}

type canonicalReviewRelationProjection struct {
	RelationID   string
	SourceID     string
	TargetID     string
	RelationType string
	Confidence   float64
}

type canonicalReviewPromptTruth struct {
	TruthID         string   `json:"truth_id"`
	Dimension       string   `json:"dimension"`
	NormalizedKey   string   `json:"normalized_key"`
	Statement       string   `json:"statement"`
	Confidence      float64  `json:"confidence"`
	Status          string   `json:"status"`
	SourceMemoryIDs []string `json:"source_memory_ids"`
}

type canonicalReviewPromptCluster struct {
	RecordIDs []string          `json:"record_ids"`
	Records   []json.RawMessage `json:"records"`
}

func NewAIBackedCanonicalReviewExecutor(ai canonicalReviewScenarioExecutor) CanonicalReviewExecutor {
	if ai == nil {
		return rejectingCanonicalReviewExecutor{}
	}
	return &aiBackedCanonicalReviewExecutor{ai: ai}
}

func (e *aiBackedCanonicalReviewExecutor) ExecuteCanonicalReview(ctx context.Context, req *CanonicalReviewExecutorRequest) (*CanonicalReviewExecutorResult, error) {
	if e == nil || e.ai == nil {
		return nil, fmt.Errorf("runtime internal canonical review executor unavailable or not admitted")
	}
	execReq, err := buildCanonicalReviewScenarioRequest(req)
	if err != nil {
		return nil, err
	}
	resp, err := e.ai.ExecuteScenario(ctx, execReq)
	if err != nil {
		return nil, err
	}
	text := strings.TrimSpace(resp.GetOutput().GetTextGenerate().GetText())
	return decodeCanonicalReviewExecutorResult(text, responseTokensUsed(resp), req)
}

func buildCanonicalReviewScenarioRequest(req *CanonicalReviewExecutorRequest) (*runtimev1.ExecuteScenarioRequest, error) {
	if req == nil || req.Agent == nil || req.State == nil || req.Bank == nil {
		return nil, fmt.Errorf("canonical review requires committed agent, state, and bank")
	}
	systemPrompt, userPrompt, err := canonicalReviewPrompts(req)
	if err != nil {
		return nil, err
	}
	subjectUserID := strings.TrimSpace(req.State.GetActiveUserId())
	if subjectUserID == "" {
		subjectUserID = strings.TrimSpace(req.Agent.GetAgentId())
	}
	return &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         canonicalReviewExecutorAppID,
			SubjectUserId: subjectUserID,
			ModelId:       canonicalReviewExecutorModelID,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     10_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					SystemPrompt: systemPrompt,
					MaxTokens:    canonicalReviewPromptMaxTokens,
					Input: []*runtimev1.ChatMessage{
						{
							Role:    "user",
							Content: userPrompt,
						},
					},
				},
			},
		},
	}, nil
}

func canonicalReviewPrompts(req *CanonicalReviewExecutorRequest) (string, string, error) {
	marshal := protojson.MarshalOptions{
		UseProtoNames:   true,
		EmitUnpopulated: false,
	}
	agentRaw, err := marshal.Marshal(req.Agent)
	if err != nil {
		return "", "", fmt.Errorf("marshal canonical review agent: %w", err)
	}
	stateRaw, err := marshal.Marshal(req.State)
	if err != nil {
		return "", "", fmt.Errorf("marshal canonical review state: %w", err)
	}
	bankRaw, err := marshal.Marshal(req.Bank)
	if err != nil {
		return "", "", fmt.Errorf("marshal canonical review bank: %w", err)
	}
	truthsRaw, err := json.Marshal(canonicalReviewPromptTruths(req.ExistingTruths))
	if err != nil {
		return "", "", fmt.Errorf("marshal canonical review truths: %w", err)
	}
	clustersRaw, err := json.Marshal(canonicalReviewPromptClusters(marshal, req.Clusters))
	if err != nil {
		return "", "", fmt.Errorf("marshal canonical review clusters: %w", err)
	}
	leftoversRaw, err := json.Marshal(canonicalReviewPromptRecords(marshal, req.Leftovers))
	if err != nil {
		return "", "", fmt.Errorf("marshal canonical review leftovers: %w", err)
	}
	systemPrompt := strings.TrimSpace(`You are the runtime-private canonical review executor for Nimi Agent Core.
Return APML only. The first non-whitespace characters must be <canonical-review>.
Allowed top-level shape:
<canonical-review>
  <summary>...</summary>
  <tokens-used>integer</tokens-used> optional
  <narratives>...</narratives>
  <truths>...</truths>
  <relations>...</relations>
</canonical-review>

Rules:
- Do not emit markdown, prose, code fences, JSON, or comments.
- Do not emit any tag outside summary, tokens-used, narratives, truths, and relations.
- narratives may only summarize provided topic clusters.
- Every narrative must cite source-memory-id tags from exactly one cluster and must cite at least 2 distinct records.
- Do not create a narrative from leftovers alone.
- truths may only use dimensions relational, cognitive, value, or procedural.
- Every truth source-memory-id must come from the provided review inputs.
- relations are optional and limited to causal, emotional, or thematic.
- Every relation source-id and target-id must come from the provided review inputs.
- Relations must not be self-edges.
- relation confidence must be between 0.80 and 1.0.
- confidence must be between 0 and 1.
- source-count, if present, must be a non-negative integer.
- review-count, if present, must be a non-negative integer.
- first-review-at and last-review-at, if present, must be RFC3339 timestamps.
- If no narratives, truths, or relations should be emitted, emit the empty container tag.

Narrative format:
<narrative id="..." topic="..." source-version="..." status="...">
  <content>...</content>
  repeated <source-memory-id>...</source-memory-id>
</narrative>

Truth format:
<truth id="..." dimension="relational|cognitive|value|procedural" normalized-key="..." confidence="0.91" source-count="2" review-count="1" first-review-at="" last-review-at="" status="" supersedes-truth-id="">
  <statement>...</statement>
  repeated <source-memory-id>...</source-memory-id>
</truth>

Relation format:
<relation id="..." source-id="..." target-id="..." relation-type="causal|emotional|thematic" confidence="0.90"/>
`)
	userPrompt := strings.TrimSpace(fmt.Sprintf(`Committed agent truth:
agent=%s

Committed state projection:
state=%s

Target review bank:
bank=%s

Checkpoint basis:
checkpoint_basis=%q

Currently admitted truths:
truths=%s

Topic clusters eligible for narrative generation:
clusters=%s

Leftover review inputs (may inform truths, but do not create standalone narratives from them):
leftovers=%s
`, string(agentRaw), string(stateRaw), string(bankRaw), strings.TrimSpace(req.CheckpointBasis), string(truthsRaw), string(clustersRaw), string(leftoversRaw)))
	return systemPrompt, userPrompt, nil
}

func decodeCanonicalReviewExecutorResult(raw string, fallbackTokens int64, req *CanonicalReviewExecutorRequest) (*CanonicalReviewExecutorResult, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, fmt.Errorf("canonical review executor returned empty output")
	}
	var apmlPayload canonicalReviewExecutorAPML
	if err := decodeStrictAPML(raw, "canonical-review", &apmlPayload); err != nil {
		return nil, fmt.Errorf("canonical review executor output invalid: %w", err)
	}
	payload := canonicalReviewExecutorProjection{
		Summary:    apmlPayload.Summary,
		TokensUsed: apmlPayload.TokensUsed,
		Narratives: make([]canonicalReviewNarrativeProjection, 0, len(apmlPayload.Narratives)),
		Truths:     make([]canonicalReviewTruthProjection, 0, len(apmlPayload.Truths)),
		Relations:  make([]canonicalReviewRelationProjection, 0, len(apmlPayload.Relations)),
	}
	for _, narrative := range apmlPayload.Narratives {
		payload.Narratives = append(payload.Narratives, canonicalReviewNarrativeProjection{
			NarrativeID:     narrative.NarrativeID,
			Topic:           narrative.Topic,
			Content:         narrative.Content,
			SourceVersion:   narrative.SourceVersion,
			Status:          narrative.Status,
			SourceMemoryIDs: append([]string(nil), narrative.SourceMemoryIDs...),
		})
	}
	for _, truth := range apmlPayload.Truths {
		payload.Truths = append(payload.Truths, canonicalReviewTruthProjection{
			TruthID:           truth.TruthID,
			Dimension:         truth.Dimension,
			NormalizedKey:     truth.NormalizedKey,
			Statement:         truth.Statement,
			Confidence:        truth.Confidence,
			SourceCount:       truth.SourceCount,
			ReviewCount:       truth.ReviewCount,
			FirstReviewAt:     truth.FirstReviewAt,
			LastReviewAt:      truth.LastReviewAt,
			Status:            truth.Status,
			SupersedesTruthID: truth.SupersedesTruthID,
			SourceMemoryIDs:   append([]string(nil), truth.SourceMemoryIDs...),
		})
	}
	for _, relation := range apmlPayload.Relations {
		payload.Relations = append(payload.Relations, canonicalReviewRelationProjection{
			RelationID:   relation.RelationID,
			SourceID:     relation.SourceID,
			TargetID:     relation.TargetID,
			RelationType: relation.RelationType,
			Confidence:   relation.Confidence,
		})
	}
	result := &CanonicalReviewExecutorResult{
		Outcomes: memoryservice.CanonicalReviewOutcomes{
			Summary: strings.TrimSpace(payload.Summary),
		},
		TokensUsed: fallbackTokens,
	}
	if payload.TokensUsed != nil {
		if *payload.TokensUsed < 0 {
			return nil, fmt.Errorf("canonical review executor tokens_used must be non-negative")
		}
		if result.TokensUsed <= 0 {
			result.TokensUsed = *payload.TokensUsed
		}
	}
	clustersByRecordID := make(map[string]int)
	allowedRecordIDs := make(map[string]struct{})
	for clusterIdx, cluster := range req.Clusters {
		for _, recordID := range cluster.RecordIDs {
			recordID = strings.TrimSpace(recordID)
			if recordID == "" {
				continue
			}
			clustersByRecordID[recordID] = clusterIdx
			allowedRecordIDs[recordID] = struct{}{}
		}
	}
	for _, record := range req.Leftovers {
		recordID := strings.TrimSpace(record.GetMemoryId())
		if recordID != "" {
			allowedRecordIDs[recordID] = struct{}{}
		}
	}
	result.Outcomes.Narratives = make([]memoryservice.NarrativeCandidate, 0, len(payload.Narratives))
	for _, narrative := range payload.Narratives {
		item, err := decodeCanonicalReviewNarrative(narrative, clustersByRecordID)
		if err != nil {
			return nil, err
		}
		result.Outcomes.Narratives = append(result.Outcomes.Narratives, item)
	}
	result.Outcomes.Truths = make([]memoryservice.TruthCandidate, 0, len(payload.Truths))
	for _, truth := range payload.Truths {
		item, err := decodeCanonicalReviewTruth(truth, allowedRecordIDs)
		if err != nil {
			return nil, err
		}
		result.Outcomes.Truths = append(result.Outcomes.Truths, item)
	}
	result.Outcomes.Relations = make([]memoryservice.RelationCandidate, 0, len(payload.Relations))
	for _, relation := range payload.Relations {
		item, err := decodeCanonicalReviewRelation(relation, req.Bank, allowedRecordIDs)
		if err != nil {
			return nil, err
		}
		result.Outcomes.Relations = append(result.Outcomes.Relations, item)
	}
	return result, nil
}

func decodeCanonicalReviewNarrative(input canonicalReviewNarrativeProjection, clustersByRecordID map[string]int) (memoryservice.NarrativeCandidate, error) {
	narrativeID := strings.TrimSpace(input.NarrativeID)
	if narrativeID == "" {
		return memoryservice.NarrativeCandidate{}, fmt.Errorf("canonical review narrative_id is required")
	}
	topic := strings.TrimSpace(input.Topic)
	if topic == "" {
		return memoryservice.NarrativeCandidate{}, fmt.Errorf("canonical review narrative %s topic is required", narrativeID)
	}
	content := strings.TrimSpace(input.Content)
	if content == "" {
		return memoryservice.NarrativeCandidate{}, fmt.Errorf("canonical review narrative %s content is required", narrativeID)
	}
	sourceIDs := uniqueNonEmptyStrings(input.SourceMemoryIDs)
	if len(sourceIDs) < 2 {
		return memoryservice.NarrativeCandidate{}, fmt.Errorf("canonical review narrative %s must cite at least 2 distinct source_memory_ids", narrativeID)
	}
	clusterIndex := -1
	for _, recordID := range sourceIDs {
		idx, ok := clustersByRecordID[recordID]
		if !ok {
			return memoryservice.NarrativeCandidate{}, fmt.Errorf("canonical review narrative %s source_memory_id %s is not in any eligible cluster", narrativeID, recordID)
		}
		if clusterIndex == -1 {
			clusterIndex = idx
			continue
		}
		if idx != clusterIndex {
			return memoryservice.NarrativeCandidate{}, fmt.Errorf("canonical review narrative %s must not mix records from multiple clusters", narrativeID)
		}
	}
	return memoryservice.NarrativeCandidate{
		NarrativeID:     narrativeID,
		Topic:           topic,
		Content:         content,
		SourceVersion:   strings.TrimSpace(input.SourceVersion),
		Status:          strings.TrimSpace(input.Status),
		SourceMemoryIDs: sourceIDs,
	}, nil
}

func decodeCanonicalReviewTruth(input canonicalReviewTruthProjection, allowedRecordIDs map[string]struct{}) (memoryservice.TruthCandidate, error) {
	truthID := strings.TrimSpace(input.TruthID)
	if truthID == "" {
		return memoryservice.TruthCandidate{}, fmt.Errorf("canonical review truth_id is required")
	}
	dimension := strings.ToLower(strings.TrimSpace(input.Dimension))
	if _, ok := allowedCanonicalTruthDimensions[dimension]; !ok {
		return memoryservice.TruthCandidate{}, fmt.Errorf("canonical review truth %s dimension must be relational, cognitive, value, or procedural", truthID)
	}
	normalizedKey := strings.TrimSpace(input.NormalizedKey)
	if normalizedKey == "" {
		return memoryservice.TruthCandidate{}, fmt.Errorf("canonical review truth %s normalized_key is required", truthID)
	}
	statement := strings.TrimSpace(input.Statement)
	if statement == "" {
		return memoryservice.TruthCandidate{}, fmt.Errorf("canonical review truth %s statement is required", truthID)
	}
	if input.Confidence < 0 || input.Confidence > 1 {
		return memoryservice.TruthCandidate{}, fmt.Errorf("canonical review truth %s confidence must be between 0 and 1", truthID)
	}
	sourceIDs := uniqueNonEmptyStrings(input.SourceMemoryIDs)
	if len(sourceIDs) == 0 {
		return memoryservice.TruthCandidate{}, fmt.Errorf("canonical review truth %s must cite at least 1 source_memory_id", truthID)
	}
	for _, recordID := range sourceIDs {
		if _, ok := allowedRecordIDs[recordID]; !ok {
			return memoryservice.TruthCandidate{}, fmt.Errorf("canonical review truth %s source_memory_id %s is not part of the review input set", truthID, recordID)
		}
	}
	if input.SourceCount != nil {
		if *input.SourceCount < 0 {
			return memoryservice.TruthCandidate{}, fmt.Errorf("canonical review truth %s source_count must be non-negative", truthID)
		}
		if *input.SourceCount > 0 && int(*input.SourceCount) != len(sourceIDs) {
			return memoryservice.TruthCandidate{}, fmt.Errorf("canonical review truth %s source_count must match unique source_memory_ids", truthID)
		}
	}
	if input.ReviewCount != nil && *input.ReviewCount < 0 {
		return memoryservice.TruthCandidate{}, fmt.Errorf("canonical review truth %s review_count must be non-negative", truthID)
	}
	firstReviewAt := strings.TrimSpace(input.FirstReviewAt)
	if firstReviewAt != "" {
		if _, err := parseRFC3339Value(firstReviewAt); err != nil {
			return memoryservice.TruthCandidate{}, fmt.Errorf("canonical review truth %s first_review_at invalid: %w", truthID, err)
		}
	}
	lastReviewAt := strings.TrimSpace(input.LastReviewAt)
	if lastReviewAt != "" {
		if _, err := parseRFC3339Value(lastReviewAt); err != nil {
			return memoryservice.TruthCandidate{}, fmt.Errorf("canonical review truth %s last_review_at invalid: %w", truthID, err)
		}
	}
	output := memoryservice.TruthCandidate{
		TruthID:           truthID,
		Dimension:         dimension,
		NormalizedKey:     normalizedKey,
		Statement:         statement,
		Confidence:        input.Confidence,
		FirstReviewAt:     firstReviewAt,
		LastReviewAt:      lastReviewAt,
		Status:            strings.TrimSpace(input.Status),
		SupersedesTruthID: strings.TrimSpace(input.SupersedesTruthID),
		SourceMemoryIDs:   sourceIDs,
	}
	if input.SourceCount != nil {
		output.SourceCount = *input.SourceCount
	}
	if input.ReviewCount != nil {
		output.ReviewCount = *input.ReviewCount
	}
	return output, nil
}

func decodeCanonicalReviewRelation(input canonicalReviewRelationProjection, bank *runtimev1.MemoryBankLocator, allowedRecordIDs map[string]struct{}) (memoryservice.RelationCandidate, error) {
	sourceID := strings.TrimSpace(input.SourceID)
	targetID := strings.TrimSpace(input.TargetID)
	if sourceID == "" || targetID == "" {
		return memoryservice.RelationCandidate{}, fmt.Errorf("canonical review relation source_id and target_id are required")
	}
	if sourceID == targetID {
		return memoryservice.RelationCandidate{}, fmt.Errorf("canonical review relation must not be a self-edge")
	}
	if _, ok := allowedRecordIDs[sourceID]; !ok {
		return memoryservice.RelationCandidate{}, fmt.Errorf("canonical review relation source_id %s is not part of the review input set", sourceID)
	}
	if _, ok := allowedRecordIDs[targetID]; !ok {
		return memoryservice.RelationCandidate{}, fmt.Errorf("canonical review relation target_id %s is not part of the review input set", targetID)
	}
	relationType := strings.ToLower(strings.TrimSpace(input.RelationType))
	if _, ok := allowedCanonicalReviewRelationTypes[relationType]; !ok {
		return memoryservice.RelationCandidate{}, fmt.Errorf("canonical review relation_type must be causal, emotional, or thematic")
	}
	if input.Confidence < memoryservice.CanonicalReviewRelationConfidenceFloor() || input.Confidence > 1 {
		return memoryservice.RelationCandidate{}, fmt.Errorf("canonical review relation confidence must be between %.2f and 1.0", memoryservice.CanonicalReviewRelationConfidenceFloor())
	}
	locatorKeyValue := ""
	if bank != nil {
		locatorKeyValue = memoryservice.LocatorKey(bank)
	}
	relationID := strings.TrimSpace(input.RelationID)
	if relationID == "" {
		relationID = memoryservice.CanonicalReviewRelationID(locatorKeyValue, sourceID, targetID, relationType)
	}
	return memoryservice.RelationCandidate{
		RelationID:   relationID,
		SourceID:     sourceID,
		TargetID:     targetID,
		RelationType: relationType,
		Confidence:   input.Confidence,
		CreatedBy:    memoryservice.CanonicalReviewRelationCreatedBy(),
	}, nil
}

func canonicalReviewPromptTruths(input []memoryservice.TruthCandidate) []canonicalReviewPromptTruth {
	out := make([]canonicalReviewPromptTruth, 0, len(input))
	for _, item := range input {
		out = append(out, canonicalReviewPromptTruth{
			TruthID:         strings.TrimSpace(item.TruthID),
			Dimension:       strings.TrimSpace(item.Dimension),
			NormalizedKey:   strings.TrimSpace(item.NormalizedKey),
			Statement:       strings.TrimSpace(item.Statement),
			Confidence:      item.Confidence,
			Status:          strings.TrimSpace(item.Status),
			SourceMemoryIDs: append([]string(nil), item.SourceMemoryIDs...),
		})
	}
	return out
}

func canonicalReviewPromptClusters(marshal protojson.MarshalOptions, input []memoryservice.ReviewTopicCluster) []canonicalReviewPromptCluster {
	out := make([]canonicalReviewPromptCluster, 0, len(input))
	for _, cluster := range input {
		out = append(out, canonicalReviewPromptCluster{
			RecordIDs: append([]string(nil), cluster.RecordIDs...),
			Records:   canonicalReviewPromptRecords(marshal, cluster.Records),
		})
	}
	return out
}

func canonicalReviewPromptRecords(marshal protojson.MarshalOptions, input []*runtimev1.MemoryRecord) []json.RawMessage {
	out := make([]json.RawMessage, 0, len(input))
	for _, record := range input {
		if record == nil {
			continue
		}
		raw, err := marshal.Marshal(record)
		if err != nil {
			continue
		}
		out = append(out, json.RawMessage(raw))
	}
	return out
}

func uniqueNonEmptyStrings(input []string) []string {
	if len(input) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(input))
	out := make([]string, 0, len(input))
	for _, value := range input {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func parseRFC3339Value(value string) (string, error) {
	if _, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return value, nil
	}
	return "", fmt.Errorf("must be RFC3339")
}

var allowedCanonicalTruthDimensions = map[string]struct{}{
	"relational": {},
	"cognitive":  {},
	"value":      {},
	"procedural": {},
}

var allowedCanonicalReviewRelationTypes = map[string]struct{}{
	"causal":    {},
	"emotional": {},
	"thematic":  {},
}
