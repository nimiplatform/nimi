package capabilitydriver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"testing"
)

func TestIdeogram45AdmissionPreservesNativeControls(t *testing.T) {
	d, target := cloudMediaDriverTarget(t, "ideogram", Ideogram45Model, "image.generate")
	for _, s := range []*runtimev1.ImageGenerateScenarioSpec{
		{Prompt: "poster", Seed: proto.Int64(0), N: proto.Int32(4), Quality: "high", Size: "2048x2048"},
		{Prompt: "edit", ReferenceImageArtifactId: "owned", Quality: "very_low", Size: "source"},
		{Prompt: "edit", ReferenceImageArtifactId: "owned", MaskArtifactId: "mask"},
	} {
		if _, err := d.MapRequest(target, geminiImageRequest(s), nil, CloudMediaStreamNone); err != nil {
			t.Fatal(s, err)
		}
	}
	for _, s := range []*runtimev1.ImageGenerateScenarioSpec{
		{Prompt: "poster", Size: "source"}, {Prompt: "poster", Size: "999x1024"}, {Prompt: "poster", Size: "4096x4096"},
		{Prompt: "poster", Seed: proto.Int64(-1)}, {Prompt: "poster", Quality: "very_low"}, {Prompt: "poster", AspectRatio: "1:1"},
		{Prompt: "edit", ReferenceImageArtifactId: "owned", MaskArtifactId: "mask", Size: "auto"},
		{Prompt: "edit", ReferenceImages: []string{"https://media.example/source.png"}, MaskArtifactId: "mask"},
		{Prompt: "edit", ReferenceImageArtifactId: "owned", MaskArtifactId: "mask", Strength: proto.Float32(0.5)},
	} {
		if _, err := d.MapRequest(target, geminiImageRequest(s), nil, CloudMediaStreamNone); err == nil {
			t.Fatal("ignored input admitted", s)
		}
	}
}
