package ai

import (
	"context"
	"io"
	"log/slog"
	"slices"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

type deviceReadAIConfigResolver struct {
	missingLoadoutProjectionResolver
	samples int64
	seen    []int64
}

func (r *deviceReadAIConfigResolver) ProjectSelectedLocalLoadout(ctx context.Context, contract string) (localexecution.LoadoutOption, bool, error) {
	profile, err := localexecution.ReadProjectionDeviceProfile(ctx, func(context.Context) (*runtimev1.LocalDeviceProfile, error) {
		r.samples++
		return &runtimev1.LocalDeviceProfile{AvailableRamBytes: r.samples}, nil
	})
	if err != nil {
		return localexecution.LoadoutOption{}, false, err
	}
	r.seen = append(r.seen, profile.GetAvailableRamBytes())
	profile.AvailableRamBytes = -1
	return r.missingLoadoutProjectionResolver.ProjectSelectedLocalLoadout(ctx, contract)
}

func TestAppAIConfigReadUsesOneFreshDeviceProjectionPass(t *testing.T) {
	s := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	config := appAIConfig("app.device-projection", localAppAIConfigIntent("text.generate"), localAppAIConfigIntent("image.generate"))
	if _, err := s.OverwriteAppAIConfig(protectedAppAIConfigPrincipalContext("account-a", "app.device-projection"), &runtimev1.OverwriteAppAIConfigRequest{Config: config, ExpectedRevision: "0"}); err != nil {
		t.Fatal(err)
	}
	resolver := &deviceReadAIConfigResolver{}
	s.SetLocalExecutionResolver(resolver)
	ctx := localAppAIConfigContext("account-a", "app.device-projection", accountservice.LocalAppOperationAppAIConfigRead)
	for range 2 {
		response, err := s.GetAppAIConfig(ctx, &runtimev1.GetAppAIConfigRequest{})
		if err != nil || len(response.GetEffectiveSelections()) != 2 {
			t.Fatalf("read = %+v, %v", response, err)
		}
	}
	if resolver.samples != 2 || !slices.Equal(resolver.seen, []int64{1, 1, 2, 2}) {
		t.Fatalf("samples=%d, capability facts=%v", resolver.samples, resolver.seen)
	}
}
