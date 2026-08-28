package cognition

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestRuntimeSourceBridgeEmbeddingGatesReadySearchAndSnapshotIsolation(t *testing.T) {
	core, err := NewV1Owner(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer core.Close()
	bridge := core.SourceBridge()
	scopeID := "agent_source_test_alpha"
	snapshot := strings.Repeat("a", 64)
	partition := strings.Repeat("b", 64)
	auth := runtimeSourceTestAuthorization(scopeID, RuntimeBridgeOperationIngestAgentSource, RuntimeAuthorizationActionIngestAgentSource)
	ref := RuntimeSourceRef{Kind: "worldCharacter", WorldID: "world-1", RefID: "character-1", SchemaVersion: "realm.world-character-core/v1", ContentHash: strings.Repeat("c", 64)}
	worldRef := RuntimeSourceRef{Kind: "worldCore", WorldID: "world-1", RefID: "world-1", SchemaVersion: "realm.world-core/v1", ContentHash: strings.Repeat("d", 64)}
	envelope := RuntimeSourceIngestionEnvelope{
		ScopeID: scopeID, SnapshotIdentity: snapshot, PartitionIdentity: partition,
		EmbeddingStatus: "building", CoverageCount: 2,
		Omissions: []RuntimeSourceOmission{},
		Units: []RuntimeSourceUnit{
			{UnitID: "unit-biography", Category: "biography_event", SourcePath: "profile.biography", SourceRef: ref, Text: "Li Yong served as a Tang official and calligrapher.", ProvenanceRefs: []string{"cbdb:BIOG_MAIN:31592"}, Priority: 900},
			{UnitID: "unit-world", Category: "world_setting_detail", SourcePath: "world.identity", SourceRef: worldRef, Text: "Tang literati world", ProvenanceRefs: []string{}, Priority: 500},
		},
	}
	building, err := bridge.IngestAgentSource(context.Background(), auth, envelope)
	if err != nil || building.Status != "building" || building.Generation != 1 || building.PartitionIdentity != partition || building.UnitCount != 2 || building.OmissionCount != 0 {
		t.Fatalf("building outcome = %#v, err=%v", building, err)
	}
	envelope.EmbeddingStatus = "ready"
	envelope.Generation = building.Generation
	envelope.EmbeddingIdentity = "embed-profile-1"
	envelope.EmbeddingDimension = 3
	envelope.Units[0].Embedding = []float64{1, 0, 0}
	envelope.Units[1].Embedding = []float64{0, 1, 0}
	ready, err := bridge.IngestAgentSource(context.Background(), auth, envelope)
	if err != nil {
		t.Fatal(err)
	}
	if ready.Status != "ready" || ready.Generation != 1 || ready.PartitionIdentity != partition || ready.UnitCount != 2 || ready.OmissionCount != 0 {
		t.Fatalf("ready outcome = %#v", ready)
	}
	inspection, err := bridge.InspectAgentSource(context.Background(), runtimeSourceTestAuthorization(scopeID, RuntimeBridgeOperationSearchAgentSource, RuntimeAuthorizationActionSearchAgentSource), scopeID, snapshot)
	if err != nil || inspection.Status != "ready" || inspection.PartitionIdentity != partition || inspection.UnitCount != 2 || inspection.OmissionCount != 0 {
		t.Fatalf("inspection outcome = %#v, err=%v", inspection, err)
	}

	searchAuth := runtimeSourceTestAuthorization(scopeID, RuntimeBridgeOperationSearchAgentSource, RuntimeAuthorizationActionSearchAgentSource)
	hits, err := bridge.SearchAgentSource(context.Background(), searchAuth, scopeID, snapshot, "embed-profile-1", "calligrapher", []float64{1, 0, 0}, 4)
	if err != nil {
		t.Fatal(err)
	}
	if hits.Status != "ready" || hits.PartitionIdentity != partition || hits.UnitCount != 2 || hits.OmissionCount != 0 || len(hits.Units) != 1 || hits.Units[0].UnitID != "unit-biography" || hits.Units[0].Score <= 1 || len(hits.Units[0].ProvenanceRefs) != 1 || hits.Units[0].ProvenanceRefs[0] != "cbdb:BIOG_MAIN:31592" {
		t.Fatalf("ranked hits = %#v", hits)
	}
	if _, err := bridge.SearchAgentSource(context.Background(), searchAuth, scopeID, strings.Repeat("d", 64), "embed-profile-1", "calligrapher", []float64{1, 0, 0}, 4); err == nil {
		t.Fatal("snapshot mismatch was accepted")
	}
	if _, err := bridge.SearchAgentSource(context.Background(), searchAuth, scopeID, snapshot, "embed-profile-2", "calligrapher", []float64{1, 0, 0}, 4); err == nil {
		t.Fatal("embedding identity mismatch was accepted")
	}
	noHits, err := bridge.SearchAgentSource(context.Background(), searchAuth, scopeID, snapshot, "embed-profile-1", "unrelated", []float64{0, 0, 1}, 4)
	if err != nil || noHits.Status != "no_hits" || len(noHits.Units) != 0 {
		t.Fatalf("no-hits outcome = %#v, err=%v", noHits, err)
	}
}

func TestRuntimeSourceBridgeUnconfiguredIsNotNoHits(t *testing.T) {
	core, err := NewV1Owner(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer core.Close()
	bridge := core.SourceBridge()
	scopeID := "agent_source_test_unconfigured"
	snapshot := strings.Repeat("e", 64)
	ref := RuntimeSourceRef{Kind: "worldCore", WorldID: "world-1", RefID: "world-1", SchemaVersion: "realm.world-core/v1", ContentHash: strings.Repeat("f", 64)}
	auth := runtimeSourceTestAuthorization(scopeID, RuntimeBridgeOperationIngestAgentSource, RuntimeAuthorizationActionIngestAgentSource)
	envelope := RuntimeSourceIngestionEnvelope{
		ScopeID: scopeID, SnapshotIdentity: snapshot, PartitionIdentity: strings.Repeat("1", 64),
		EmbeddingStatus: "building", CoverageCount: 1, Omissions: []RuntimeSourceOmission{},
		Units: []RuntimeSourceUnit{{UnitID: "unit-1", Category: "world_setting_detail", SourcePath: "world.identity", SourceRef: ref, Text: "world text", ProvenanceRefs: []string{}, Priority: 1}},
	}
	building, err := bridge.IngestAgentSource(context.Background(), auth, envelope)
	if err != nil {
		t.Fatal(err)
	}
	envelope.EmbeddingStatus = "unconfigured"
	envelope.Generation = building.Generation
	_, err = bridge.IngestAgentSource(context.Background(), auth, envelope)
	if err != nil {
		t.Fatal(err)
	}
	out, err := bridge.SearchAgentSource(context.Background(), runtimeSourceTestAuthorization(scopeID, RuntimeBridgeOperationSearchAgentSource, RuntimeAuthorizationActionSearchAgentSource), scopeID, snapshot, "", "world", nil, 4)
	if err != nil {
		t.Fatal(err)
	}
	if out.Status != "unconfigured" || len(out.Units) != 0 {
		t.Fatalf("unconfigured search = %#v", out)
	}
}

func TestRuntimeSourceBridgeRejectsDuplicateIndexedOrOmittedPathCoverage(t *testing.T) {
	core, err := NewV1Owner(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer core.Close()
	scopeID := "agent_source_duplicate_coverage"
	snapshot := strings.Repeat("2", 64)
	ref := RuntimeSourceRef{Kind: "worldCore", WorldID: "world-1", RefID: "world-1", SchemaVersion: "realm.world-core/v1", ContentHash: strings.Repeat("3", 64)}
	envelope := RuntimeSourceIngestionEnvelope{
		ScopeID: scopeID, SnapshotIdentity: snapshot, PartitionIdentity: strings.Repeat("4", 64), EmbeddingStatus: "building", CoverageCount: 2,
		Units:     []RuntimeSourceUnit{{UnitID: "unit-1", Category: "world_setting_detail", SourcePath: "world.identity", SourceRef: ref, Text: "world text", ProvenanceRefs: []string{}, Priority: 1}},
		Omissions: []RuntimeSourceOmission{{UnitID: "unit-2", Category: "world_setting_detail", SourcePath: "world.identity", SourceRef: ref, OmissionReason: "explicit_source_section_empty", ProvenanceRefs: []string{}}},
	}
	_, err = core.SourceBridge().IngestAgentSource(context.Background(), runtimeSourceTestAuthorization(scopeID, RuntimeBridgeOperationIngestAgentSource, RuntimeAuthorizationActionIngestAgentSource), envelope)
	if err == nil || !strings.Contains(err.Error(), "duplicate source path coverage") {
		t.Fatalf("duplicate source path coverage was admitted: %v", err)
	}
}

func TestRuntimeSourceBridgeRejectsInvalidProvenanceAndOverBoundSemanticText(t *testing.T) {
	core, err := NewV1Owner(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer core.Close()
	scopeID := "agent_source_invalid_provenance"
	ref := RuntimeSourceRef{Kind: "worldCore", WorldID: "world-1", RefID: "world-1", SchemaVersion: "realm.world-core/v1", ContentHash: strings.Repeat("5", 64)}
	base := RuntimeSourceIngestionEnvelope{
		ScopeID: scopeID, SnapshotIdentity: strings.Repeat("6", 64), PartitionIdentity: strings.Repeat("7", 64), EmbeddingStatus: "building", CoverageCount: 1,
		Units:     []RuntimeSourceUnit{{UnitID: "unit-1", Category: "world_setting_detail", SourcePath: "world.identity", SourceRef: ref, Text: "world text", ProvenanceRefs: []string{}}},
		Omissions: []RuntimeSourceOmission{},
	}
	auth := runtimeSourceTestAuthorization(scopeID, RuntimeBridgeOperationIngestAgentSource, RuntimeAuthorizationActionIngestAgentSource)
	for name, mutate := range map[string]func(*RuntimeSourceIngestionEnvelope){
		"nil refs": func(value *RuntimeSourceIngestionEnvelope) { value.Units[0].ProvenanceRefs = nil },
		"duplicate refs": func(value *RuntimeSourceIngestionEnvelope) {
			value.Units[0].ProvenanceRefs = []string{"ref-1", "ref-1"}
		},
		"non-exact ref": func(value *RuntimeSourceIngestionEnvelope) { value.Units[0].ProvenanceRefs = []string{" ref-1"} },
		"over-bound text": func(value *RuntimeSourceIngestionEnvelope) {
			value.Units[0].Text = strings.Repeat("x", runtimeSourceSemanticTextMaxBytes+1)
		},
	} {
		t.Run(name, func(t *testing.T) {
			candidate := base
			candidate.Units = append([]RuntimeSourceUnit(nil), base.Units...)
			candidate.Units[0].ProvenanceRefs = append([]string{}, base.Units[0].ProvenanceRefs...)
			mutate(&candidate)
			if _, err := core.SourceBridge().IngestAgentSource(context.Background(), auth, candidate); err == nil {
				t.Fatal("invalid source envelope was admitted")
			}
		})
	}
}

func runtimeSourceTestAuthorization(scopeID string, operation RuntimeBridgeOperation, action RuntimeAuthorizationAction) RuntimeAuthorization {
	now := time.Now().UTC()
	return RuntimeAuthorization{
		Decision: RuntimeAuthorizationDecisionAllow, Action: action, Operation: operation,
		AccountID: "account-1", AppID: "runtime.agent", ScopeID: scopeID,
		Owner: RuntimeSourceOwner{Kind: "runtime_local_agent_source"}, EvaluatedAt: now, ExpiresAt: now.Add(time.Minute),
	}
}
