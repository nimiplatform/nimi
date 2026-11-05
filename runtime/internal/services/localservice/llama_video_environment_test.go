package localservice

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestUnifiedLlamaMissingCodecKeepsTypedRepairReason(t *testing.T) {
	_, err := newTestService(t).captureLlamaMediaCodecSource(context.Background())
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_MEDIA_CODEC_UNAVAILABLE {
		t.Fatalf("missing codec reason = %v, error = %v", reason, err)
	}
}

func TestUnifiedLlamaEnvironmentIncludesSeparateManagedCodecConsumer(t *testing.T) {
	svc := newTestService(t)
	request := localEnvironmentPlanRequest{PackID: "local-text", ConsumerScope: "llama.cpp.metal", HostProfile: localEnvironmentAppleSilicon128GBProfile()}
	base, err := svc.resolveLocalEnvironmentPlan(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	request.IncludeMediaCodec = true
	media, err := svc.resolveLocalEnvironmentPlan(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, dep := range media.Dependencies {
		if dep.DependencyFamily == localEnvironmentFamilyMediaCodec {
			found = true
			if dep.ConsumerScope != "media-codec" || !dep.Required || !dep.ConfirmationRequired {
				t.Fatalf("codec preparation=%+v", dep)
			}
		}
	}
	if !found || base.PlanID == media.PlanID {
		t.Fatal("codec missing from preparation identity")
	}
}
