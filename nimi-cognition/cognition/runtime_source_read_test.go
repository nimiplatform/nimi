package cognition

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
)

func runtimeSourceExactReadFixture(t *testing.T, status string) (*RuntimeSourceBridge, RuntimeAuthorization, RuntimeSourceReferenceRead, RuntimeSourceUnit, string) {
	t.Helper()
	root := t.TempDir()
	owner, err := NewV1Owner(root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := owner.Close(); err != nil {
			t.Error(err)
		}
	})
	scope, snapshot, partition := "agent_source_exact", strings.Repeat("a", 64), strings.Repeat("b", 64)
	unit := RuntimeSourceUnit{UnitID: "fixed-page", Category: "world_fact", SourcePath: "world.fact.page.0", SourceRef: RuntimeSourceRef{Kind: "worldEntity", WorldID: "world", RefID: "world:page", SchemaVersion: "entity/v1", ContentHash: strings.Repeat("c", 64)}, Text: "这是固定原文。\n第二句仍须原样保留。", ProvenanceRefs: []string{"realm:fixed-page"}, Priority: 100}
	envelope := RuntimeSourceIngestionEnvelope{ScopeID: scope, SnapshotIdentity: snapshot, PartitionIdentity: partition, EmbeddingStatus: "building", CoverageCount: 1, Units: []RuntimeSourceUnit{unit}, Omissions: []RuntimeSourceOmission{}}
	building, err := owner.SourceBridge().IngestAgentSource(context.Background(), runtimeSourceTestAuthorization(scope, RuntimeBridgeOperationIngestAgentSource, RuntimeAuthorizationActionIngestAgentSource), envelope)
	if err != nil {
		t.Fatal(err)
	}
	if status != "building" {
		envelope.Generation, envelope.EmbeddingStatus = building.Generation, status
		if status == "ready" {
			envelope.EmbeddingIdentity, envelope.EmbeddingDimension = "embed", 2
			envelope.Units[0].Embedding = []float64{1, 0}
		}
		if _, err := owner.SourceBridge().IngestAgentSource(context.Background(), runtimeSourceTestAuthorization(scope, RuntimeBridgeOperationIngestAgentSource, RuntimeAuthorizationActionIngestAgentSource), envelope); err != nil {
			t.Fatal(err)
		}
	}
	request := RuntimeSourceReferenceRead{ScopeID: scope, SnapshotIdentity: snapshot, PartitionIdentity: partition, UnitCount: 1, Selections: []RuntimeSourceSelection{{SourceRef: unit.SourceRef, Basis: "alias", Term: "第一页", Units: []RuntimeSourceUnitBinding{{UnitID: unit.UnitID, ContentHash: RuntimeSourceUnitContentHash(unit)}}}}, Limit: 12}
	return owner.SourceBridge(), runtimeSourceTestAuthorization(scope, RuntimeBridgeOperationSearchAgentSource, RuntimeAuthorizationActionSearchAgentSource), request, unit, filepath.Join(root, "cognition-agent-source-v1.sqlite3")
}

func TestRuntimeSourceExactReadIndependentOfSemanticReadiness(t *testing.T) {
	for _, status := range []string{"building", "unconfigured", "unavailable", "failure", "ready"} {
		t.Run(status, func(t *testing.T) {
			bridge, auth, request, unit, _ := runtimeSourceExactReadFixture(t, status)
			out, err := bridge.ReadAgentSourceReferences(context.Background(), auth, request)
			if err != nil || out.Status != status || out.GenerationStatus != status || out.ExactStatus != "ready" || len(out.Units) != 1 {
				t.Fatalf("exact read = %#v err=%v", out, err)
			}
			hit := out.Units[0]
			if hit.Text != unit.Text || hit.SourceRef != unit.SourceRef || hit.Score != 0 || hit.HasSemanticScore || hit.SelectionBasis != "alias" || hit.MatchedTerm != "第一页" || len(hit.ProvenanceRefs) != 1 || hit.ProvenanceRefs[0] != unit.ProvenanceRefs[0] {
				t.Fatalf("exact source was changed or given a vector score: %#v", hit)
			}
			semantic, err := bridge.SearchAgentSource(context.Background(), auth, request.ScopeID, request.SnapshotIdentity, "", "第一页", nil, 12)
			if status == "ready" {
				if err == nil || len(semantic.Units) != 0 {
					t.Fatalf("unavailable query embedding produced semantic success: %#v err=%v", semantic, err)
				}
			} else if err != nil || semantic.Status != status || len(semantic.Units) != 0 {
				t.Fatalf("unready semantic query changed outcome: %#v err=%v", semantic, err)
			}
		})
	}
}

