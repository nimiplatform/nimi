package integration

import (
	"context"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// This opt-in upstream adapter check is not protected App acceptance. It uses
// only public documentation, without an account, token or persisted call.
func TestLiveMCPPublicDocumentation(t *testing.T) {
	if os.Getenv("NIMI_TEST_PUBLIC_MCP") != "1" {
		t.Skip("explicit public upstream check only")
	}
	s := &Service{http: &http.Client{Timeout: 30 * time.Second}}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	session, err := s.mcpSession(ctx, "https://learn.microsoft.com/api/mcp", "")
	if err != nil {
		t.Fatalf("public MCP handshake: %T %v", err, err)
	}
	if _, err := session.ListTools(ctx, nil); err != nil {
		_ = session.Close()
		t.Fatalf("public MCP discovery: %T %v", err, err)
	}
	_ = session.Close()
	target, err := s.configure(ctx, "", "", &runtimev1.PutIntegrationConnectionRequest{
		Adapter: "mcp", Endpoint: "https://learn.microsoft.com/api/mcp", DisplayName: "Public documentation diagnostic",
	}, "")
	if err != nil {
		t.Fatal(err)
	}
	op := operation(target, "microsoft_docs_search")
	if op == nil || op.Effect != "read" {
		t.Fatal("upstream did not declare the selected read operation")
	}
	result, dispatched, err := s.execute(ctx, target, op, `{"query":"Model Context Protocol client cancellation"}`, "")
	if err != nil {
		t.Fatalf("public MCP read dispatched=%v: %v", dispatched, err)
	}
	if len(result) == 0 {
		t.Fatal("empty public read result")
	}
	t.Logf("public documentation result: %d bytes", len(result))
}

func TestLiveMCPHandshakeComparison(t *testing.T) {
	if os.Getenv("NIMI_TEST_PUBLIC_MCP") != "1" {
		t.Skip("explicit public upstream check only")
	}
	for _, wrapped := range []bool{false, true} {
		name := "upstream"
		if wrapped {
			name = "nimi"
		}
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
			defer cancel()
			client := &http.Client{Timeout: 20 * time.Second}
			started := time.Now()
			var session *mcp.ClientSession
			var err error
			if wrapped {
				session, err = (&Service{http: client}).mcpSession(ctx, "https://learn.microsoft.com/api/mcp", "")
			} else {
				c := mcp.NewClient(&mcp.Implementation{Name: "Nimi Integration", Version: "1"}, &mcp.ClientOptions{MultiRoundTrip: &mcp.MultiRoundTripOptions{Disabled: true}})
				session, err = c.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: "https://learn.microsoft.com/api/mcp", HTTPClient: client, MaxRetries: -1, DisableStandaloneSSE: true, MaxEventSize: maxOutput}, nil)
			}
			if err != nil {
				t.Fatalf("initialize after %s: %v", time.Since(started).Round(time.Millisecond), err)
			}
			defer func() { _ = session.Close() }()
			tools, err := session.ListTools(ctx, nil)
			if err != nil {
				t.Fatalf("tools/list after %s: %v", time.Since(started).Round(time.Millisecond), err)
			}
			t.Logf("discovered %d tools after %s", len(tools.Tools), time.Since(started).Round(time.Millisecond))
		})
	}
}
