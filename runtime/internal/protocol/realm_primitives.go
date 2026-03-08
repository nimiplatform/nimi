package protocol

import (
	"errors"
	"fmt"
	"sort"
	"strings"
)

type PrimitiveCoverage string

const (
	PrimitiveCoverageCovered PrimitiveCoverage = "COVERED"
	PrimitiveCoveragePartial PrimitiveCoverage = "PARTIAL"
)

var ErrPrimitiveContractNotImplemented = errors.New("primitive contract not implemented")

type PrimitiveContract struct {
	Name           string
	RequiredFields []string
	Coverage       PrimitiveCoverage
}

var primitiveContracts = map[string]PrimitiveContract{
	"context": {
		Name:           "context",
		RequiredFields: []string{"contextScope", "retentionTtlSeconds", "injectionPriority", "truncationPolicy", "handoffPolicy"},
		Coverage:       PrimitiveCoveragePartial,
	},
	"economy": {
		Name:           "economy",
		RequiredFields: []string{"currencyNamespace", "transferMode", "settlementWindowSeconds", "conservationRequired", "inflationPolicy"},
		Coverage:       PrimitiveCoverageCovered,
	},
	"presence": {
		Name:           "presence",
		RequiredFields: []string{"presenceStates", "heartbeatSeconds", "ttlSeconds", "staleTransition", "deviceMergePolicy"},
		Coverage:       PrimitiveCoveragePartial,
	},
	"social": {
		Name:           "social",
		RequiredFields: []string{"relationshipTypes", "preconditionModel", "reputationScale", "decayWindowHours", "blockPolicy"},
		Coverage:       PrimitiveCoveragePartial,
	},
	"timeflow": {
		Name:           "timeflow",
		RequiredFields: []string{"ratio", "tickSeconds", "driftBudgetSecondsPerHour", "catchUpPolicy", "rewindAllowed"},
		Coverage:       PrimitiveCoverageCovered,
	},
	"transit": {
		Name:           "transit",
		RequiredFields: []string{"ingressUserQuotaPerDay", "ingressWorldQuotaPerDay", "carryPolicy", "mappingPolicy", "transitStateModel"},
		Coverage:       PrimitiveCoveragePartial,
	},
}

func PrimitiveContracts() []PrimitiveContract {
	names := make([]string, 0, len(primitiveContracts))
	for name := range primitiveContracts {
		names = append(names, name)
	}
	sort.Strings(names)

	out := make([]PrimitiveContract, 0, len(names))
	for _, name := range names {
		out = append(out, primitiveContracts[name])
	}
	return out
}

func PrimitiveContractByName(name string) (PrimitiveContract, bool) {
	contract, ok := primitiveContracts[strings.TrimSpace(name)]
	return contract, ok
}

func ValidatePrimitiveContract(name string, payload map[string]any) error {
	normalized := strings.TrimSpace(name)
	contract, ok := primitiveContracts[normalized]
	if !ok {
		return fmt.Errorf("unknown primitive contract: %s", normalized)
	}
	switch contract.Name {
	case "timeflow":
		return ValidateTimeflowContract(payload)
	case "economy":
		return ValidateEconomyContract(payload)
	default:
		return fmt.Errorf("%w: %s", ErrPrimitiveContractNotImplemented, contract.Name)
	}
}

