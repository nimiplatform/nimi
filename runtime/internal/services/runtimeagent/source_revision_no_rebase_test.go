package runtimeagent

import (
	"context"
	"path/filepath"
	"reflect"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestSourceRevisionMaterializesWithoutRebasingExistingLocalAgent(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "state.json")
	service, closeService := openSourceMaterializationTransportTestService(t, statePath)
	defer closeService()
	service.SetSourceMaterializationProductCommitter(service)

	firstCandidate := sourceMaterializationTransportTestCandidateWithPresentation(
		t,
		"worldCharacter",
		"packet-source-revision-first",
		"Mira revision one",
	)
	first := materializeProductionSourceProductCandidate(t, service, firstCandidate, "source-revision-first")
	firstSnapshotBefore, found, err := service.sourceMaterializationRepo.sourceSnapshot(context.Background(), first.commit.GetLocalAgentRef())
	if err != nil || !found {
		t.Fatalf("read first source snapshot before revision: found=%v err=%v", found, err)
	}

	secondCandidate := sourceMaterializationTransportTestCandidateWithPresentation(
		t,
		"worldCharacter",
		"packet-source-revision-second",
		"Mira revision two",
	)
	if firstCandidate.Normalized.SourceRef.Kind != secondCandidate.Normalized.SourceRef.Kind ||
		firstCandidate.Normalized.SourceRef.WorldID != secondCandidate.Normalized.SourceRef.WorldID ||
		firstCandidate.Normalized.SourceRef.SourceID != secondCandidate.Normalized.SourceRef.SourceID {
		t.Fatalf("source revision fixture changed source identity: first=%+v second=%+v", firstCandidate.Normalized.SourceRef, secondCandidate.Normalized.SourceRef)
	}
	if firstCandidate.Normalized.SourceRef.SourceContentHash == secondCandidate.Normalized.SourceRef.SourceContentHash {
		t.Fatal("source revision fixture did not change source_content_hash")
	}
	second := materializeProductionSourceProductCandidate(t, service, secondCandidate, "source-revision-second")
	if first.commit.GetLocalAgentRef() == second.commit.GetLocalAgentRef() {
		t.Fatalf("new source revision reused existing LocalAgent ref %q", first.commit.GetLocalAgentRef())
	}

	assertSourceRevisionAgents(t, service, first, second, firstSnapshotBefore)
	t.Log("CHECKPOINT old-agent-stays-pinned")
	t.Log("CHECKPOINT new-revision-isolated")

	closeService()
	restarted, closeRestarted := openSourceMaterializationTransportTestService(t, statePath)
	defer closeRestarted()
	assertSourceRevisionAgents(t, restarted, first, second, firstSnapshotBefore)
	t.Log("CHECKPOINT source-revision-restart-continuity")
}

func assertSourceRevisionAgents(
	t *testing.T,
	service *Service,
	first *atomicSourceProduct,
	second *atomicSourceProduct,
	firstSnapshotBefore localAgentSourceSnapshotV1,
) {
	t.Helper()
	firstSnapshotAfter, found, err := service.sourceMaterializationRepo.sourceSnapshot(context.Background(), first.commit.GetLocalAgentRef())
	if err != nil || !found {
		t.Fatalf("read first source snapshot after revision: found=%v err=%v", found, err)
	}
	if !reflect.DeepEqual(firstSnapshotAfter, firstSnapshotBefore) {
		t.Fatalf("existing LocalAgent snapshot rebased: before=%+v after=%+v", firstSnapshotBefore, firstSnapshotAfter)
	}
	secondSnapshot, found, err := service.sourceMaterializationRepo.sourceSnapshot(context.Background(), second.commit.GetLocalAgentRef())
	if err != nil || !found {
		t.Fatalf("read second source snapshot: found=%v err=%v", found, err)
	}
	if secondSnapshot.SnapshotHash == firstSnapshotAfter.SnapshotHash {
		t.Fatalf("new revision reused old snapshot hash %q", secondSnapshot.SnapshotHash)
	}

	firstAgent, err := service.GetAgent(context.Background(), &runtimev1.GetAgentRequest{
		Context: first.agentContext,
		AgentId: first.commit.GetLocalAgentRef(),
	})
	if err != nil {
		t.Fatalf("read first LocalAgent after revision: %v", err)
	}
	secondAgent, err := service.GetAgent(context.Background(), &runtimev1.GetAgentRequest{
		Context: second.agentContext,
		AgentId: second.commit.GetLocalAgentRef(),
	})
	if err != nil {
		t.Fatalf("read second LocalAgent after revision: %v", err)
	}
	if firstAgent.GetAgent().GetDisplayName() != "Mira revision one" {
		t.Fatalf("existing LocalAgent presentation rebased to %q", firstAgent.GetAgent().GetDisplayName())
	}
	if secondAgent.GetAgent().GetDisplayName() != "Mira revision two" {
		t.Fatalf("new revision presentation = %q", secondAgent.GetAgent().GetDisplayName())
	}
}
