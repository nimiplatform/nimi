package main

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

func printProviderChanges(changes []providerChange, sampledAt string, jsonOutput bool) error {
	if strings.TrimSpace(sampledAt) == "" {
		sampledAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	if jsonOutput {
		out, err := json.MarshalIndent(map[string]any{
			"sampled_at": sampledAt,
			"changes":    changes,
		}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}
	printCLIHeader(os.Stdout, "Nimi Provider Changes")
	printCLIField(os.Stdout, "sampled at", sampledAt)
	if len(changes) == 0 {
		printCLIField(os.Stdout, "changes", "none")
		return nil
	}
	for _, item := range changes {
		from := "-"
		to := "-"
		failures := int64(0)
		reason := ""
		if item.Before != nil {
			from = item.Before.State
			failures = item.Before.ConsecutiveFailures
			reason = item.Before.Reason
		}
		if item.After != nil {
			to = item.After.State
			failures = item.After.ConsecutiveFailures
			reason = item.After.Reason
		}
		fmt.Println()
		printCLIField(os.Stdout, "provider", item.Name)
		printCLIField(os.Stdout, "event", item.Type)
		printCLIField(os.Stdout, "from", from)
		printCLIField(os.Stdout, "to", to)
		printCLIField(os.Stdout, "failures", strconv.FormatInt(failures, 10))
		printCLIField(os.Stdout, "reason", reason)
	}
	return nil
}

func buildProviderDiff(previous []providerSnapshot, current []providerSnapshot) []providerChange {
	prevMap := mapProvidersByName(previous)
	currMap := mapProvidersByName(current)

	names := make([]string, 0, len(prevMap)+len(currMap))
	seen := make(map[string]bool, len(prevMap)+len(currMap))
	for name := range prevMap {
		if !seen[name] {
			seen[name] = true
			names = append(names, name)
		}
	}
	for name := range currMap {
		if !seen[name] {
			seen[name] = true
			names = append(names, name)
		}
	}
	sort.Strings(names)

	changes := make([]providerChange, 0, len(names))
	for _, name := range names {
		before, hadBefore := prevMap[name]
		after, hadAfter := currMap[name]

		switch {
		case !hadBefore && hadAfter:
			afterCopy := after
			changes = append(changes, providerChange{
				Name:  name,
				Type:  "added",
				After: &afterCopy,
			})
		case hadBefore && !hadAfter:
			beforeCopy := before
			changes = append(changes, providerChange{
				Name:   name,
				Type:   "removed",
				Before: &beforeCopy,
			})
		case hadBefore && hadAfter && providerChanged(before, after):
			beforeCopy := before
			afterCopy := after
			changes = append(changes, providerChange{
				Name:   name,
				Type:   "updated",
				Before: &beforeCopy,
				After:  &afterCopy,
			})
		}
	}
	return changes
}

func mapProvidersByName(items []providerSnapshot) map[string]providerSnapshot {
	out := make(map[string]providerSnapshot, len(items))
	for _, item := range items {
		name := strings.TrimSpace(item.Name)
		if name == "" {
			continue
		}
		out[name] = item
	}
	return out
}

func providerChanged(left providerSnapshot, right providerSnapshot) bool {
	return left.State != right.State ||
		left.Reason != right.Reason ||
		left.ConsecutiveFailures != right.ConsecutiveFailures
}

func cloneProviderSnapshots(items []providerSnapshot) []providerSnapshot {
	if len(items) == 0 {
		return []providerSnapshot{}
	}
	out := make([]providerSnapshot, len(items))
	copy(out, items)
	return out
}

func providerMapToSlice(items map[string]providerSnapshot) []providerSnapshot {
	if len(items) == 0 {
		return []providerSnapshot{}
	}
	out := make([]providerSnapshot, 0, len(items))
	for _, item := range items {
		out = append(out, item)
	}
	return out
}

func providersSignature(providers []providerSnapshot) string {
	if len(providers) == 0 {
		return ""
	}
	sorted := append([]providerSnapshot(nil), providers...)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].Name < sorted[j].Name
	})

	parts := make([]string, 0, len(sorted))
	for _, item := range sorted {
		parts = append(parts, strings.Join([]string{
			item.Name,
			item.State,
			item.Reason,
			strconv.FormatInt(item.ConsecutiveFailures, 10),
		}, "|"))
	}
	return strings.Join(parts, "\n")
}

func extractProviders(payload map[string]any) []providerSnapshot {
	raw, ok := payload["ai_providers"].([]any)
	if !ok {
		return []providerSnapshot{}
	}

	out := make([]providerSnapshot, 0, len(raw))
	for _, item := range raw {
		entry, ok := item.(map[string]any)
		if !ok {
			continue
		}
		out = append(out, providerSnapshot{
			Name:                getString(entry["name"]),
			State:               getString(entry["state"]),
			Reason:              getString(entry["reason"]),
			ConsecutiveFailures: getInt64(entry["consecutive_failures"]),
			LastChangedAt:       getString(entry["last_changed_at"]),
			LastCheckedAt:       getString(entry["last_checked_at"]),
		})
	}
	return out
}

func getString(value any) string {
	switch item := value.(type) {
	case string:
		return strings.TrimSpace(item)
	default:
		return ""
	}
}

func getInt64(value any) int64 {
	switch item := value.(type) {
	case float64:
		return int64(item)
	case float32:
		return int64(item)
	case int64:
		return item
	case int:
		return int64(item)
	case int32:
		return int64(item)
	case json.Number:
		parsed, err := item.Int64()
		if err != nil {
			return 0
		}
		return parsed
	case string:
		parsed, err := strconv.ParseInt(strings.TrimSpace(item), 10, 64)
		if err != nil {
			return 0
		}
		return parsed
	default:
		return 0
	}
}
