package runtimeagent

import (
	"context"
	"errors"
	"fmt"
	"math"
	"slices"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	cognitionservice "github.com/nimiplatform/nimi/runtime/internal/services/cognition"
)

func TestAgentTurnCognitionCandidatesUseIndependentWholeUnitBudget(t *testing.T) {
	input := agentTurnContextTestInput(t, "worldCharacter")
	unit := sourceCognitionTestPartition(t, agentTurnContextTestSnapshot(t, "worldCharacter")).CognitionUnits[0]
	input.Cognition = agentTurnCognitionInput{
		AdapterStatus: "ready", SelectionStatus: "ready", Generation: 1, CandidateCount: 1,
		Candidates: []agentTurnCognitionCandidateInput{{UnitID: unit.StableID, Category: unit.Category, SourcePath: unit.SourcePath, SourceRef: unit.SourceRef, Text: unit.Text, Priority: unit.Priority, Score: 0.9}},
	}
	compiled, err := compileAgentTurnContext(input)
	if err != nil {
		t.Fatal(err)
	}
	if compiled.Manifest.Cognition.AdapterStatus != "ready" || compiled.Manifest.Cognition.SelectionStatus != "ready" || compiled.Manifest.Cognition.IncludedUnitCount != 1 {
		t.Fatalf("Cognition manifest = %#v", compiled.Manifest.Cognition)
	}
	if !strings.Contains(agentTurnContextTestProviderText(compiled.ProviderPrompt), "lane=cognition_source") {
		t.Fatal("selected Cognition whole unit did not reach provider context")
	}

	input.Cognition.Candidates[0].Text = strings.Repeat("large-cognition-unit ", 400)
	compiled, err = compileAgentTurnContext(input)
	if err != nil {
		t.Fatal(err)
	}
	if compiled.Manifest.Cognition.AdapterStatus != "ready" || compiled.Manifest.Cognition.SelectionStatus != "no_result" || compiled.Manifest.Cognition.IncludedUnitCount != 0 || compiled.Manifest.Cognition.OmittedUnitCount != 1 {
		t.Fatalf("budget-filtered Cognition manifest = %#v", compiled.Manifest.Cognition)
	}
}

