package localservice

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestProjectionReasonCodeMapsImageComponentCompatibilityDetail(t *testing.T) {
	reason := projectionReasonCodeForEngine("media", `slot "vae_path" asset family "flux1-vae" is not compatible with main image family "z-image-turbo"`)
	if reason != runtimev1.ReasonCode_AI_LOCAL_COMPONENT_INCOMPATIBLE {
		t.Fatalf("reason = %s, want %s", reason, runtimev1.ReasonCode_AI_LOCAL_COMPONENT_INCOMPATIBLE)
	}
}
