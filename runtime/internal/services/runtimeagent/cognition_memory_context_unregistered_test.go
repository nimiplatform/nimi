package runtimeagent

import (
	"strings"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
)

func TestCognitionMemoryHitsMapToWholeAdvisoryItems(t *testing.T) {
	hits := []memoryv1.Memory{{
		MemoryRef: "memory-a", BankRef: "bank-a", Content: "The user prefers jasmine tea",
		EpistemicStatus: memoryv1.EpistemicExplicit, Lifecycle: memoryv1.LifecycleCurrent,
		OccurredAt: time.Now(), UpdatedAt: time.Now(), SourceExplanation: "Committed user message", EventRef: "event-a",
	}, {
		MemoryRef: "memory-b", BankRef: "bank-a", Content: "The user may enjoy quiet mornings",
		EpistemicStatus: memoryv1.EpistemicInferred, Lifecycle: memoryv1.LifecycleCurrent,
		OccurredAt: time.Now(), UpdatedAt: time.Now(), SourceExplanation: "Committed interaction inference", EventRef: "event-b",
	}}
	inputs, err := publicChatCognitionMemoryInputs(hits)
	if err != nil || len(inputs) != 2 {
		t.Fatalf("map Cognition Memory hits: inputs=%+v err=%v", inputs, err)
	}
	if inputs[0].Scope != "agent_private" || inputs[0].ProvenanceRef != "event-a" || inputs[0].RelevanceRank <= inputs[1].RelevanceRank {
		t.Fatalf("Memory scope/provenance/rank changed: %+v", inputs)
	}
	if !strings.Contains(inputs[0].Text, "current request") || !strings.Contains(inputs[0].Text, "epistemic_status") || !strings.Contains(inputs[0].Text, "The user prefers jasmine tea") {
		t.Fatalf("advisory priority or complete item was lost: %q", inputs[0].Text)
	}
	hits[0].Lifecycle = memoryv1.LifecycleForgotten
	if _, err := publicChatCognitionMemoryInputs(hits); err == nil {
		t.Fatal("forgotten Memory entered the context lane")
	}
}
