package main

import (
	"os"
	"testing"
)

func TestResolveProviderRawVoiceWorkflowUsesCatalogWorkflowModel(t *testing.T) {
	workflowModelID, targetModelID, err := resolveProviderRawVoiceWorkflow(&aiGoldFixture{
		Provider:      "dashscope",
		ModelID:       "qwen3-tts-vd",
		TargetModelID: "qwen3-tts-vd-2026-01-26",
	}, "text_description")
	if err != nil {
		t.Fatalf("resolveProviderRawVoiceWorkflow: %v", err)
	}
	if workflowModelID != "qwen-voice-design" {
		t.Fatalf("workflowModelID mismatch: %q", workflowModelID)
	}
	if targetModelID != "qwen3-tts-vd-2026-01-26" {
		t.Fatalf("targetModelID mismatch: %q", targetModelID)
	}
}

func writeTempAIGoldFixture(t *testing.T, contents string) string {
	t.Helper()
	file, err := os.CreateTemp(t.TempDir(), "ai-gold-fixture-*.yaml")
	if err != nil {
		t.Fatalf("create temp fixture: %v", err)
	}
	if _, err := file.WriteString(contents + "\n"); err != nil {
		_ = file.Close()
		t.Fatalf("write temp fixture: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("close temp fixture: %v", err)
	}
	return file.Name()
}

func TestExtractActionHintFromTextHandlesEmptyMarker(t *testing.T) {
	if got := extractActionHintFromText("RUNTIME_FAILED actionHint="); got != "" {
		t.Fatalf("expected empty action hint, got %q", got)
	}
}
