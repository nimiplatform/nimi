package localservice

import (
	"context"
	"os/exec"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

func TestReadProjectionSelectedLoadoutCollectsDeviceOnce(t *testing.T) {
	svc, asset := loadoutEmbeddingFixture(t)
	prepared := prepareEmbeddingLoadoutForTest(t, svc, context.Background(), "", "Projection device test", asset)
	committed := commitLoadoutForTest(t, svc, context.Background(), prepared.GetPrepareId(), false)
	if _, err := svc.SelectLoadout(context.Background(), &runtimev1.SelectLoadoutRequest{
		CapabilityContract: capabilitydriver.TextEmbedCapabilityContract, LoadoutId: committed.GetLoadoutId(), ConfirmedMachineImpact: true,
	}); err != nil {
		t.Fatal(err)
	}
	originalLookPath := localRuntimeLookPath
	t.Cleanup(func() { localRuntimeLookPath = originalLookPath })
	probes := 0
	localRuntimeLookPath = func(name string) (string, error) {
		if name == "nvidia-smi" {
			probes++
		}
		return "", exec.ErrNotFound
	}
	project := func(ctx context.Context) {
		t.Helper()
		option, found, err := svc.ProjectSelectedLocalLoadout(ctx, capabilitydriver.TextEmbedCapabilityContract)
		if err != nil || !found || option.LoadoutID != committed.GetLoadoutId() {
			t.Fatalf("selected projection = %+v, found=%v, err=%v", option, found, err)
		}
	}
	ctx := localexecution.WithReadProjection(context.Background())
	project(ctx)
	project(ctx)
	if probes != 1 {
		t.Fatalf("one read projected the selected Loadout twice and collected %d device profiles, want 1", probes)
	}
	project(localexecution.WithReadProjection(ctx))
	if probes != 2 {
		t.Fatalf("a new read must collect current facts again, probes=%d", probes)
	}
	project(context.Background())
	if probes != 3 {
		t.Fatalf("projection outside a read pass must remain fresh, probes=%d", probes)
	}
}
