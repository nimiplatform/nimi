package main

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/metadata"
)

func TestRunRuntimeAIReplaySubmitScenarioJobUsesProtocolEnvelope(t *testing.T) {
	service := &cmdTestRuntimeAIService{
		ttsChunks: []*runtimev1.ArtifactChunk{
			{
				ArtifactId:    "tts-1",
				MimeType:      "audio/mpeg",
				Chunk:         []byte("mp"),
				RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
				ModelResolved: "qwen3-tts-flash",
				TraceId:       "trace-tts-1",
			},
			{
				ArtifactId:    "tts-1",
				MimeType:      "audio/mpeg",
				Chunk:         []byte("3"),
				Eof:           true,
				RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
				ModelResolved: "qwen3-tts-flash",
				TraceId:       "trace-tts-1",
			},
		},
	}
	addr, shutdown := startCmdTestRuntimeAIServer(t, service)
	defer shutdown()

	fixturePath := writeTempAIGoldFixture(t, strings.TrimSpace(`
fixture_id: dashscope.audio.synthesize
capability: audio.synthesize
provider: dashscope
model_id: qwen3-tts-flash
voice_ref:
  kind: preset_voice_id
  id: Cherry
request:
  text: hello from replay
  language: zh-CN
  audio_format: mp3
expected_assertions:
  route_policy: cloud
  fallback_policy: deny
`))

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeAIReplay([]string{
			"--grpc-addr", addr,
			"--fixture", fixturePath,
			"--trace-id", "trace-cli-replay",
			"--subject-user-id", "gold-user",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeAIReplay: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal replay output: %v output=%q", unmarshalErr, output)
	}
	if got := strings.TrimSpace(asString(payload["status"])); got != "passed" {
		t.Fatalf("status mismatch: %q", got)
	}
	if got := strings.TrimSpace(asString(payload["traceId"])); got != "trace-tts-1" {
		t.Fatalf("traceId mismatch: %q", got)
	}

	md := service.mediaSubmitMetadata()
	if got := firstMD(md, "x-nimi-protocol-version"); got == "" {
		t.Fatal("x-nimi-protocol-version missing")
	}
	if got := firstMD(md, "x-nimi-participant-protocol-version"); got == "" {
		t.Fatal("x-nimi-participant-protocol-version missing")
	}
	if got := firstMD(md, "x-nimi-participant-id"); got != "nimi-cli" {
		t.Fatalf("participant-id mismatch: %q", got)
	}
	if got := firstMD(md, "x-nimi-domain"); got != "runtime.rpc" {
		t.Fatalf("domain mismatch: %q", got)
	}
	if got := firstMD(md, "x-nimi-idempotency-key"); got == "" {
		t.Fatal("idempotency-key missing")
	}
	if got := firstMD(md, "x-nimi-caller-kind"); got != "third-party-service" {
		t.Fatalf("caller-kind mismatch: %q", got)
	}
	if got := firstMD(md, "x-nimi-caller-id"); got != "nimi-cli" {
		t.Fatalf("caller-id mismatch: %q", got)
	}
	if got := firstMD(md, "x-nimi-surface-id"); got != "runtime-cli" {
		t.Fatalf("surface-id mismatch: %q", got)
	}
	if got := firstMD(md, "x-nimi-trace-id"); got != "trace-cli-replay" {
		t.Fatalf("trace-id mismatch: %q", got)
	}
	if got := firstMD(md, "x-nimi-app-id"); got != aiReplayAppID {
		t.Fatalf("app-id mismatch: %q", got)
	}
}

func TestResolveProviderRawVoiceWorkflowUsesCatalogWorkflowModel(t *testing.T) {
	workflowModelID, targetModelID, err := resolveProviderRawVoiceWorkflow(&aiGoldFixture{
		Provider:      "dashscope",
		ModelID:       "qwen3-tts-vd",
		TargetModelID: "qwen3-tts-vd-2026-01-26",
	}, "tts_t2v")
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

func (s *cmdTestRuntimeAIService) mediaSubmitMetadata() metadata.MD {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.mediaSubmitMD.Copy()
}
