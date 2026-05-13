package grpcserver

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// G3.1 / S2.22 — Wave-2 anti-target: grpcserver/server.go must
// register `RuntimeCognitionService` exactly once, and the wave's
// edits must not introduce any new `RegisterXxxServiceServer` call
// alongside that registration. This is the static check that the
// L9 anti-target "internal RPC exposes typed scope registry" cannot
// silently land.
func TestServerRegistersRuntimeCognitionServiceExactlyOnce(t *testing.T) {
	raw, err := os.ReadFile("server.go")
	if err != nil {
		t.Fatalf("read server.go: %v", err)
	}
	text := string(raw)

	cognitionRegistrations := strings.Count(text, "RegisterRuntimeCognitionServiceServer(")
	if cognitionRegistrations != 1 {
		t.Fatalf("expected exactly 1 RegisterRuntimeCognitionServiceServer call, got %d", cognitionRegistrations)
	}

	// The legacy RuntimeKnowledgeService must never be registered.
	if strings.Contains(text, "RegisterRuntimeKnowledgeServiceServer(") {
		t.Fatalf("server.go must not register the retired RuntimeKnowledgeService")
	}

	// The wave-2 anti-target list bans new internal Register calls
	// landing alongside this wave. The exhaustive set of registrations
	// in server.go is allow-listed below; any new
	// `Register*ServiceServer` token must be added here intentionally
	// and reviewed against the wave-2 packet.
	allowed := map[string]struct{}{
		"RegisterRuntimeAccountServiceServer":    {},
		"RegisterRuntimeAgentServiceServer":      {},
		"RegisterRuntimeAiRealtimeServiceServer": {},
		"RegisterRuntimeAiServiceServer":         {},
		"RegisterRuntimeAppServiceServer":        {},
		"RegisterRuntimeArtifactServiceServer":   {},
		"RegisterRuntimeAuditServiceServer":      {},
		"RegisterRuntimeAuthServiceServer":       {},
		"RegisterRuntimeCognitionServiceServer":  {},
		"RegisterRuntimeConnectorServiceServer":  {},
		"RegisterRuntimeGrantServiceServer":      {},
		"RegisterRuntimeLocalServiceServer":      {},
		"RegisterRuntimeModelServiceServer":      {},
		"RegisterRuntimeWorkflowServiceServer":   {},
	}
	tokens := scanRegisterTokens(text)
	for token := range tokens {
		if _, ok := allowed[token]; !ok {
			t.Fatalf("unexpected new gRPC registration token in server.go: %s — update the allow-list deliberately if this is admitted", token)
		}
	}
}

func scanRegisterTokens(text string) map[string]int {
	tokens := map[string]int{}
	re := regexp.MustCompile(`\bRegister[A-Z][A-Za-z]*ServiceServer\b`)
	for _, match := range re.FindAllString(text, -1) {
		tokens[match]++
	}
	return tokens
}
