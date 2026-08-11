package localservice

import (
	"errors"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestDurableLocalImageMainRebindRequiresBackendAndFamilyFacts(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name     string
		previous *runtimev1.LocalAssetRecord
		next     *runtimev1.LocalAssetRecord
	}{
		{name: "both facts missing", previous: &runtimev1.LocalAssetRecord{}, next: &runtimev1.LocalAssetRecord{}},
		{name: "public engine is not backend fact", previous: &runtimev1.LocalAssetRecord{Family: "z-image", Engine: "media"}, next: &runtimev1.LocalAssetRecord{Family: "z-image", Engine: "media"}},
		{name: "previous backend missing", previous: &runtimev1.LocalAssetRecord{Family: "z-image"}, next: &runtimev1.LocalAssetRecord{Family: "z-image", Engine: "media"}},
		{name: "next family missing", previous: &runtimev1.LocalAssetRecord{Family: "z-image", Engine: "media"}, next: &runtimev1.LocalAssetRecord{Engine: "media"}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if err := validateDurableLocalImageMainRebindCompatibility(testCase.previous, testCase.next); !errors.Is(err, ErrDurableLocalTargetCapabilityMismatch) {
				t.Fatalf("unknown compatibility facts error = %v, want capability mismatch", err)
			}
		})
	}
}

func TestDurableLocalImageComponentMetadataRequiresCanonicalTupleEvenWhenEmpty(t *testing.T) {
	t.Parallel()
	engineConfig, err := structpb.NewStruct(map[string]any{"backend": "stablediffusion-ggml"})
	if err != nil {
		t.Fatalf("build engine config: %v", err)
	}
	main := &runtimev1.LocalAssetRecord{
		Kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
		Family:       "z-image",
		EngineConfig: engineConfig,
	}
	if err := ValidateDurableLocalImageComponentMetadata(main, "chat", "llm_path", "", nil); err != nil {
		t.Fatalf("canonical z-image text encoder tuple rejected: %v", err)
	}

	for _, testCase := range []struct {
		name          string
		family        string
		componentKind string
		engineSlot    string
	}{
		{name: "lora", family: "z-image", componentKind: "lora", engineSlot: "lora_path"},
		{name: "unknown slot", family: "z-image", componentKind: "chat", engineSlot: "text_encoder_path"},
		{name: "wrong kind", family: "z-image", componentKind: "vae", engineSlot: "llm_path"},
		{name: "family has no companions", family: "flux", componentKind: "chat", engineSlot: "llm_path"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			candidate := proto.Clone(main).(*runtimev1.LocalAssetRecord)
			candidate.Family = testCase.family
			err := ValidateDurableLocalImageComponentMetadata(
				candidate,
				testCase.componentKind,
				testCase.engineSlot,
				"",
				nil,
			)
			if !errors.Is(err, ErrDurableLocalTargetCapabilityMismatch) {
				t.Fatalf("unsupported executable component tuple error = %v, want capability mismatch", err)
			}
		})
	}
}
