package runtimeagent

import (
	"context"
	"slices"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

type deviceReadSharedAIConfigResolver struct {
	missingSharedLoadoutProjectionResolver
	samples int64
	seen    []int64
}

func (r *deviceReadSharedAIConfigResolver) ProjectSelectedLocalLoadout(ctx context.Context, contract string) (localexecution.LoadoutOption, bool, error) {
	profile, err := localexecution.ReadProjectionDeviceProfile(ctx, func(context.Context) (*runtimev1.LocalDeviceProfile, error) {
		r.samples++
		return &runtimev1.LocalDeviceProfile{AvailableRamBytes: r.samples}, nil
	})
	if err != nil {
		return localexecution.LoadoutOption{}, false, err
	}
	r.seen = append(r.seen, profile.GetAvailableRamBytes())
	profile.AvailableRamBytes = -1
	return r.missingSharedLoadoutProjectionResolver.ProjectSelectedLocalLoadout(ctx, contract)
}

func TestSharedLocalAgentAIConfigReadUsesOneFreshDeviceProjectionPass(t *testing.T) {
	s := newSharedAIConfigTestService(t)
	ctx, requestContext := sharedAIConfigTestContext("account-a", "nimi.desktop")
	if _, err := s.OverwriteSharedLocalAgentAIConfig(ctx, &runtimev1.OverwriteSharedLocalAgentAIConfigRequest{
		Context: requestContext, ExpectedRevision: "0", Capabilities: []*runtimev1.AIConfigCapabilityIntent{sharedLocalIntent("text.generate"), sharedLocalIntent("text.embed")},
	}); err != nil {
		t.Fatal(err)
	}
	resolver := &deviceReadSharedAIConfigResolver{}
	s.SetMachineLocalExecutionResolver(resolver)
	for range 2 {
		response, err := s.GetSharedLocalAgentAIConfig(ctx, &runtimev1.GetSharedLocalAgentAIConfigRequest{Context: requestContext})
		if err != nil || len(response.GetEffectiveSelections()) != 2 {
			t.Fatalf("read = %+v, %v", response, err)
		}
	}
	if resolver.samples != 2 || !slices.Equal(resolver.seen, []int64{1, 1, 2, 2}) {
		t.Fatalf("samples=%d, capability facts=%v", resolver.samples, resolver.seen)
	}
}