func TestRuntimeSourceExactReadRejectsBindingAndContentCorruption(t *testing.T) {
	for _, kind := range []string{"authorization", "snapshot", "partition", "count", "hash", "missing", "changed_text", "invalid_provenance", "foreign_ref"} {
		t.Run(kind, func(t *testing.T) {
			bridge, auth, request, _, path := runtimeSourceExactReadFixture(t, "unconfigured")
			switch kind {
			case "authorization":
				auth.ScopeID = "another_agent"
			case "snapshot":
				request.SnapshotIdentity = strings.Repeat("d", 64)
			case "partition":
				request.PartitionIdentity = strings.Repeat("d", 64)
			case "count":
				request.UnitCount++
			case "hash":
				request.Selections[0].Units[0].ContentHash = strings.Repeat("d", 64)
			default:
				db, err := sql.Open("sqlite", path)
				if err != nil {
					t.Fatal(err)
				}
				defer func() {
					if closeErr := db.Close(); closeErr != nil {
						t.Error(closeErr)
					}
				}()
				statement := map[string]string{"missing": `DELETE FROM runtime_source_unit`, "changed_text": `UPDATE runtime_source_unit SET text='完整但被改写的正文'`, "invalid_provenance": `UPDATE runtime_source_unit SET provenance_refs_json='bad-json'`, "foreign_ref": `UPDATE runtime_source_unit SET source_ref_id='world:other'`}[kind]
				if _, err := db.Exec(statement); err != nil {
					t.Fatal(err)
				}
			}
			out, err := bridge.ReadAgentSourceReferences(context.Background(), auth, request)
			if err == nil || len(out.Units) != 0 {
				t.Fatalf("invalid %s leaked source: %#v err=%v", kind, out, err)
			}
		})
	}
}

func TestRuntimeSourceExactTextRemainsAvailableWithCorruptVector(t *testing.T) {
	bridge, auth, request, unit, path := runtimeSourceExactReadFixture(t, "ready")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if closeErr := db.Close(); closeErr != nil {
			t.Error(closeErr)
		}
	}()
	if _, err := db.Exec(`UPDATE runtime_source_unit SET embedding_json='not-a-vector'`); err != nil {
		t.Fatal(err)
	}
	out, err := bridge.ReadAgentSourceReferences(context.Background(), auth, request)
	if err != nil || out.ExactStatus != "ready" || len(out.Units) != 1 || out.Units[0].Text != unit.Text {
		t.Fatalf("vector corruption blocked valid exact text: %#v err=%v", out, err)
	}
	semantic, err := bridge.SearchAgentSource(context.Background(), auth, request.ScopeID, request.SnapshotIdentity, "embed", "page", []float64{1, 0}, 12)
	if err == nil || len(semantic.Units) != 0 {
		t.Fatalf("corrupt vector passed semantic validation: %#v err=%v", semantic, err)
	}
}

func TestRuntimeSourceExactReadKeepsBodyBeforeDescriptors(t *testing.T) {
	bridge, auth, request, body, _ := runtimeSourceExactReadFixture(t, "unconfigured")
	body.Priority = 10
	identity := body
	identity.UnitID, identity.Category, identity.SourcePath, identity.Text, identity.Priority = "identity", "world_entity", "entity.identity", "Page identity", 100
	assets := body
	assets.UnitID, assets.Category, assets.SourcePath, assets.Text, assets.Priority = "assets", "source_asset_detail", "entity.assets", `{"resourceRefs":[]}`, 1000
	evidence := body
	evidence.UnitID, evidence.Category, evidence.SourcePath, evidence.Text, evidence.Priority = "evidence", "source_evidence", "entity.evidence", `{"completeness":"complete"}`, 900
	units := []RuntimeSourceUnit{body, assets, evidence, identity}
	envelope := RuntimeSourceIngestionEnvelope{ScopeID: request.ScopeID, SnapshotIdentity: request.SnapshotIdentity, PartitionIdentity: request.PartitionIdentity, EmbeddingStatus: "building", CoverageCount: 4, Units: units, Omissions: []RuntimeSourceOmission{}}
	if _, err := bridge.IngestAgentSource(context.Background(), runtimeSourceTestAuthorization(request.ScopeID, RuntimeBridgeOperationIngestAgentSource, RuntimeAuthorizationActionIngestAgentSource), envelope); err != nil {
		t.Fatal(err)
	}
	request.UnitCount = 4
	request.Selections[0].Units = nil
	for _, unit := range units {
		request.Selections[0].Units = append(request.Selections[0].Units, RuntimeSourceUnitBinding{UnitID: unit.UnitID, ContentHash: RuntimeSourceUnitContentHash(unit)})
	}
	out, err := bridge.ReadAgentSourceReferences(context.Background(), auth, request)
	if err != nil || len(out.Units) != 4 || out.Units[0].UnitID != "identity" || out.Units[1].UnitID != body.UnitID || out.Units[2].UnitID != "assets" {
		t.Fatalf("descriptors displaced exact body: %#v err=%v", out, err)
	}
	if out.Units[1].Priority != 10 || out.Units[2].Priority != 1000 || out.Units[1].Score != 0 {
		t.Fatal("exact ordering changed source priority or manufactured similarity")
	}
}