func TestSourcePartitionProjectsOptionalSectionAsTypedOmission(t *testing.T) {
	snapshot := agentTurnContextTestSnapshot(t, "personaCharacter")
	profile, err := decodeRealmSourceCompilerProfileV3(snapshot.Semantic.Source.Profile)
	if err != nil {
		t.Fatal(err)
	}
	profile.Psychology = nil
	raw, err := canonicalizeSourceMaterializationRealmV3(profile)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := decodeSourceMaterializationJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	snapshot.Semantic.Source.Profile, err = normalizeSourceMaterializationJSONValue(decoded)
	if err != nil {
		t.Fatal(err)
	}
	partition, err := projectLocalAgentSourcePartitionV1(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	for _, unit := range partition.CognitionUnits {
		if unit.StableID == "source.psychology" {
			t.Fatal("optional omission became an empty Cognition unit")
		}
	}
	for _, omission := range partition.Omissions {
		if omission.StableID == "source.psychology" {
			if omission.Category != "behavior_detail" || omission.SourcePath != "semanticPayload.canonicalSource.profile.psychology" || omission.OmissionReason != "optional_source_section_absent" || omission.SourceRef.RefID == "" {
				t.Fatalf("typed omission = %#v", omission)
			}
			return
		}
	}
	t.Fatal("typed psychology omission is absent")
}

func TestPersistedSourceSnapshotContainsOnlyCompactPartitionBinding(t *testing.T) {
	snapshot := agentTurnContextTestSnapshot(t, "worldCharacter")
	if snapshot.Partition.UnitCount == 0 || snapshot.Partition.PartitionHash == "" {
		t.Fatalf("partition binding = %#v", snapshot.Partition)
	}
	raw, err := encodeLocalAgentSourceSnapshotV2(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := decodeSourceMaterializationJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	root := decoded.(map[string]any)
	partition := root["partition"].(map[string]any)
	if _, exists := partition["cognitionUnits"]; exists {
		t.Fatal("Runtime persisted a parallel Cognition unit corpus")
	}
	if _, exists := partition["omissions"]; exists {
		t.Fatal("Runtime persisted Cognition omission bodies")
	}
}

func TestSourcePartitionCoverageIsExactlyIndexedOrTypedOmitted(t *testing.T) {
	for _, kind := range []string{"worldCharacter", "personaCharacter"} {
		snapshot := agentTurnContextTestSnapshot(t, kind)
		partition := sourceCognitionTestPartition(t, snapshot)
		paths := make(map[string]string)
		for _, unit := range partition.CognitionUnits {
			key := localAgentSourcePathIdentityV1(unit.SourceRef, unit.SourcePath)
			if previous, duplicate := paths[key]; duplicate {
				t.Fatalf("%s source path is multiply indexed: %s / %s", kind, previous, unit.StableID)
			}
			paths[key] = unit.StableID
		}
		for _, omission := range partition.Omissions {
			key := localAgentSourcePathIdentityV1(omission.SourceRef, omission.SourcePath)
			if previous, duplicate := paths[key]; duplicate {
				t.Fatalf("%s source path is both indexed and omitted: %s / %s", kind, previous, omission.StableID)
			}
			paths[key] = omission.StableID
		}
		if uint32(len(partition.CognitionUnits)) != snapshot.Partition.UnitCount || uint32(len(partition.Omissions)) != snapshot.Partition.OmissionCount || partition.PartitionHash != snapshot.Partition.PartitionHash {
			t.Fatalf("%s compact partition binding does not cover transient result", kind)
		}
	}
}

func TestSourcePartitionCategoriesFollowTypedSemanticsWithoutRelabeling(t *testing.T) {
	partition := sourceCognitionTestPartition(t, agentTurnContextTestSnapshot(t, "worldCharacter"))
	byID := make(map[string]string, len(partition.CognitionUnits))
	categories := make(map[string]struct{})
	for _, unit := range partition.CognitionUnits {
		byID[unit.StableID] = unit.Category
		categories[unit.Category] = struct{}{}
	}
	for stableID, category := range map[string]string{
		"source.psychology.drives":     "behavior_detail",
		"source.psychology.boundaries": "source_constraint_detail",
		"source.knowledge.topics":      "source_knowledge_detail",
		"source.knowledge.constraints": "source_constraint_detail",
		"source.assets":                "source_asset_detail",
	} {
		if byID[stableID] != category {
			t.Fatalf("category %s = %q, want %q", stableID, byID[stableID], category)
		}
	}
	for _, unit := range partition.CognitionUnits {
		if unit.Category == "work" || unit.Category == "preference" {
			t.Fatalf("generic source field was inferred as %q: %#v", unit.Category, unit)
		}
	}
	for _, category := range []string{"character_identity_detail", "behavior_detail", "speaking_interaction_detail", "biography_event", "relationship_detail", "source_knowledge_detail", "source_constraint_detail", "source_asset_detail", "dialogue_exemplar", "world_setting_detail", "world_fact", "world_entity", "world_system", "world_scene", "source_evidence"} {
		if _, exists := categories[category]; !exists {
			t.Fatalf("typed source category %q has no official-vector projection", category)
		}
	}
	work, err := normalizeSourceMaterializationJSONValue(map[string]any{"type": "work", "value": "Recorded work"})
	if err != nil {
		t.Fatal(err)
	}
	generic, err := normalizeSourceMaterializationJSONValue(map[string]any{"type": "fixture-fact", "value": true})
	if err != nil {
		t.Fatal(err)
	}
	if explicitLocalAgentFactCategoryV1(work, nil) != "work" || explicitLocalAgentFactCategoryV1(generic, nil) != "world_fact" {
		t.Fatal("explicit fact category mapping is not semantic")
	}
}

func TestSourceProjectorSeparatesLargeProvenanceFromBoundedSemanticText(t *testing.T) {
	makeRefs := func(count int) ([]string, []any) {
		refs := make([]string, count)
		raw := make([]any, count)
		for index := range refs {
			refs[index] = fmt.Sprintf("cbdb:OFFICE_CODES:11405:POSTING_DATA:row-%04d", index)
			raw[index] = refs[index]
		}
		return refs, raw
	}
	factRefs, rawFactRefs := makeRefs(973)
	fact, err := normalizeSourceMaterializationJSONValue(map[string]any{
		"factId": "fact-office-11405", "type": "office-posting", "label": "Recorded office", "value": "short semantic value",
		"confidence": "recorded", "sourceRefs": rawFactRefs,
	})
	if err != nil {
		t.Fatal(err)
	}
	fullFact, err := canonicalLocalAgentCognitionJSONTextV1(fact)
	if err != nil {
		t.Fatal(err)
	}
	text, projectedFactRefs, semanticPresent, err := splitLocalAgentCognitionProvenanceV1(fact)
	if err != nil || !semanticPresent {
		t.Fatalf("split fact = present=%v err=%v", semanticPresent, err)
	}
	if len([]byte(fullFact)) <= localAgentCognitionTextMaxBytes || len([]byte(text)) > localAgentCognitionTextMaxBytes || strings.Contains(text, "sourceRefs") || !slices.Equal(projectedFactRefs, factRefs) {
		t.Fatalf("fact projection lengths/full refs = full=%d semantic=%d refs=%d", len([]byte(fullFact)), len([]byte(text)), len(projectedFactRefs))
	}

	evidenceRefs, rawEvidenceRefs := makeRefs(616)
	evidence, err := normalizeSourceMaterializationJSONValue(map[string]any{"sourceRefs": rawEvidenceRefs, "completeness": "partial"})
	if err != nil {
		t.Fatal(err)
	}
	evidenceText, projectedEvidenceRefs, evidencePresent, err := splitLocalAgentCognitionProvenanceV1(evidence)
	if err != nil || !evidencePresent || evidenceText != `{"completeness":"partial"}` || !slices.Equal(projectedEvidenceRefs, evidenceRefs) {
		t.Fatalf("evidence projection = text=%q refs=%d present=%v err=%v", evidenceText, len(projectedEvidenceRefs), evidencePresent, err)
	}

	provenanceOnly, err := normalizeSourceMaterializationJSONValue(map[string]any{"sourceRefs": rawEvidenceRefs})
	if err != nil {
		t.Fatal(err)
	}
	partition := localAgentSourcePartitionV1{CognitionUnits: []localAgentCognitionSourceUnitV1{}, Omissions: []localAgentCognitionSourceOmissionV1{}}
	snapshot := agentTurnContextTestSnapshot(t, "worldCharacter")
	bound := snapshot.Semantic.DependencyClosure.BoundEntity
	if bound == nil {
		t.Fatal("world-character fixture has no bound entity")
	}
	ref := agentTurnContextItemSourceRef{Kind: "worldEntity", WorldID: bound.WorldID, RefID: bound.ID, SchemaVersion: bound.SchemaVersion, ContentHash: bound.ContentHash}
	if err := appendLocalAgentCognitionJSONWithProvenanceV1(&partition, map[string]localAgentCognitionSourceUnitV1{}, map[string]struct{}{}, "source.evidence.provenance-only", "source_evidence", "source.evidence", ref, provenanceOnly); err != nil {
		t.Fatal(err)
	}
	if len(partition.CognitionUnits) != 0 || len(partition.Omissions) != 1 || partition.Omissions[0].OmissionReason != "provenance_only" || !slices.Equal(partition.Omissions[0].ProvenanceRefs, evidenceRefs) {
		t.Fatalf("provenance-only evidence coverage = %#v", partition)
	}
}

func TestSourceProjectorOmitsOverBoundSemanticTextWithoutTruncation(t *testing.T) {
	snapshot := agentTurnContextTestSnapshot(t, "worldCharacter")
	ref := realmSourceCompilerSourceRefV3(snapshot)
	partition := localAgentSourcePartitionV1{CognitionUnits: []localAgentCognitionSourceUnitV1{}, Omissions: []localAgentCognitionSourceOmissionV1{}}
	overBound := strings.Repeat("x", localAgentCognitionTextMaxBytes+1)
	if err := appendLocalAgentCognitionUnitV1(&partition, map[string]localAgentCognitionSourceUnitV1{}, map[string]struct{}{}, localAgentCognitionSourceUnitV1{StableID: "over-bound", Category: "biography_event", SourcePath: "profile.narrative", SourceRef: ref, Text: overBound, ProvenanceRefs: []string{"realm:source"}}); err != nil {
		t.Fatal(err)
	}
	if len(partition.CognitionUnits) != 0 || len(partition.Omissions) != 1 || partition.Omissions[0].OmissionReason != "semantic_text_exceeds_ingestion_bound" || partition.Omissions[0].ProvenanceRefs[0] != "realm:source" {
		t.Fatalf("over-bound semantic item was truncated or lost: %#v", partition)
	}
	atBoundPartition := localAgentSourcePartitionV1{CognitionUnits: []localAgentCognitionSourceUnitV1{}, Omissions: []localAgentCognitionSourceOmissionV1{}}
	atBound := strings.Repeat("y", localAgentCognitionTextMaxBytes)
	if err := appendLocalAgentCognitionUnitV1(&atBoundPartition, map[string]localAgentCognitionSourceUnitV1{}, map[string]struct{}{}, localAgentCognitionSourceUnitV1{StableID: "at-bound", Category: "biography_event", SourcePath: "profile.narrative.boundary", SourceRef: ref, Text: atBound, ProvenanceRefs: []string{}}); err != nil {
		t.Fatal(err)
	}
	if len(atBoundPartition.CognitionUnits) != 1 || atBoundPartition.CognitionUnits[0].Text != atBound || len(atBoundPartition.Omissions) != 0 {
		t.Fatalf("at-bound semantic item changed: %#v", atBoundPartition)
	}
	if err := validateLocalAgentCognitionProvenanceRefsV1(nil); err == nil {
		t.Fatal("nil provenance refs were accepted")
	}
	if err := validateLocalAgentCognitionProvenanceRefsV1([]string{"duplicate", "duplicate"}); err == nil {
		t.Fatal("duplicate provenance refs were accepted")
	}
	if err := validateLocalAgentCognitionProvenanceRefsV1([]string{" not-exact"}); err == nil {
		t.Fatal("non-exact provenance ref was accepted")
	}
}

func TestPublicChatSourceCognitionQueryIncludesBoundedRuntimeOwnedSignals(t *testing.T) {
	snapshot := agentTurnContextTestSnapshot(t, "worldCharacter")
	source := sourceCognitionTestTurnView(t, snapshot)
	relationshipRef := "relationship-query-canary"
	source.Partition.Lorebook.Character.RelationshipPostures = []sourceMaterializationCharacterRelationshipPostureV1{{
		TargetRef: "entity-query-canary", RelationshipRef: &relationshipRef, Statement: "trusted posture query canary",
	}}
	query := publicChatSourceCognitionQuery(
		source,
		agentTurnCurrentUserInput{
			Text:  "current-turn-query-canary " + strings.Repeat("current context ", 180),
			Media: []agentTurnContextMedia{{MediaID: "private-media-id", Kind: "image", MIMEType: "image/png", ArtifactRef: "private-artifact-ref"}},
		},
		[]agentTurnTranscriptPairInput{{TurnID: "turn-query-canary", Sequence: 1, UserText: "recent-user-query-canary", AssistantText: "recent-assistant-query-canary"}},
		&agentTurnConversationSummaryInput{Status: "ready", Revision: 2, Text: "summary-topic-query-canary", RouteCorrelation: strings.Repeat("a", 64)},
		[]agentTurnRelationshipInput{{RelationshipID: "runtime-relationship-query-canary", Summary: "runtime-relationship-summary-query-canary"}},
		publicChatAvailableActions{ImageGenerate: publicChatImageActionAvailable},
	)
	for _, required := range []string{
		"current-turn-query-canary",
		"summary-topic-query-canary",
		"entity-query-canary",
		"relationship-query-canary",
		"trusted posture query canary",
		"runtime-relationship-summary-query-canary",
		"recent-user-query-canary",
		"recent-assistant-query-canary",
		"tool=image.generate state=available",
		"media=image mime=image/png",
	} {
		if !strings.Contains(query, required) {
			t.Fatalf("bounded Cognition query omitted Runtime-owned signal %q: %q", required, query)
		}
	}
	if strings.Contains(query, "private-media-id") || strings.Contains(query, "private-artifact-ref") {
		t.Fatalf("bounded Cognition query exposed private media identity: %q", query)
	}
	if len(query) > publicChatSourceCognitionQueryMaxBytes || !utf8.ValidString(query) {
		t.Fatalf("bounded Cognition query bytes=%d valid_utf8=%v", len(query), utf8.ValidString(query))
	}
}

func TestPublicChatSourceCognitionValidatesBoundOutcomeAndPreservesNoResult(t *testing.T) {
	snapshot := agentTurnContextTestSnapshot(t, "worldCharacter")
	source := sourceCognitionTestTurnView(t, snapshot)
	partition := sourceCognitionTestPartition(t, snapshot)
	unit := partition.CognitionUnits[0]
	scopeID := sourceCognitionScopeID(snapshot.LocalAgentRef)
	bridge := &sourceCognitionBridgeStub{search: cognitionservice.AgentSourceOutcome{
		Status: "ready", ScopeID: scopeID, SnapshotIdentity: snapshot.SnapshotHash, PartitionIdentity: snapshot.Partition.PartitionHash,
		Generation: 3, UnitCount: snapshot.Partition.UnitCount, OmissionCount: snapshot.Partition.OmissionCount,
		Units: []cognitionservice.AgentSourceUnit{
			{UnitID: unit.StableID, Category: unit.Category, SourcePath: unit.SourcePath, SourceRef: cognitionservice.AgentSourceRef{Kind: unit.SourceRef.Kind, WorldID: unit.SourceRef.WorldID, RefID: unit.SourceRef.RefID, SchemaVersion: unit.SourceRef.SchemaVersion, ContentHash: unit.SourceRef.ContentHash}, Text: unit.Text, ProvenanceRefs: append([]string{}, unit.ProvenanceRefs...), Priority: unit.Priority, Score: 0.9},
			{UnitID: "invalid-candidate", Category: unit.Category, SourcePath: unit.SourcePath, SourceRef: cognitionservice.AgentSourceRef{Kind: unit.SourceRef.Kind, WorldID: unit.SourceRef.WorldID, RefID: unit.SourceRef.RefID, SchemaVersion: unit.SourceRef.SchemaVersion, ContentHash: "invalid"}, Text: unit.Text, ProvenanceRefs: []string{}, Priority: unit.Priority, Score: 0.99},
			{UnitID: "invalid-category", Category: "source_prompt_lane", SourcePath: unit.SourcePath, SourceRef: cognitionservice.AgentSourceRef{Kind: unit.SourceRef.Kind, WorldID: unit.SourceRef.WorldID, RefID: unit.SourceRef.RefID, SchemaVersion: unit.SourceRef.SchemaVersion, ContentHash: unit.SourceRef.ContentHash}, Text: unit.Text, ProvenanceRefs: []string{}, Priority: unit.Priority, Score: 0.95},
			{UnitID: "invalid-score", Category: unit.Category, SourcePath: unit.SourcePath, SourceRef: cognitionservice.AgentSourceRef{Kind: unit.SourceRef.Kind, WorldID: unit.SourceRef.WorldID, RefID: unit.SourceRef.RefID, SchemaVersion: unit.SourceRef.SchemaVersion, ContentHash: unit.SourceRef.ContentHash}, Text: unit.Text, ProvenanceRefs: []string{}, Priority: unit.Priority, Score: math.NaN()},
			{UnitID: "foreign-ref", Category: unit.Category, SourcePath: unit.SourcePath, SourceRef: cognitionservice.AgentSourceRef{Kind: unit.SourceRef.Kind, WorldID: unit.SourceRef.WorldID, RefID: "another-character", SchemaVersion: unit.SourceRef.SchemaVersion, ContentHash: unit.SourceRef.ContentHash}, Text: unit.Text, ProvenanceRefs: []string{}, Priority: unit.Priority, Score: 0.94},
			{UnitID: "corrupt-text", Category: unit.Category, SourcePath: unit.SourcePath, SourceRef: cognitionservice.AgentSourceRef{Kind: unit.SourceRef.Kind, WorldID: unit.SourceRef.WorldID, RefID: unit.SourceRef.RefID, SchemaVersion: unit.SourceRef.SchemaVersion, ContentHash: unit.SourceRef.ContentHash}, Text: " corrupt text", ProvenanceRefs: []string{}, Priority: unit.Priority, Score: 0.93},
		},
	}}
	runtime := publicChatRuntime{svc: &Service{sourceCognitionBridge: bridge}}
	result := runtime.retrievePublicChatSourceCognition(context.Background(), publicChatAnchorState{OwnerUserID: "owner-1", LocalAgentRef: snapshot.LocalAgentRef}, source, agentTurnCurrentUserInput{Text: "Tell me the biography"}, nil, nil, nil, publicChatAvailableActions{})
	if result.AdapterStatus != "ready" || result.SelectionStatus != "ready" || result.CandidateCount != 6 || len(result.Candidates) != 1 || result.Candidates[0].UnitID != unit.StableID {
		t.Fatalf("guarded result = %#v", result)
	}
	bridge.search.Units[0].Score = 0.01
	bridge.search.Units = bridge.search.Units[:1]
	result = runtime.retrievePublicChatSourceCognition(context.Background(), publicChatAnchorState{OwnerUserID: "owner-1", LocalAgentRef: snapshot.LocalAgentRef}, source, agentTurnCurrentUserInput{Text: "unrelated"}, nil, nil, nil, publicChatAvailableActions{})
	if result.AdapterStatus != "ready" || result.SelectionStatus != "no_result" || len(result.Candidates) != 0 {
		t.Fatalf("low-relevance result = %#v", result)
	}
	bridge.search.SnapshotIdentity = strings.Repeat("f", 64)
	runtime.svc.closed.Store(true)
	result = runtime.retrievePublicChatSourceCognition(context.Background(), publicChatAnchorState{OwnerUserID: "owner-1", LocalAgentRef: snapshot.LocalAgentRef}, source, agentTurnCurrentUserInput{Text: "binding mismatch"}, nil, nil, nil, publicChatAvailableActions{})
	if result.AdapterStatus != "failure" || result.SelectionStatus != "failure" || len(result.Candidates) != 0 {
		t.Fatalf("mismatched bridge outcome was consumed: %#v", result)
	}
}

func TestActiveSourceCognitionRebuildReplaysSingularSnapshotPartition(t *testing.T) {
	snapshot := agentTurnContextTestSnapshot(t, "worldCharacter")
	partition := sourceCognitionTestPartition(t, snapshot)
	bridge := &sourceCognitionBridgeStub{}
	svc := &Service{
		sourceCognitionBridge: bridge,
		agents: map[string]*agentEntry{snapshot.LocalAgentRef: {Agent: &runtimev1.LocalAgentRecord{
			LocalAgentRef: snapshot.LocalAgentRef, OwnerUserId: "owner-1",
			LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE, SourceContextStatus: localAgentSourceContextStatusV2(snapshot),
		}}},
		publicChatSourceSnapshotResolve: func(context.Context, string) (localAgentSourceSnapshotV2, bool, error) {
			return snapshot, true, nil
		},
	}
	if err := svc.rebuildActiveSourceCognition(context.Background(), "owner-1"); err != nil {
		t.Fatal(err)
	}
	if bridge.ingestCalls != 1 || bridge.ingestedSnapshot != snapshot.SnapshotHash || bridge.ingestedPartition != snapshot.Partition.PartitionHash || bridge.ingestedUnitCount != len(partition.CognitionUnits) || bridge.ingestedOmissionsNil {
		t.Fatalf("rebuild projection = %#v", bridge)
	}
}

func TestSettingSourceCognitionBridgeReplaysMissingActiveSnapshot(t *testing.T) {
	snapshot := agentTurnContextTestSnapshot(t, "worldCharacter")
	bridge := &sourceCognitionBridgeStub{ingestNotify: make(chan struct{}, 1)}
	lifecycleCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	svc := &Service{
		agents:                          map[string]*agentEntry{snapshot.LocalAgentRef: {Agent: &runtimev1.LocalAgentRecord{LocalAgentRef: snapshot.LocalAgentRef, OwnerUserId: "owner-1", LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE, SourceContextStatus: localAgentSourceContextStatusV2(snapshot)}}},
		publicChatSourceSnapshotResolve: func(context.Context, string) (localAgentSourceSnapshotV2, bool, error) { return snapshot, true, nil },
		sourceCognitionLifecycleCtx:     lifecycleCtx,
		sourceCognitionJobs:             make(map[string]struct{}),
	}
	svc.SetSourceCognitionBridge(bridge)
	select {
	case <-bridge.ingestNotify:
	case <-time.After(2 * time.Second):
		t.Fatal("startup bridge binding did not replay the missing source generation")
	}
	svc.sourceCognitionWG.Wait()
	if bridge.ingestedSnapshot != snapshot.SnapshotHash || bridge.ingestedPartition != snapshot.Partition.PartitionHash {
		t.Fatalf("startup replay binding = %#v", bridge)
	}
}

func TestSettingSourceCognitionBridgePreservesReadyGeneration(t *testing.T) {
	snapshot := agentTurnContextTestSnapshot(t, "worldCharacter")
	bridge := &sourceCognitionBridgeStub{inspectOutcome: cognitionservice.AgentSourceOutcome{Status: "ready", ScopeID: sourceCognitionScopeID(snapshot.LocalAgentRef), SnapshotIdentity: snapshot.SnapshotHash, PartitionIdentity: snapshot.Partition.PartitionHash, Generation: 7, UnitCount: snapshot.Partition.UnitCount, OmissionCount: snapshot.Partition.OmissionCount}, ingestNotify: make(chan struct{}, 1)}
	lifecycleCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	svc := &Service{
		agents:                          map[string]*agentEntry{snapshot.LocalAgentRef: {Agent: &runtimev1.LocalAgentRecord{LocalAgentRef: snapshot.LocalAgentRef, OwnerUserId: "owner-1", LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE, SourceContextStatus: localAgentSourceContextStatusV2(snapshot)}}},
		publicChatSourceSnapshotResolve: func(context.Context, string) (localAgentSourceSnapshotV2, bool, error) { return snapshot, true, nil },
		sourceCognitionLifecycleCtx:     lifecycleCtx,
		sourceCognitionJobs:             make(map[string]struct{}),
	}
	svc.SetSourceCognitionBridge(bridge)
	svc.sourceCognitionWG.Wait()
	if bridge.ingestCalls != 0 {
		t.Fatalf("startup validation rotated ready generation: %#v", bridge)
	}
}

func TestSettingSourceCognitionBridgeReplaysZeroReadyGeneration(t *testing.T) {
	snapshot := agentTurnContextTestSnapshot(t, "worldCharacter")
	bridge := &sourceCognitionBridgeStub{
		inspectOutcome: cognitionservice.AgentSourceOutcome{
			Status: "ready", ScopeID: sourceCognitionScopeID(snapshot.LocalAgentRef), SnapshotIdentity: snapshot.SnapshotHash,
			PartitionIdentity: snapshot.Partition.PartitionHash, Generation: 0,
			UnitCount: snapshot.Partition.UnitCount, OmissionCount: snapshot.Partition.OmissionCount,
		},
		ingestNotify: make(chan struct{}, 1),
	}
	lifecycleCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	svc := &Service{
		agents: map[string]*agentEntry{snapshot.LocalAgentRef: {Agent: &runtimev1.LocalAgentRecord{
			LocalAgentRef: snapshot.LocalAgentRef, OwnerUserId: "owner-1",
			LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE, SourceContextStatus: localAgentSourceContextStatusV2(snapshot),
		}}},
		publicChatSourceSnapshotResolve: func(context.Context, string) (localAgentSourceSnapshotV2, bool, error) { return snapshot, true, nil },
		sourceCognitionLifecycleCtx:     lifecycleCtx,
		sourceCognitionJobs:             make(map[string]struct{}),
	}
	svc.SetSourceCognitionBridge(bridge)
	select {
	case <-bridge.ingestNotify:
	case <-time.After(2 * time.Second):
		t.Fatal("zero ready generation did not trigger snapshot replay")
	}
	svc.sourceCognitionWG.Wait()
	if bridge.ingestCalls != 1 || bridge.ingestedPartition != snapshot.Partition.PartitionHash {
		t.Fatalf("zero-generation replay = %#v", bridge)
	}
}

func TestSourceCognitionSearchFailureSchedulesSnapshotOnlyReplay(t *testing.T) {
	snapshot := agentTurnContextTestSnapshot(t, "worldCharacter")
	source := sourceCognitionTestTurnView(t, snapshot)
	bridge := &sourceCognitionBridgeStub{
		searchErr: errors.New("storage: runtime source unit is corrupt"),
		inspectOutcome: cognitionservice.AgentSourceOutcome{
			Status: "ready", ScopeID: sourceCognitionScopeID(snapshot.LocalAgentRef), SnapshotIdentity: snapshot.SnapshotHash,
			PartitionIdentity: snapshot.Partition.PartitionHash, Generation: 3,
			UnitCount: snapshot.Partition.UnitCount, OmissionCount: snapshot.Partition.OmissionCount,
		},
		ingestNotify: make(chan struct{}, 1),
	}
	lifecycleCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	svc := &Service{
		sourceCognitionBridge:           bridge,
		agents:                          map[string]*agentEntry{snapshot.LocalAgentRef: {Agent: &runtimev1.LocalAgentRecord{LocalAgentRef: snapshot.LocalAgentRef, OwnerUserId: "owner-1", LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE, SourceContextStatus: localAgentSourceContextStatusV2(snapshot)}}},
		publicChatSourceSnapshotResolve: func(context.Context, string) (localAgentSourceSnapshotV2, bool, error) { return snapshot, true, nil },
		sourceCognitionLifecycleCtx:     lifecycleCtx,
		sourceCognitionJobs:             make(map[string]struct{}),
	}
	runtime := publicChatRuntime{svc: svc}
	result := runtime.retrievePublicChatSourceCognition(context.Background(), publicChatAnchorState{OwnerUserID: "owner-1", LocalAgentRef: snapshot.LocalAgentRef}, source, agentTurnCurrentUserInput{Text: "missing generation"}, nil, nil, nil, publicChatAvailableActions{})
	if result.AdapterStatus != "failure" || result.SelectionStatus != "failure" {
		t.Fatalf("missing generation query = %#v", result)
	}
	select {
	case <-bridge.ingestNotify:
	case <-time.After(2 * time.Second):
		t.Fatal("missing generation did not trigger snapshot-only replay")
	}
	svc.sourceCognitionWG.Wait()
	if bridge.ingestedSnapshot != snapshot.SnapshotHash || bridge.ingestedPartition != snapshot.Partition.PartitionHash {
		t.Fatalf("query recovery replay binding = %#v", bridge)
	}
}

func TestSourceCognitionGenerationCountMismatchForcesSnapshotReplay(t *testing.T) {
	snapshot := agentTurnContextTestSnapshot(t, "worldCharacter")
	source := sourceCognitionTestTurnView(t, snapshot)
	bridge := &sourceCognitionBridgeStub{search: cognitionservice.AgentSourceOutcome{
		Status: "no_hits", ScopeID: sourceCognitionScopeID(snapshot.LocalAgentRef), SnapshotIdentity: snapshot.SnapshotHash,
		PartitionIdentity: snapshot.Partition.PartitionHash, Generation: 4,
		UnitCount: snapshot.Partition.UnitCount - 1, OmissionCount: snapshot.Partition.OmissionCount,
	}, ingestNotify: make(chan struct{}, 1)}
	lifecycleCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	svc := &Service{
		sourceCognitionBridge:           bridge,
		agents:                          map[string]*agentEntry{snapshot.LocalAgentRef: {Agent: &runtimev1.LocalAgentRecord{LocalAgentRef: snapshot.LocalAgentRef, OwnerUserId: "owner-1", LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE, SourceContextStatus: localAgentSourceContextStatusV2(snapshot)}}},
		publicChatSourceSnapshotResolve: func(context.Context, string) (localAgentSourceSnapshotV2, bool, error) { return snapshot, true, nil },
		sourceCognitionLifecycleCtx:     lifecycleCtx,
		sourceCognitionJobs:             make(map[string]struct{}),
	}
	runtime := publicChatRuntime{svc: svc}
	result := runtime.retrievePublicChatSourceCognition(context.Background(), publicChatAnchorState{OwnerUserID: "owner-1", LocalAgentRef: snapshot.LocalAgentRef}, source, agentTurnCurrentUserInput{Text: "missing stored row"}, nil, nil, nil, publicChatAvailableActions{})
	if result.AdapterStatus != "failure" || result.SelectionStatus != "failure" {
		t.Fatalf("mismatched generation was projected as success: %#v", result)
	}
	select {
	case <-bridge.ingestNotify:
	case <-time.After(2 * time.Second):
		t.Fatal("generation count mismatch did not force snapshot replay")
	}
	svc.sourceCognitionWG.Wait()
	if bridge.ingestCalls != 1 || bridge.ingestedPartition != snapshot.Partition.PartitionHash {
		t.Fatalf("mismatch replay = %#v", bridge)
	}
}

type sourceCognitionBridgeStub struct {
	search               cognitionservice.AgentSourceOutcome
	searchErr            error
	inspectOutcome       cognitionservice.AgentSourceOutcome
	inspectErr           error
	ingestCalls          int
	ingestedSnapshot     string
	ingestedPartition    string
	ingestedUnitCount    int
	ingestedOmissionsNil bool
	deleteOutcome        cognitionservice.AgentSourceOutcome
	deleteErr            error
	ingestNotify         chan struct{}
}

func (s *sourceCognitionBridgeStub) IngestAgentSource(_ context.Context, _, _, scopeID, snapshot, partition string, units []cognitionservice.AgentSourceUnit, omissions []cognitionservice.AgentSourceOmission) (cognitionservice.AgentSourceOutcome, error) {
	s.ingestCalls++
	s.ingestedSnapshot = snapshot
	s.ingestedPartition = partition
	s.ingestedUnitCount = len(units)
	s.ingestedOmissionsNil = omissions == nil
	if s.ingestNotify != nil {
		select {
		case s.ingestNotify <- struct{}{}:
		default:
		}
	}
	return cognitionservice.AgentSourceOutcome{Status: "building", ScopeID: scopeID, SnapshotIdentity: snapshot, PartitionIdentity: partition, Generation: 1, UnitCount: uint32(len(units)), OmissionCount: uint32(len(omissions))}, nil
}

func (s *sourceCognitionBridgeStub) SearchAgentSource(_ context.Context, _, _, scopeID, snapshot string, _ string, _ int) (cognitionservice.AgentSourceOutcome, error) {
	if s.searchErr != nil {
		return cognitionservice.AgentSourceOutcome{}, s.searchErr
	}
	out := s.search
	if out.ScopeID == "" {
		out.ScopeID = scopeID
	}
	if out.SnapshotIdentity == "" {
		out.SnapshotIdentity = snapshot
	}
	return out, nil
}

func (s *sourceCognitionBridgeStub) InspectAgentSource(_ context.Context, _, scopeID, snapshot string) (cognitionservice.AgentSourceOutcome, error) {
	if s.inspectErr != nil {
		return cognitionservice.AgentSourceOutcome{}, s.inspectErr
	}
	if s.inspectOutcome.Status != "" {
		out := s.inspectOutcome
		if out.ScopeID == "" {
			out.ScopeID = scopeID
		}
		if out.SnapshotIdentity == "" {
			out.SnapshotIdentity = snapshot
		}
		return out, nil
	}
	return cognitionservice.AgentSourceOutcome{Status: "unconfigured", ScopeID: scopeID, SnapshotIdentity: snapshot}, nil
}

func (s *sourceCognitionBridgeStub) DeleteAgentSource(_ context.Context, _, scopeID, snapshot string) (cognitionservice.AgentSourceOutcome, error) {
	if s.deleteErr != nil {
		return cognitionservice.AgentSourceOutcome{}, s.deleteErr
	}
	if s.deleteOutcome.Status != "" {
		out := s.deleteOutcome
		if out.ScopeID == "" {
			out.ScopeID = scopeID
		}
		if out.SnapshotIdentity == "" {
			out.SnapshotIdentity = snapshot
		}
		return out, nil
	}
	return cognitionservice.AgentSourceOutcome{Status: "already_absent", ScopeID: scopeID, SnapshotIdentity: snapshot}, nil
}

func sourceCognitionTestPartition(t *testing.T, snapshot localAgentSourceSnapshotV2) localAgentSourcePartitionV1 {
	t.Helper()
	partition, err := projectLocalAgentSourcePartitionV1(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	return partition
}

func sourceCognitionTestTurnView(t *testing.T, snapshot localAgentSourceSnapshotV2) localAgentTurnSourceViewV1 {
	t.Helper()
	view, err := localAgentTurnSourceViewFromSnapshotV1(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	return view
}
