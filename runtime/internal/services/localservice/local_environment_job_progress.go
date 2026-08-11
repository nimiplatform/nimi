package localservice

import (
	"context"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

// install/download path. The shared download core's progress callback resolves
// it from the context and forwards each byte-progress snapshot, so the install
// path (installVerifiedAssetByTemplateID → installManagedDownloadedModel →
// downloadManagedModelFile → downloadToFileWithTransfer) needs no extra
// signature parameter to carry per-job progress. A context with no sink leaves
// the install path's behaviour unchanged (the InstallVerifiedAsset RPC path).
type localEnvironmentJobDownloadProgressSink func(localEnvironmentDependencyJobProgress)

type localEnvironmentJobProgressContextKey struct{}

// withLocalEnvironmentJobDownloadProgressSink returns a child context carrying a
// byte-progress sink for the running materializer job. The model.asset /
// model.companion-asset executors attach their reporter's Progress sink so the
// shared download core can publish onto the job projection.
func withLocalEnvironmentJobDownloadProgressSink(ctx context.Context, sink localEnvironmentJobDownloadProgressSink) context.Context {
	if sink == nil {
		return ctx
	}
	return context.WithValue(ctx, localEnvironmentJobProgressContextKey{}, sink)
}

// localEnvironmentJobDownloadProgressSinkFromContext resolves the per-job
// byte-progress sink, or nil when the context carries none (e.g. the
// InstallVerifiedAsset RPC path, which has no owning materializer job).
func localEnvironmentJobDownloadProgressSinkFromContext(ctx context.Context) localEnvironmentJobDownloadProgressSink {
	if ctx == nil {
		return nil
	}
	sink, _ := ctx.Value(localEnvironmentJobProgressContextKey{}).(localEnvironmentJobDownloadProgressSink)
	return sink
}

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
