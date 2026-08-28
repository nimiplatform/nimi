package grpcserver

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestMethodDescriptorMapsConnectorService(t *testing.T) {
	domain, operation, capability := methodDescriptor("/runtime.v1.RuntimeConnectorService/CreateConnector")
	if domain != "runtime.connector" {
		t.Fatalf("domain mismatch: %q", domain)
	}
	if operation != "create_connector" {
		t.Fatalf("operation mismatch: %q", operation)
	}
	if capability != "runtime.connector.create_connector" {
		t.Fatalf("capability mismatch: %q", capability)
	}
}

func TestMethodDescriptorMapsRealtimeServiceToRuntimeAI(t *testing.T) {
	domain, operation, capability := methodDescriptor("/nimi.runtime.v1.RuntimeAiRealtimeService/ReadRealtimeEvents")
	if domain != "runtime.ai" {
		t.Fatalf("domain mismatch: %q", domain)
	}
	if operation != "read_realtime_events" {
		t.Fatalf("operation mismatch: %q", operation)
	}
	if capability != "runtime.ai.read_realtime_events" {
		t.Fatalf("capability mismatch: %q", capability)
	}
}

func TestCloneUsageReturnsTypedClone(t *testing.T) {
	input := &runtimev1.UsageStats{InputTokens: 12}
	cloned := cloneUsage(input)
	if cloned == nil {
		t.Fatal("expected cloned usage")
	}
	if cloned == input {
		t.Fatal("expected clone to allocate a distinct struct")
	}
	if cloned.GetInputTokens() != 12 {
		t.Fatalf("usage mismatch: %d", cloned.GetInputTokens())
	}
}

func TestCamelToSnakeKeepsAcronymsGrouped(t *testing.T) {
	if got := camelToSnake("ReadAIEvents"); got != "read_ai_events" {
		t.Fatalf("unexpected snake case: %q", got)
	}
	if got := camelToSnake("GetHTTPURL"); got != "get_httpurl" {
		t.Fatalf("unexpected acronym handling: %q", got)
	}
}
