package spendvisibility

import "fmt"

// ExecutionInput captures the typed inputs that the spend projection
// considers when deciding whether to surface a pre-execution
// disclosure.
type ExecutionInput struct {
	CapabilityID  string
	RoutingPolicy string
	IsCloudRoute  bool
	CostHint      *CostHint
	BillingScope  string
	PolicyVersion string
}

// CostHint is an optional typed input from upstream catalog/usage
// metrics. When nil, the projection emits EstimateAvailable=false so
// the surface can render "unknown spend" rather than fabricating.
type CostHint struct {
	Currency string
	Amount   float64
}

// Project builds the typed SpendDisclosure for the given execution
// input. Per Wave 5 close-require, the disclosure is what UI shows
// BEFORE the AI call begins. Fail-closed: any unknown category or
// missing required input returns an error.
func Project(input ExecutionInput) (SpendDisclosure, error) {
	if input.CapabilityID == "" {
		return SpendDisclosure{}, fmt.Errorf("spendvisibility Project: %w (capability_id)", ErrSpendInputRequired)
	}
	category := categorizeCapability(input.CapabilityID, input.IsCloudRoute)
	if !category.Valid() {
		return SpendDisclosure{}, fmt.Errorf("spendvisibility Project: %w: %q", ErrSpendUnknownCategory, string(category))
	}
	disclosure := SpendDisclosure{
		Category:      category,
		BillingScope:  input.BillingScope,
		PolicyVersion: input.PolicyVersion,
	}
	if category == SpendCategoryLocalZero {
		disclosure.EstimateAvailable = true
		disclosure.EstimateCurrency = ""
		disclosure.EstimateAmount = 0
		return disclosure, nil
	}
	if input.CostHint != nil && input.CostHint.Currency != "" {
		disclosure.EstimateAvailable = true
		disclosure.EstimateCurrency = input.CostHint.Currency
		disclosure.EstimateAmount = input.CostHint.Amount
		return disclosure, nil
	}
	// Policy required disclosure but no cost hint: emit unknown spend so
	// the surface can render the unknown state rather than fabricate.
	disclosure.EstimateAvailable = false
	disclosure.Detail = "spend estimate not available; user must accept unknown-cost disclosure before execution"
	return disclosure, nil
}

func categorizeCapability(capabilityID string, isCloudRoute bool) SpendCategory {
	if !isCloudRoute {
		return SpendCategoryLocalZero
	}
	switch {
	case startsWith(capabilityID, "text."):
		return SpendCategoryCloudText
	case startsWith(capabilityID, "image."):
		return SpendCategoryCloudImage
	case startsWith(capabilityID, "video."):
		return SpendCategoryCloudVideo
	case startsWith(capabilityID, "audio."):
		return SpendCategoryCloudAudio
	}
	return SpendCategory("")
}

func startsWith(s, prefix string) bool {
	return len(s) >= len(prefix) && s[:len(prefix)] == prefix
}
