package aitelemetry

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"math/big"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type aggregate struct {
	Source     string                               `json:"source"`
	Capability string                               `json:"capability"`
	Models     []*runtimev1.DesktopAIExecutionModel `json:"models"`
	Route      runtimev1.DesktopAIExecutionRoute    `json:"route"`
	Totals     *runtimev1.DesktopAIUsageTotals      `json:"totals"`
	Costs      map[string]string                    `json:"costs,omitempty"`
}

func recordAggregate(record Record) (aggregate, string, error) {
	value := aggregate{Source: record.Source.Kind, Capability: record.Capability, Models: cloneFacts(record.Facts).Models, Route: record.Route, Totals: &runtimev1.DesktopAIUsageTotals{}, Costs: make(map[string]string)}
	identity, err := json.Marshal(struct {
		Source     string
		Capability string
		Models     []*runtimev1.DesktopAIExecutionModel
		Route      runtimev1.DesktopAIExecutionRoute
	}{value.Source, value.Capability, value.Models, value.Route})
	if err != nil {
		return value, "", err
	}
	digest := sha256.Sum256(identity)
	value.Totals.AttemptCount = 1
	if record.TerminalAt.IsZero() {
		value.Totals.ActiveAttemptCount = 1
	}
	if record.Usage == nil {
		value.Totals.PendingUsageCount = 1
	} else {
		value.Totals.MeasuredAttemptCount = 1
		value.Totals.InputTokens = record.Usage.GetInputTokens()
		value.Totals.OutputTokens = record.Usage.GetOutputTokens()
		value.Totals.CachedInputTokens = record.Usage.GetCachedInputTokens()
		value.Totals.ReasoningOutputTokens = record.Usage.GetReasoningOutputTokens()
		value.Totals.ComputeMs = record.Usage.GetComputeMs()
		for _, count := range []*int64{&value.Totals.InputTokens, &value.Totals.OutputTokens, &value.Totals.CachedInputTokens, &value.Totals.ReasoningOutputTokens, &value.Totals.ComputeMs} {
			if *count < 0 {
				return value, "", fmt.Errorf("AI usage quantity is negative")
			}
		}
	}
	if currency, estimate, priced := estimateCost(record); priced {
		if currency != "none" {
			value.Costs[currency] = estimate
		}
	} else {
		value.Totals.UnpricedAttemptCount = 1
	}
	return value, hex.EncodeToString(digest[:]), nil
}

// @nimi-authority: rule.nimi.runtime.rpc-foundations.home-ai-usage-summary
func estimateCost(record Record) (string, string, bool) {
	if record.Route == runtimev1.DesktopAIExecutionRoute_DESKTOP_AI_EXECUTION_ROUTE_LOCAL {
		return "none", "0", true
	}
	price := record.Price
	if price.Currency == "none" {
		return "none", "0", true
	}
	if record.Route != runtimev1.DesktopAIExecutionRoute_DESKTOP_AI_EXECUTION_ROUTE_CLOUD || price.Currency == "" {
		return "", "", false
	}
	parse := func(text string) (*big.Rat, bool) {
		if len(text) > 64 {
			return nil, false
		}
		value, ok := new(big.Rat).SetString(text)
		return value, ok && value.Sign() >= 0
	}
	input, ok := parse(price.Input)
	if !ok {
		return "", "", false
	}
	result := new(big.Rat)
	switch price.Unit {
	case "token":
		if record.Usage == nil {
			return "", "", false
		}
		output, ok := parse(price.Output)
		if !ok {
			return "", "", false
		}
		result.Add(new(big.Rat).Mul(input, new(big.Rat).SetInt64(record.Usage.GetInputTokens())), new(big.Rat).Mul(output, new(big.Rat).SetInt64(record.Usage.GetOutputTokens())))
		result.Quo(result, new(big.Rat).SetInt64(1000000))
	case "request":
		result.Set(input)
	default:
		// Neither token counts nor inference duration establish billable
		// characters/media seconds. Unmeasured units remain unpriced.
		return "", "", false
	}
	return price.Currency, result.RatString(), true
}

func totalFields(total *runtimev1.DesktopAIUsageTotals) []*int64 {
	return []*int64{&total.AttemptCount, &total.ActiveAttemptCount, &total.PendingUsageCount, &total.MeasuredAttemptCount, &total.InputTokens, &total.OutputTokens, &total.CachedInputTokens, &total.ReasoningOutputTokens, &total.ComputeMs, &total.UnpricedAttemptCount}
}

func addAggregate(target *aggregate, value aggregate, direction int64) error {
	if target.Totals == nil {
		target.Totals = &runtimev1.DesktopAIUsageTotals{}
	}
	if value.Totals == nil {
		return fmt.Errorf("AI aggregate lacks quantities")
	}
	left, right := totalFields(target.Totals), totalFields(value.Totals)
	for i := range left {
		if *right[i] < 0 || direction > 0 && *left[i] > math.MaxInt64-*right[i] || direction < 0 && *left[i] < *right[i] {
			return fmt.Errorf("AI accounting aggregate quantity is invalid")
		}
		*left[i] += direction * *right[i]
	}
	if target.Costs == nil {
		target.Costs = make(map[string]string)
	}
	for currency, text := range value.Costs {
		value, ok := new(big.Rat).SetString(text)
		if !ok {
			return fmt.Errorf("AI estimate is invalid")
		}
		current := new(big.Rat)
		if previous := target.Costs[currency]; previous != "" {
			if _, ok := current.SetString(previous); !ok {
				return fmt.Errorf("stored AI estimate is invalid")
			}
		}
		if direction > 0 {
			current.Add(current, value)
		} else {
			current.Sub(current, value)
		}
		if current.Sign() < 0 {
			return fmt.Errorf("AI estimate revision would make a negative aggregate")
		}
		target.Costs[currency] = current.RatString()
	}
	return nil
}

func costProjections(costs map[string]string) []*runtimev1.DesktopAICostEstimate {
	keys := make([]string, 0, len(costs))
	for currency := range costs {
		keys = append(keys, currency)
	}
	sort.Strings(keys)
	result := make([]*runtimev1.DesktopAICostEstimate, 0, len(keys))
	for _, currency := range keys {
		value, ok := new(big.Rat).SetString(costs[currency])
		if !ok {
			continue
		}
		amount := strings.TrimRight(strings.TrimRight(value.FloatString(12), "0"), ".")
		if amount == "" {
			amount = "0"
		}
		result = append(result, &runtimev1.DesktopAICostEstimate{Currency: currency, EstimatedAmount: amount, PricingBasis: "captured_catalog_estimate"})
	}
	return result
}

func groupProjection(value aggregate) *runtimev1.DesktopAIUsageGroup {
	return &runtimev1.DesktopAIUsageGroup{SourceKind: value.Source, Capability: value.Capability, Models: value.Models, Route: value.Route, Totals: value.Totals, Estimates: costProjections(value.Costs)}
}
