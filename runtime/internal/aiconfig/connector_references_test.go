package aiconfig

import (
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"testing"
)

func TestConnectionReferencesAreAccountScopedCurrentAndRevisionBound(t *testing.T) {
	for _, backendKind := range []string{"memory", "sqlite"} {
		t.Run(backendKind, func(t *testing.T) {
			var store Store = NewMemoryStore()
			if backendKind == "sqlite" {
				backend, err := runtimepersistence.Open(nil, t.TempDir()+"/state.json")
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = backend.Close() })
				store, err = NewSQLiteStore(backend)
				if err != nil {
					t.Fatal(err)
				}
			}
			reader := store.(ConnectorReferenceReader)
			ctx := context.Background()
			config := &runtimev1.AIConfig{Owner: appOwner("app.uninstalled"), Capabilities: []*runtimev1.AIConfigCapabilityIntent{cloudIntent(t, "image.generate")}}
			write := func(account, revision string, config *runtimev1.AIConfig) string {
				_, next, committed, err := store.Overwrite(ctx, account, revision, config)
				if err != nil || !committed {
					t.Fatalf("write: %v / %v", committed, err)
				}
				return next
			}
			revision := write("a", "0", config)
			write("b", "0", config)
			write("a", "0", &runtimev1.AIConfig{Owner: LocalAgentSubsystemOwner(), Capabilities: []*runtimev1.AIConfigCapabilityIntent{cloudIntent(t, "text.generate")}})
			first, err := reader.ConnectorReferences(ctx, "a", "connector:provider-a")
			if err != nil || len(first.References) != 2 {
				t.Fatalf("current references: %+v %v", first, err)
			}
			other, _ := reader.ConnectorReferences(ctx, "b", "connector:provider-a")
			if len(other.References) != 1 || other.Revision == first.Revision {
				t.Fatal("account isolation lost")
			}
			write("a", revision, config)
			unchanged, _ := reader.ConnectorReferences(ctx, "a", "connector:provider-a")
			if unchanged.Revision != first.Revision {
				t.Fatal("no-op changed collection revision")
			}
			config.Capabilities = nil
			write("a", revision, config)
			changed, _ := reader.ConnectorReferences(ctx, "a", "connector:provider-a")
			if len(changed.References) != 1 || changed.Revision == first.Revision {
				t.Fatal("reference removal did not invalidate snapshot")
			}
			first.References[0].CapabilityContract = "mutated"
			again, _ := reader.ConnectorReferences(ctx, "a", "connector:provider-a")
			if again.References[0].GetCapabilityContract() == "mutated" {
				t.Fatal("read mutated current owner")
			}
		})
	}
}
