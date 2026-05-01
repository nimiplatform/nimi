package delegation

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type echoInput struct {
	Text string `json:"text"`
}

type echoOutput struct {
	Text string `json:"text"`
}

type hiddenInput struct {
	Value string `json:"value"`
}

type hiddenOutput struct {
	Value string `json:"value"`
}

func TestGatewayDiscoversAllowedToolsOnly(t *testing.T) {
	gateway := newTestGateway(t, ProviderProfile{
		ID:            "provider-1",
		ProviderKind:  ProviderKindMCPToolProvider,
		TransportKind: TransportKindStdioCommand,
		State:         ProviderStateActive,
		Command:       "test-mcp-server",
		AllowedTools: []ToolAllowlistEntry{
			{Name: "echo"},
		},
		Timeout: time.Second,
	})

	tools, err := gateway.DiscoverTools(context.Background(), "provider-1")
	if err != nil {
		t.Fatalf("DiscoverTools returned error: %v", err)
	}
	if len(tools) != 1 {
		t.Fatalf("allowed tool count mismatch: got=%d want=1", len(tools))
	}
	if tools[0].Name != "echo" || !tools[0].Allowed {
		t.Fatalf("unexpected allowed tool descriptor: %+v", tools[0])
	}
	if tools[0].InputSchemaDigest == "" {
		t.Fatal("expected input schema digest")
	}
}

func TestGatewayRejectsUnlistedToolCall(t *testing.T) {
	gateway := newTestGateway(t, ProviderProfile{
		ID:            "provider-1",
		ProviderKind:  ProviderKindMCPToolProvider,
		TransportKind: TransportKindStdioCommand,
		State:         ProviderStateActive,
		Command:       "test-mcp-server",
		AllowedTools: []ToolAllowlistEntry{
			{Name: "echo"},
		},
		Timeout: time.Second,
	})

	_, err := gateway.CallTool(context.Background(), ToolCallRequest{
		ProviderID: "provider-1",
		ToolName:   "hidden",
		Arguments:  json.RawMessage(`{"value":"secret"}`),
	})
	if err == nil || !strings.Contains(err.Error(), "not allowlisted") {
		t.Fatalf("expected unlisted tool rejection, got %v", err)
	}
}

func TestGatewayFailsClosedOnSchemaDrift(t *testing.T) {
	gateway := newTestGateway(t, ProviderProfile{
		ID:            "provider-1",
		ProviderKind:  ProviderKindMCPToolProvider,
		TransportKind: TransportKindStdioCommand,
		State:         ProviderStateActive,
		Command:       "test-mcp-server",
		AllowedTools: []ToolAllowlistEntry{
			{Name: "echo", InputSchemaDigest: "sha256:not-current"},
		},
		Timeout: time.Second,
	})

	_, err := gateway.DiscoverTools(context.Background(), "provider-1")
	if err == nil || !strings.Contains(err.Error(), "schema drift") {
		t.Fatalf("expected schema drift failure, got %v", err)
	}
}

func TestGatewayCallToolReturnsQuarantinedEvidence(t *testing.T) {
	gateway := newTestGateway(t, ProviderProfile{
		ID:            "provider-1",
		ProviderKind:  ProviderKindMCPToolProvider,
		TransportKind: TransportKindStdioCommand,
		State:         ProviderStateActive,
		Command:       "test-mcp-server",
		AllowedTools: []ToolAllowlistEntry{
			{Name: "echo"},
		},
		Timeout: time.Second,
	})

	evidence, err := gateway.CallTool(context.Background(), ToolCallRequest{
		ProviderID: "provider-1",
		ToolName:   "echo",
		TraceID:    "trace-1",
		Arguments:  json.RawMessage(`{"text":"hello"}`),
	})
	if err != nil {
		t.Fatalf("CallTool returned error: %v", err)
	}
	if evidence.State != EvidenceStateQuarantined {
		t.Fatalf("evidence state mismatch: %s", evidence.State)
	}
	if evidence.FirewallState != FirewallStateNotEvaluated {
		t.Fatalf("firewall state mismatch: %s", evidence.FirewallState)
	}
	if evidence.ModelContextAdmitted || evidence.ProjectionAdmitted || evidence.ActionAdmitted {
		t.Fatalf("wave-2 evidence must not be admitted: %+v", evidence)
	}
	if evidence.RawMCPResult == nil {
		t.Fatal("expected raw MCP result in quarantined evidence")
	}
	if evidence.ProtocolAdapterSource != adapterSource {
		t.Fatalf("adapter source mismatch: %s", evidence.ProtocolAdapterSource)
	}
}

func TestGatewayRequiresAllowlist(t *testing.T) {
	_, err := NewGateway([]ProviderProfile{{
		ID:            "provider-1",
		ProviderKind:  ProviderKindMCPToolProvider,
		TransportKind: TransportKindStdioCommand,
		State:         ProviderStateActive,
		Command:       "test-mcp-server",
	}})
	if err == nil || !strings.Contains(err.Error(), "allowlist") {
		t.Fatalf("expected allowlist validation error, got %v", err)
	}
}

func TestSanitizedCommandEnvDropsSecrets(t *testing.T) {
	env := sanitizedCommandEnv([]string{
		"PATH=/bin",
		"HOME=/tmp/home",
		"OPENAI_API_KEY=secret",
		"AUTH_TOKEN=secret",
		"TMPDIR=/tmp",
	})
	joined := strings.Join(env, "\n")
	if strings.Contains(joined, "OPENAI_API_KEY") || strings.Contains(joined, "AUTH_TOKEN") {
		t.Fatalf("secret env leaked into MCP command env: %s", joined)
	}
	if !strings.Contains(joined, "PATH=/bin") || !strings.Contains(joined, "TMPDIR=/tmp") {
		t.Fatalf("expected operational env values, got %s", joined)
	}
}

func newTestGateway(t *testing.T, profile ProviderProfile) *Gateway {
	t.Helper()
	gateway, err := NewGateway([]ProviderProfile{profile}, WithTransportFactory(testMCPTransportFactory(t)))
	if err != nil {
		t.Fatalf("NewGateway returned error: %v", err)
	}
	return gateway
}

func testMCPTransportFactory(t *testing.T) TransportFactory {
	t.Helper()
	return func(ctx context.Context, _ ProviderProfile) (mcp.Transport, func(), error) {
		serverTransport, clientTransport := mcp.NewInMemoryTransports()
		server := mcp.NewServer(&mcp.Implementation{
			Name:    "test-mcp-server",
			Version: "0.1.0",
		}, nil)
		mcp.AddTool(server, &mcp.Tool{Name: "echo", Description: "Echo text"}, func(_ context.Context, _ *mcp.CallToolRequest, input echoInput) (*mcp.CallToolResult, echoOutput, error) {
			return nil, echoOutput{Text: input.Text}, nil
		})
		mcp.AddTool(server, &mcp.Tool{Name: "hidden", Description: "Hidden tool"}, func(_ context.Context, _ *mcp.CallToolRequest, input hiddenInput) (*mcp.CallToolResult, hiddenOutput, error) {
			return nil, hiddenOutput{Value: input.Value}, nil
		})
		serverCtx, cancel := context.WithCancel(ctx)
		done := make(chan error, 1)
		go func() {
			done <- server.Run(serverCtx, serverTransport)
		}()
		cleanup := func() {
			cancel()
			select {
			case <-done:
			case <-time.After(time.Second):
				t.Fatalf("test MCP server did not stop")
			}
		}
		return clientTransport, cleanup, nil
	}
}
