package cognition

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/config"
)

func TestProjectAgentSourceOmissionsPreservesExplicitEmptyCoverage(t *testing.T) {
	omissions := projectAgentSourceOmissions([]AgentSourceOmission{})
	if omissions == nil || len(omissions) != 0 {
		t.Fatalf("explicit empty omissions = %#v", omissions)
	}
}

func TestAgentSourceGenerationCommitsBuildingBeforeTerminalReady(t *testing.T) {
	svc, cleanup := newSourceTestService(t)
	defer cleanup()
	started := make(chan struct{}, 1)
	embeddedTexts := make(chan []string, 1)
	release := make(chan struct{})
	svc.SetAgentSourceEmbeddingExecutor(func(ctx context.Context, _, _ string, texts []string) (AgentSourceEmbeddingExecution, error) {
		select {
		case embeddedTexts <- append([]string(nil), texts...):
		default:
		}
		select {
		case started <- struct{}{}:
		default:
		}
		select {
		case <-release:
		case <-ctx.Done():
			return AgentSourceEmbeddingExecution{Status: "failure"}, ctx.Err()
		}
		vectors := make([][]float64, len(texts))
		for index := range vectors {
			vectors[index] = []float64{1, 0}
		}
		return AgentSourceEmbeddingExecution{Status: "ready", Identity: "embed-test", Dimension: 2, Vectors: vectors}, nil
	})
	scopeID := "agent_source_generation_test"
	snapshot := strings.Repeat("a", 64)
	ref := AgentSourceRef{Kind: "worldCharacter", WorldID: "world-1", RefID: "character-1", SchemaVersion: "realm.world-character-core/v1", ContentHash: strings.Repeat("b", 64)}
	provenanceRefs := make([]string, 973)
	for index := range provenanceRefs {
		provenanceRefs[index] = "cbdb:OFFICE_CODES:" + string(rune('a'+index%26)) + fmt.Sprintf(":%d", index)
	}
	building, err := svc.IngestAgentSource(context.Background(), "account-1", "local-agent-1", scopeID, snapshot, strings.Repeat("c", 64), []AgentSourceUnit{{UnitID: "unit-1", Category: "biography_event", SourcePath: "profile.narrative", SourceRef: ref, Text: "source text", ProvenanceRefs: provenanceRefs, Priority: 10}}, []AgentSourceOmission{{UnitID: "unit-omitted", Category: "behavior_detail", SourcePath: "profile.psychology", SourceRef: ref, OmissionReason: "optional_source_section_absent", ProvenanceRefs: []string{}}})
	if err != nil {
		t.Fatal(err)
	}
	if building.Status != "building" || building.ScopeID != scopeID || building.SnapshotIdentity != snapshot || building.PartitionIdentity != strings.Repeat("c", 64) || building.UnitCount != 1 || building.OmissionCount != 1 || building.Generation == 0 {
		t.Fatalf("building outcome = %#v", building)
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("embedding generation did not start")
	}
	select {
	case texts := <-embeddedTexts:
		if len(texts) != 1 || texts[0] != "source text" || strings.Contains(texts[0], "OFFICE_CODES") {
			t.Fatalf("embedding input includes provenance refs: %#v", texts)
		}
	default:
		t.Fatal("embedding input was not captured")
	}
	inspected, err := svc.InspectAgentSource(context.Background(), "account-1", scopeID, snapshot)
	if err != nil || inspected.Status != "building" || inspected.Generation != building.Generation || inspected.PartitionIdentity != building.PartitionIdentity || inspected.UnitCount != 1 || inspected.OmissionCount != 1 {
		t.Fatalf("building inspection = %#v, err=%v", inspected, err)
	}
	close(release)
	deadline := time.Now().Add(2 * time.Second)
	for {
		inspected, err = svc.InspectAgentSource(context.Background(), "account-1", scopeID, snapshot)
		if err == nil && inspected.Status == "ready" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("terminal inspection = %#v, err=%v", inspected, err)
		}
		time.Sleep(10 * time.Millisecond)
	}
	if inspected.Generation != building.Generation || inspected.ScopeID != scopeID || inspected.SnapshotIdentity != snapshot {
		t.Fatalf("terminal generation changed binding = %#v", inspected)
	}
}

func newSourceTestService(t *testing.T) (*Service, func()) {
	t.Helper()
	svc, err := NewV1Owner(nil, config.Config{LocalStatePath: filepath.Join(t.TempDir(), "runtime.db")})
	if err != nil {
		t.Fatalf("NewV1Owner: %v", err)
	}
	return svc, func() {
		if err := svc.Close(); err != nil {
			t.Fatalf("Close: %v", err)
		}
	}
}
