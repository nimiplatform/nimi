package runtimeidentity

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestValidateDurableTargetRefExactCanonicalGrammar(t *testing.T) {
	t.Parallel()

	valid := map[string]*runtimev1.RuntimeDurableTargetRef{
		"local profile binding": {
			Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{LocalRuntime: &runtimev1.RuntimeDurableLocalTargetRef{
				Version: "v2",
				Ref:     &runtimev1.RuntimeDurableLocalTargetRef_ProfileBindingId{ProfileBindingId: "profile-binding-1"},
			}},
		},
		"local readiness ref": {
			Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{LocalRuntime: &runtimev1.RuntimeDurableLocalTargetRef{
				Version: "v2",
				Ref:     &runtimev1.RuntimeDurableLocalTargetRef_ReadinessRef{ReadinessRef: "readiness-1"},
			}},
		},
		"cloud": canonicalCloudTargetRef(),
	}
	for name, targetRef := range valid {
		targetRef := targetRef
		t.Run("valid "+name, func(t *testing.T) {
			if err := ValidateDurableTargetRef(targetRef); err != nil {
				t.Fatalf("ValidateDurableTargetRef: %v", err)
			}
		})
	}

	invalid := map[string]*runtimev1.RuntimeDurableTargetRef{
		"nil":                         nil,
		"empty discriminant":          {},
		"nil local payload":           {Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{}},
		"padded local version":        localProfileTargetRef(" v2", "profile-binding-1"),
		"wrong local version":         localProfileTargetRef("v1", "profile-binding-1"),
		"empty local profile binding": localProfileTargetRef("v2", ""),
		"padded local profile":        localProfileTargetRef("v2", " profile-binding-1"),
		"padded local readiness": {
			Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{LocalRuntime: &runtimev1.RuntimeDurableLocalTargetRef{
				Version: "v2",
				Ref:     &runtimev1.RuntimeDurableLocalTargetRef_ReadinessRef{ReadinessRef: "readiness-1 "},
			}},
		},
		"nil cloud payload": {Target: &runtimev1.RuntimeDurableTargetRef_Cloud{}},
		"padded cloud version": func() *runtimev1.RuntimeDurableTargetRef {
			ref := canonicalCloudTargetRef()
			ref.GetCloud().Version = "v2 "
			return ref
		}(),
		"padded connector": func() *runtimev1.RuntimeDurableTargetRef {
			ref := canonicalCloudTargetRef()
			ref.GetCloud().ConnectorId = " connector-1"
			return ref
		}(),
		"padded remote catalog": func() *runtimev1.RuntimeDurableTargetRef {
			ref := canonicalCloudTargetRef()
			ref.GetCloud().RemoteModelCatalogId = "remote-catalog-1 "
			return ref
		}(),
		"padded provider model": func() *runtimev1.RuntimeDurableTargetRef {
			ref := canonicalCloudTargetRef()
			ref.GetCloud().ProviderModelId = " provider-model-1"
			return ref
		}(),
		"padded provider": func() *runtimev1.RuntimeDurableTargetRef {
			ref := canonicalCloudTargetRef()
			ref.GetCloud().Provider = "provider-1 "
			return ref
		}(),
	}
	for name, targetRef := range invalid {
		targetRef := targetRef
		t.Run("invalid "+name, func(t *testing.T) {
			if err := ValidateDurableTargetRef(targetRef); err == nil {
				t.Fatal("ValidateDurableTargetRef accepted noncanonical target")
			}
		})
	}
}

func localProfileTargetRef(version string, profileBindingID string) *runtimev1.RuntimeDurableTargetRef {
	return &runtimev1.RuntimeDurableTargetRef{Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{LocalRuntime: &runtimev1.RuntimeDurableLocalTargetRef{
		Version: version,
		Ref:     &runtimev1.RuntimeDurableLocalTargetRef_ProfileBindingId{ProfileBindingId: profileBindingID},
	}}}
}

func canonicalCloudTargetRef() *runtimev1.RuntimeDurableTargetRef {
	return &runtimev1.RuntimeDurableTargetRef{Target: &runtimev1.RuntimeDurableTargetRef_Cloud{Cloud: &runtimev1.RuntimeDurableCloudTargetRef{
		Version:              "v2",
		ConnectorId:          "connector-1",
		RemoteModelCatalogId: "remote-catalog-1",
		ProviderModelId:      "provider-model-1",
		Provider:             "provider-1",
	}}}
}
