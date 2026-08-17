package localservice

import (
	"context"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

// reportLocalEnvironmentJobProgress is a nil-safe shim so executors can publish
// a coarse in-progress state without a nil-check at every call site (executor
// unit tests pass jobs through with a zero reporter).
func reportLocalEnvironmentJobProgress(report localEnvironmentDependencyJobProgressReporter, state string) {
	if report.State == nil {
		return
	}
	report.State(state)
}

// reportLocalEnvironmentJobDownloadProgress is the nil-safe byte-progress shim.
// An executor that streams artifact bytes calls it with each progress snapshot;
// a zero reporter (unit tests, or a non-downloading executor) is a no-op.
func reportLocalEnvironmentJobDownloadProgress(report localEnvironmentDependencyJobProgressReporter, progress localEnvironmentDependencyJobProgress) {
	if report.Progress == nil {
		return
	}
	report.Progress(progress)
}

func localEnvironmentEngineDownloadProgressContext(ctx context.Context, report localEnvironmentDependencyJobProgressReporter) context.Context {
	return engine.WithDownloadProgress(ctx, func(bytesReceived, bytesTotal int64) {
		reportLocalEnvironmentJobDownloadProgress(report, localEnvironmentDependencyJobProgress{
			BytesReceived: bytesReceived,
			BytesTotal:    bytesTotal,
		})
	})
}

func normalizeLocalEnvironmentDependencyJobRequest(req localEnvironmentDependencyJobRequest) localEnvironmentDependencyJobRequest {
	sourceKind := strings.TrimSpace(req.SourceKind)
	if sourceKind == "" {
		sourceKind = localEnvironmentSourceManaged
	}
	return localEnvironmentDependencyJobRequest{
		EnvironmentKey:   strings.TrimSpace(req.EnvironmentKey),
		DependencyFamily: strings.TrimSpace(req.DependencyFamily),
		DependencyID:     strings.TrimSpace(req.DependencyID),
		ConsumerScope:    strings.TrimSpace(req.ConsumerScope),
		SourceKind:       sourceKind,
	}
}

func localEnvironmentDependencyJobTerminal(state string) bool {
	switch strings.TrimSpace(state) {
	case localEnvironmentStateReadySystem, localEnvironmentStateReadyManaged, localEnvironmentStateRepairRequired, localEnvironmentStateFailed, localEnvironmentStateUnsupported, localEnvironmentStateCancelled:
		return true
	default:
		return false
	}
}
