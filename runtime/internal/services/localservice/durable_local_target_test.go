package localservice

import (
	"errors"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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
