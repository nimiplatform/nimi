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
var ErrUnknownPrimitiveContract = errors.New("unknown primitive contract")

type PrimitiveContract struct {
	Name           string
	RequiredFields []string
	Coverage       PrimitiveCoverage
}

func PrimitiveContracts() []PrimitiveContract {
	out := append([]PrimitiveContract(nil), primitiveContractDefinitions()...)
	sort.Slice(out, func(i, j int) bool {
		return out[i].Name < out[j].Name
	})
	return out
}

func PrimitiveContractByName(name string) (PrimitiveContract, bool) {
	contract, ok := primitiveContractIndex()[strings.TrimSpace(name)]
	return contract, ok
}

func ValidatePrimitiveContract(name string, payload map[string]any) error {
	normalized := strings.TrimSpace(name)
	contract, ok := primitiveContractIndex()[normalized]
	if !ok {
		return fmt.Errorf("validate primitive contract: %w: %s", ErrUnknownPrimitiveContract, normalized)
	}
	switch contract.Name {
	case "timeflow":
		return ValidateTimeflowContract(payload)
	case "economy":
		return ValidateEconomyContract(payload)
	default:
		return fmt.Errorf("validate primitive contract: %w: %s", ErrPrimitiveContractNotImplemented, contract.Name)
	}
}

func ValidateTimeflowContract(payload map[string]any) error {
	const operation = "validate timeflow contract"
	if payload == nil {
		return fmt.Errorf("%s: payload is required", operation)
	}

	ratio, err := float64Field(payload, "ratio")
	if err != nil {
		return fmt.Errorf("%s: %w", operation, err)
	}
	if ratio <= 0 || ratio > 1440 {
		return fmt.Errorf("%s: ratio must be > 0 and <= 1440", operation)
	}

	tickSeconds, err := intField(payload, "tickSeconds")
	if err != nil {
		return fmt.Errorf("%s: %w", operation, err)
	}
	if tickSeconds < 1 || tickSeconds > 3600 {
		return fmt.Errorf("%s: tickSeconds must be in [1, 3600]", operation)
	}

	driftBudget, err := intField(payload, "driftBudgetSecondsPerHour")
	if err != nil {
		return fmt.Errorf("%s: %w", operation, err)
	}
	if driftBudget < 0 || driftBudget > 120 {
		return fmt.Errorf("%s: driftBudgetSecondsPerHour must be in [0, 120]", operation)
	}

	catchUpPolicy, err := stringField(payload, "catchUpPolicy")
	if err != nil {
		return fmt.Errorf("%s: %w", operation, err)
	}
	if catchUpPolicy != "PAUSE" && catchUpPolicy != "FAST_FORWARD" {
		return fmt.Errorf("%s: catchUpPolicy must be PAUSE or FAST_FORWARD", operation)
	}

	rewindAllowed, err := boolField(payload, "rewindAllowed")
	if err != nil {
		return fmt.Errorf("%s: %w", operation, err)
	}
	if rewindAllowed {
		return fmt.Errorf("%s: rewindAllowed must be false in V0.1", operation)
	}

	return nil
}

func ValidateEconomyContract(payload map[string]any) error {
	const operation = "validate economy contract"
	if payload == nil {
		return fmt.Errorf("%s: payload is required", operation)
	}

	currencyNamespace, err := stringField(payload, "currencyNamespace")
	if err != nil {
		return fmt.Errorf("%s: %w", operation, err)
	}
	if currencyNamespace == "" {
		return fmt.Errorf("%s: currencyNamespace must be non-empty", operation)
	}

	transferMode, err := stringField(payload, "transferMode")
	if err != nil {
		return fmt.Errorf("%s: %w", operation, err)
	}
	if transferMode != "DIRECT" && transferMode != "ESCROW" {
		return fmt.Errorf("%s: transferMode must be DIRECT or ESCROW", operation)
	}

	settlementWindowSeconds, err := intField(payload, "settlementWindowSeconds")
	if err != nil {
		return fmt.Errorf("%s: %w", operation, err)
	}
	if settlementWindowSeconds < 60 || settlementWindowSeconds > 86400 {
		return fmt.Errorf("%s: settlementWindowSeconds must be in [60, 86400]", operation)
	}

	conservationRequired, err := boolField(payload, "conservationRequired")
	if err != nil {
		return fmt.Errorf("%s: %w", operation, err)
	}
	if !conservationRequired {
		return fmt.Errorf("%s: conservationRequired must be true in V0.1", operation)
	}

	inflationPolicy, err := stringField(payload, "inflationPolicy")
	if err != nil {
		return fmt.Errorf("%s: %w", operation, err)
	}
	if inflationPolicy != "FIXED_CAP" && inflationPolicy != "PROGRAMMATIC" {
		return fmt.Errorf("%s: inflationPolicy must be FIXED_CAP or PROGRAMMATIC", operation)
	}

	return nil
}

func stringField(payload map[string]any, key string) (string, error) {
	raw, ok := payload[key]
	if !ok {
		return "", fmt.Errorf("%s is required", key)
	}
	value, ok := raw.(string)
	if !ok {
		return "", fmt.Errorf("%s must be a string", key)
	}
	value = strings.TrimSpace(value)
	if value == "" {
		return "", fmt.Errorf("%s must be non-empty", key)
	}
	return value, nil
}

func primitiveContractDefinitions() []PrimitiveContract {
	return []PrimitiveContract{
		{
			Name:           "context",
			RequiredFields: []string{"contextScope", "retentionTtlSeconds", "injectionPriority", "truncationPolicy", "handoffPolicy"},
			Coverage:       PrimitiveCoveragePartial,
		},
		{
			Name:           "economy",
			RequiredFields: []string{"currencyNamespace", "transferMode", "settlementWindowSeconds", "conservationRequired", "inflationPolicy"},
			Coverage:       PrimitiveCoverageCovered,
		},
		{
			Name:           "presence",
			RequiredFields: []string{"presenceStates", "heartbeatSeconds", "ttlSeconds", "staleTransition", "deviceMergePolicy"},
			Coverage:       PrimitiveCoveragePartial,
		},
		{
			Name:           "social",
			RequiredFields: []string{"relationshipTypes", "preconditionModel", "reputationScale", "decayWindowHours", "blockPolicy"},
			Coverage:       PrimitiveCoveragePartial,
		},
		{
			Name:           "timeflow",
			RequiredFields: []string{"ratio", "tickSeconds", "driftBudgetSecondsPerHour", "catchUpPolicy", "rewindAllowed"},
			Coverage:       PrimitiveCoverageCovered,
		},
		{
			Name:           "transit",
			RequiredFields: []string{"ingressUserQuotaPerDay", "ingressWorldQuotaPerDay", "carryPolicy", "mappingPolicy", "transitStateModel"},
			Coverage:       PrimitiveCoveragePartial,
		},
	}
}

func primitiveContractIndex() map[string]PrimitiveContract {
	index := make(map[string]PrimitiveContract, len(primitiveContractDefinitions()))
	for _, contract := range primitiveContractDefinitions() {
		index[contract.Name] = contract
	}
	return index
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
