package protocol

import (
	"errors"
	"slices"
	"testing"
)

func TestRealmPrimitiveContractSkeletonCoverage(t *testing.T) {
	contracts := PrimitiveContracts()
	names := make([]string, 0, len(contracts))
	coverage := make(map[string]PrimitiveCoverage, len(contracts))
	for _, contract := range contracts {
		names = append(names, contract.Name)
		coverage[contract.Name] = contract.Coverage
		if len(contract.RequiredFields) == 0 {
			t.Fatalf("%s must declare required fields", contract.Name)
		}
	}

	wantNames := []string{"context", "economy", "presence", "social", "timeflow", "transit"}
	if !slices.Equal(names, wantNames) {
		t.Fatalf("unexpected primitive contracts: got=%v want=%v", names, wantNames)
	}

	if coverage["timeflow"] != PrimitiveCoverageCovered {
		t.Fatalf("timeflow coverage = %s, want %s", coverage["timeflow"], PrimitiveCoverageCovered)
	}
	if coverage["economy"] != PrimitiveCoverageCovered {
		t.Fatalf("economy coverage = %s, want %s", coverage["economy"], PrimitiveCoverageCovered)
	}
	for _, name := range []string{"social", "transit", "context", "presence"} {
		if coverage[name] != PrimitiveCoveragePartial {
			t.Fatalf("%s coverage = %s, want %s", name, coverage[name], PrimitiveCoveragePartial)
		}
	}
}

func TestValidateTimeflowContractAcceptsCanonicalPayload(t *testing.T) {
	err := ValidateTimeflowContract(map[string]any{
		"ratio":                     24.0,
		"tickSeconds":               60,
		"driftBudgetSecondsPerHour": 12,
		"catchUpPolicy":             "PAUSE",
		"rewindAllowed":             false,
	})
	if err != nil {
		t.Fatalf("ValidateTimeflowContract() unexpected error: %v", err)
	}
}

func TestValidateTimeflowContractRejectsInvalidDriftBudget(t *testing.T) {
	err := ValidateTimeflowContract(map[string]any{
		"ratio":                     1.0,
		"tickSeconds":               5,
		"driftBudgetSecondsPerHour": 121,
		"catchUpPolicy":             "FAST_FORWARD",
		"rewindAllowed":             false,
	})
	if err == nil || err.Error() != "driftBudgetSecondsPerHour must be in [0, 120]" {
		t.Fatalf("ValidateTimeflowContract() error = %v", err)
	}
}

func TestValidateEconomyContractAcceptsCanonicalPayload(t *testing.T) {
	err := ValidateEconomyContract(map[string]any{
		"currencyNamespace":       "nimi.spark",
		"transferMode":            "ESCROW",
		"settlementWindowSeconds": 600,
		"conservationRequired":    true,
		"inflationPolicy":         "FIXED_CAP",
	})
	if err != nil {
		t.Fatalf("ValidateEconomyContract() unexpected error: %v", err)
	}
}

func TestValidateEconomyContractRejectsNonConservingPayload(t *testing.T) {
	err := ValidateEconomyContract(map[string]any{
		"currencyNamespace":       "nimi.spark",
		"transferMode":            "DIRECT",
		"settlementWindowSeconds": 60,
		"conservationRequired":    false,
		"inflationPolicy":         "PROGRAMMATIC",
	})
	if err == nil || err.Error() != "conservationRequired must be true in V0.1" {
		t.Fatalf("ValidateEconomyContract() error = %v", err)
	}
}

func TestValidatePrimitiveContractReturnsSkeletonErrorForDeferredPrimitive(t *testing.T) {
	err := ValidatePrimitiveContract("social", map[string]any{})
	if !errors.Is(err, ErrPrimitiveContractNotImplemented) {
		t.Fatalf("ValidatePrimitiveContract() error = %v, want ErrPrimitiveContractNotImplemented", err)
	}
}
