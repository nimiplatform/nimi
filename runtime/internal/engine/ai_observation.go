package engine

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

func observedLocalTextUsage(result localexecution.TextResult) *runtimev1.UsageStats {
	if result.InputTokens == 0 && result.OutputTokens == 0 && result.ComputeMS == 0 {
		return nil
	}
	return &runtimev1.UsageStats{InputTokens: result.InputTokens, OutputTokens: result.OutputTokens, ComputeMs: result.ComputeMS}
}

func observedLocalComputeUsage(milliseconds int64) *runtimev1.UsageStats {
	if milliseconds <= 0 {
		return nil
	}
	return &runtimev1.UsageStats{ComputeMs: milliseconds}
}
