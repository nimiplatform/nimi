package engine

import runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"

func observedLocalComputeUsage(milliseconds int64) *runtimev1.UsageStats {
	if milliseconds <= 0 {
		return nil
	}
	return &runtimev1.UsageStats{ComputeMs: milliseconds}
}
