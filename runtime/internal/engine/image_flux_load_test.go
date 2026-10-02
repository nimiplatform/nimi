package engine

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/managedimagebackend"
)

func TestFluxImageLoadUsesBothNamedEncoderSlots(t *testing.T) {
	root := t.TempDir()
	bindings := []capabilitydriver.InvocationExactBinding{}
	for i, id := range []string{capabilitydriver.StableDiffusionMainRequirementID, capabilitydriver.StableDiffusionTextEncoderRequirementID, capabilitydriver.StableDiffusionVAERequirementID, capabilitydriver.StableDiffusionCLIPLRequirementID} {
		digest := strings.Repeat(string(rune('a'+i)), 64)
		bindings = append(bindings, capabilitydriver.InvocationExactBinding{RequirementID: id, ModelAssetID: id, VerifiedContentID: "sha256:" + digest, EntrySHA256: digest, AbsolutePath: filepath.Join(root, id+".bin")})
	}
	plan, err := (capabilitydriver.StableDiffusionImageDriver{}).PlanImageInvocation(capabilitydriver.ImageInvocationInput{
		RecipeID: capabilitydriver.StableDiffusionFluxSchnellRecipeID, ExactBindings: bindings, Request: &runtimev1.ImageGenerateScenarioSpec{Prompt: "A boat", Size: "512x512"},
	})
	if err != nil {
		t.Fatal(err)
	}
	request, err := imageLoadRequest("127.0.0.1:9999", plan, managedimagebackend.ProtocolManagedWrapper)
	if err != nil {
		t.Fatal(err)
	}
	slots := map[string]string{}
	for _, component := range request.Components {
		slots[component.EngineSlot] = component.Path
	}
	if len(slots) != 3 || slots["t5xxl_path"] != bindings[1].AbsolutePath || slots["clip_l_path"] != bindings[3].AbsolutePath || slots["vae_path"] != bindings[2].AbsolutePath {
		t.Fatalf("encoder mapping=%v", slots)
	}
	direct, err := imageLoadRequest("127.0.0.1:9999", plan, managedimagebackend.ProtocolDirectGOSD)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(direct.DirectOptions, "\n")
	if !strings.Contains(joined, "t5xxl_path:"+bindings[1].AbsolutePath) || !strings.Contains(joined, "clip_l_path:"+bindings[3].AbsolutePath) || strings.Contains(joined, "llm_path:") {
		t.Fatalf("direct encoder mapping=%v", direct.DirectOptions)
	}

	// Exercise the actual gRPC serializer, server decoder and component
	// normalization. The model is deliberately absent: this test stops before
	// native execution and must never report a successful model load.
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	_ = listener.Close()
	executable := filepath.Join(root, "sd-server.exe")
	if err := os.WriteFile(executable, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	serverContext, stop := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- managedimagebackend.RunServer(serverContext, managedimagebackend.ServerConfig{ListenAddress: address, Driver: "stable-diffusion.cpp", BackendExecutable: executable})
	}()
	t.Cleanup(func() {
		stop()
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			t.Error("managed wrapper did not stop")
		}
	})
	request.BackendAddress = address
	callContext, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, err := managedimagebackend.LoadModel(callContext, request); err == nil || !strings.Contains(err.Error(), "managed image model path unavailable") {
		t.Fatalf("generated encoder bindings did not pass actual normalization: %v", err)
	}
	for i := range request.Components {
		if request.Components[i].EngineSlot == "clip_l_path" {
			request.Components[i].Order = 0
		}
	}
	if _, err := managedimagebackend.LoadModel(callContext, request); err == nil || !strings.Contains(err.Error(), "duplicate managed image component order") {
		t.Fatalf("duplicate encoder role/order was not rejected: %v", err)
	}
}