func ValidateTimeflowContract(payload map[string]any) error {
	if payload == nil {
		return errors.New("timeflow payload is required")
	}

	ratio, err := float64Field(payload, "ratio")
	if err != nil {
		return err
	}
	if ratio <= 0 || ratio > 1440 {
		return fmt.Errorf("ratio must be > 0 and <= 1440")
	}

	tickSeconds, err := intField(payload, "tickSeconds")
	if err != nil {
		return err
	}
	if tickSeconds < 1 || tickSeconds > 3600 {
		return fmt.Errorf("tickSeconds must be in [1, 3600]")
	}

	driftBudget, err := intField(payload, "driftBudgetSecondsPerHour")
	if err != nil {
		return err
	}
	if driftBudget < 0 || driftBudget > 120 {
		return fmt.Errorf("driftBudgetSecondsPerHour must be in [0, 120]")
	}

	catchUpPolicy, err := stringField(payload, "catchUpPolicy")
	if err != nil {
		return err
	}
	if catchUpPolicy != "PAUSE" && catchUpPolicy != "FAST_FORWARD" {
		return fmt.Errorf("catchUpPolicy must be PAUSE or FAST_FORWARD")
	}

	rewindAllowed, err := boolField(payload, "rewindAllowed")
	if err != nil {
		return err
	}
	if rewindAllowed {
		return fmt.Errorf("rewindAllowed must be false in V0.1")
	}

	return nil
}

func ValidateEconomyContract(payload map[string]any) error {
	if payload == nil {
		return errors.New("economy payload is required")
	}

	currencyNamespace, err := stringField(payload, "currencyNamespace")
	if err != nil {
		return err
	}
	if currencyNamespace == "" {
		return fmt.Errorf("currencyNamespace must be non-empty")
	}

	transferMode, err := stringField(payload, "transferMode")
	if err != nil {
		return err
	}
	if transferMode != "DIRECT" && transferMode != "ESCROW" {
		return fmt.Errorf("transferMode must be DIRECT or ESCROW")
	}

	settlementWindowSeconds, err := intField(payload, "settlementWindowSeconds")
	if err != nil {
		return err
	}
	if settlementWindowSeconds < 60 || settlementWindowSeconds > 86400 {
		return fmt.Errorf("settlementWindowSeconds must be in [60, 86400]")
	}

	conservationRequired, err := boolField(payload, "conservationRequired")
	if err != nil {
		return err
	}
	if !conservationRequired {
		return fmt.Errorf("conservationRequired must be true in V0.1")
	}

	inflationPolicy, err := stringField(payload, "inflationPolicy")
	if err != nil {
		return err
	}
	if inflationPolicy != "FIXED_CAP" && inflationPolicy != "PROGRAMMATIC" {
		return fmt.Errorf("inflationPolicy must be FIXED_CAP or PROGRAMMATIC")
	}

	return nil
}

func stringField(payload map[string]any, key string) (string, error) {
	raw, ok := payload[key]
	if !ok {
		return "", fmt.Errorf("%s is required", key)
	}
	value := strings.TrimSpace(fmt.Sprintf("%v", raw))
	if value == "" {
		return "", fmt.Errorf("%s must be non-empty", key)
	}
	return value, nil
}

func boolField(payload map[string]any, key string) (bool, error) {
	raw, ok := payload[key]
	if !ok {
		return false, fmt.Errorf("%s is required", key)
	}
	value, ok := raw.(bool)
	if !ok {
		return false, fmt.Errorf("%s must be a bool", key)
	}
	return value, nil
}

func float64Field(payload map[string]any, key string) (float64, error) {
	raw, ok := payload[key]
	if !ok {
		return 0, fmt.Errorf("%s is required", key)
	}
	switch value := raw.(type) {
	case float64:
		return value, nil
	case float32:
		return float64(value), nil
	case int:
		return float64(value), nil
	case int32:
		return float64(value), nil
	case int64:
		return float64(value), nil
	default:
		return 0, fmt.Errorf("%s must be numeric", key)
	}
}

func intField(payload map[string]any, key string) (int, error) {
	raw, ok := payload[key]
	if !ok {
		return 0, fmt.Errorf("%s is required", key)
	}
	switch value := raw.(type) {
	case int:
		return value, nil
	case int32:
		return int(value), nil
	case int64:
		return int(value), nil
	case float64:
		if value != float64(int(value)) {
			return 0, fmt.Errorf("%s must be an integer", key)
		}
		return int(value), nil
	case float32:
		if value != float32(int(value)) {
			return 0, fmt.Errorf("%s must be an integer", key)
		}
		return int(value), nil
	default:
		return 0, fmt.Errorf("%s must be an integer", key)
	}
}
