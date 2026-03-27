package protocol

import (
	"errors"
	"math"
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

func TestPrimitiveContractByNameFindsCachedContract(t *testing.T) {
	contract, ok := PrimitiveContractByName("timeflow")
	if !ok {
		t.Fatal("expected timeflow contract to be present")
	}
	if contract.Name != "timeflow" {
		t.Fatalf("unexpected contract: %#v", contract)
	}
}

func TestValidateTimeflowContractRejectsFloatOverflow(t *testing.T) {
	_, err := intField(map[string]any{
		"tickSeconds": float64(maxPlatformInt) * 2,
	}, "tickSeconds")
	if err == nil {
		t.Fatal("expected overflow to fail")
	}
	if err.Error() != "tickSeconds must be within the supported integer range" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestValidateTimeflowContractRejectsInt64Overflow(t *testing.T) {
	currentMax := int64(maxPlatformInt)
	if currentMax == math.MaxInt64 {
		t.Skip("int64 overflow path is unreachable when int is already 64-bit")
	}

	_, err := intField(map[string]any{
		"tickSeconds": currentMax + 1,
	}, "tickSeconds")
	if err == nil {
		t.Fatal("expected int64 overflow to fail")
	}
	if err.Error() != "tickSeconds must be within the supported integer range" {
		t.Fatalf("unexpected error: %v", err)
	}
}
