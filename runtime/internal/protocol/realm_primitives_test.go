package protocol

import (
	"errors"
	"testing"
)

func TestValidatePrimitiveContractUnknownWrapsSentinel(t *testing.T) {
	err := ValidatePrimitiveContract("missing", map[string]any{})
	if err == nil {
		t.Fatal("expected unknown contract error")
	}
	if !errors.Is(err, ErrUnknownPrimitiveContract) {
		t.Fatalf("expected ErrUnknownPrimitiveContract, got=%v", err)
	}
}

func TestValidateEconomyContractRejectsNonStringNamespace(t *testing.T) {
	err := ValidateEconomyContract(map[string]any{
		"currencyNamespace":       123,
		"transferMode":            "DIRECT",
		"settlementWindowSeconds": 120,
		"conservationRequired":    true,
		"inflationPolicy":         "FIXED_CAP",
	})
	if err == nil {
		t.Fatal("expected non-string currencyNamespace to fail")
	}
	if err.Error() != "validate economy contract: currencyNamespace must be a string" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestValidateTimeflowContractAddsOperationPrefix(t *testing.T) {
	err := ValidateTimeflowContract(map[string]any{
		"ratio":                     0,
		"tickSeconds":               10,
		"driftBudgetSecondsPerHour": 1,
		"catchUpPolicy":             "PAUSE",
		"rewindAllowed":             false,
	})
	if err == nil {
		t.Fatal("expected invalid ratio to fail")
	}
	if err.Error() != "validate timeflow contract: ratio must be > 0 and <= 1440" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestPrimitiveContractsReturnsStableContracts(t *testing.T) {
	contracts := PrimitiveContracts()
	if len(contracts) != 6 {
		t.Fatalf("unexpected contract count: %d", len(contracts))
	}
	if contracts[0].Name != "context" || contracts[len(contracts)-1].Name != "transit" {
		t.Fatalf("unexpected contract ordering: %#v", contracts)
	}
}
