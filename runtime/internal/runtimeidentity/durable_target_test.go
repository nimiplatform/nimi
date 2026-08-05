package runtimeidentity

import "testing"

func TestValidateDurableTargetRefExactCanonicalGrammar(t *testing.T) {
	t.Parallel()

	valid := map[string]*Target{
		"local profile binding": {Local: &LocalTarget{ProfileBindingID: "profile-binding-1"}},
		"local readiness ref":   {Local: &LocalTarget{ReadinessRef: "readiness-1"}},
		"cloud":                 canonicalCloudTargetRef(),
	}
	for name, targetRef := range valid {
		t.Run("valid "+name, func(t *testing.T) {
			if err := ValidateDurableTargetRef(targetRef); err != nil {
				t.Fatalf("ValidateDurableTargetRef: %v", err)
			}
		})
	}

	invalid := map[string]*Target{
		"nil":                         nil,
		"empty discriminant":          {},
		"both variants":               {Local: &LocalTarget{ReadinessRef: "ready"}, Cloud: canonicalCloudTargetRef().Cloud},
		"nil local payload":           {Local: nil},
		"empty local profile binding": {Local: &LocalTarget{}},
		"both local refs":             {Local: &LocalTarget{ProfileBindingID: "profile", ReadinessRef: "ready"}},
		"padded local profile":        {Local: &LocalTarget{ProfileBindingID: " profile"}},
		"padded local readiness":      {Local: &LocalTarget{ReadinessRef: "ready "}},
		"padded connector": func() *Target {
			ref := canonicalCloudTargetRef()
			ref.Cloud.ConnectorID = " connector-1"
			return ref
		}(),
		"padded remote catalog": func() *Target {
			ref := canonicalCloudTargetRef()
			ref.Cloud.RemoteModelCatalogID = "remote-catalog-1 "
			return ref
		}(),
		"padded provider model": func() *Target {
			ref := canonicalCloudTargetRef()
			ref.Cloud.ProviderModelID = " provider-model-1"
			return ref
		}(),
		"padded provider": func() *Target {
			ref := canonicalCloudTargetRef()
			ref.Cloud.Provider = "provider-1 "
			return ref
		}(),
	}
	for name, targetRef := range invalid {
		t.Run("invalid "+name, func(t *testing.T) {
			if err := ValidateDurableTargetRef(targetRef); err == nil {
				t.Fatal("ValidateDurableTargetRef accepted noncanonical target")
			}
		})
	}
}

func canonicalCloudTargetRef() *Target {
	return &Target{Cloud: &CloudTarget{
		ConnectorID:          "connector-1",
		RemoteModelCatalogID: "remote-catalog-1",
		ProviderModelID:      "provider-model-1",
		Provider:             "provider-1",
	}}
}
