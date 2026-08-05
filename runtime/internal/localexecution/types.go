// Package localexecution defines the Runtime-private job-time projection shared
// by machine configuration and execution consumers. It is not a public RPC or
// persisted contract.
package localexecution

import (
	"context"
	"errors"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"google.golang.org/protobuf/types/known/structpb"
)

// ExactBinding is one verified occurrence in a selected local configuration.
// AbsolutePath is resolved beneath Runtime's owned models root.
type ExactBinding struct {
	RequirementID     string
	RequirementRole   runtimev1.LocalCapabilityRequirementRole
	OccurrenceOrdinal uint32
	DisplayLabel      string
	LocalAssetID      string
	AbsolutePath      string
	VerifiedContentID string
	EntrySHA256       string
}

// SelectedLocalExecution is the all-or-nothing execution projection for one
// machine selection. Configured is true for every successful resolution;
// incomplete configurations return a typed error instead of a partial value.
type SelectedLocalExecution struct {
	ConfigurationID    string
	CapabilityContract string
	DisplayName        string
	DriverIdentity     *runtimev1.CapabilityImplementationIdentity
	PortableConfig     *structpb.Struct
	Requirements       []*runtimev1.LocalCapabilityRequirement
	ExactBindings      []ExactBinding
	SupportedFeatures  []string
	Configured         bool
}

// Resolver is the private machine-configuration seam consumed by Runtime job
// composition. SelectedLocalCapabilityContracts returns stable sorted keys.
type Resolver interface {
	SelectedLocalCapabilityContracts() []string
	ResolveSelectedLocalExecution(capabilityContract string) (*SelectedLocalExecution, error)
}

// TextExecutionProgress reports private host lifecycle progress to the job or
// stream owner. It is execution lifecycle, never selected/configured truth.
type TextExecutionProgress string

const (
	TextExecutionProgressLoading TextExecutionProgress = "loading"
	TextExecutionProgressReady   TextExecutionProgress = "ready"
	TextExecutionProgressReused  TextExecutionProgress = "reused"
)

type TextProgressFunc func(TextExecutionProgress)

type TextDelta struct {
	Text      string
	Reasoning string
}

type TextResult struct {
	Text         string
	InputTokens  int64
	OutputTokens int64
	ComputeMS    int64
	FinishReason runtimev1.FinishReason
}

// TextExecutionHost executes only substrate instructions already formed by a
// Driver. Implementations add host-owned binary, loopback, and port facts.
type TextExecutionHost interface {
	ExecuteText(context.Context, *capabilitydriver.TextInvocationPlan, TextProgressFunc) (TextResult, error)
	StreamText(context.Context, *capabilitydriver.TextInvocationPlan, func(TextDelta) error, TextProgressFunc) (TextResult, error)
}

// ImageExecutionStage reports factual private Host work after a queued request
// acquires the engine lease. Queue position and lease occupancy never enter
// this carrier.
type ImageExecutionStage string

const (
	ImageExecutionStageLoading    ImageExecutionStage = "loading"
	ImageExecutionStageReady      ImageExecutionStage = "ready"
	ImageExecutionStageReused     ImageExecutionStage = "reused"
	ImageExecutionStageGenerating ImageExecutionStage = "generating"
	ImageExecutionStageProduced   ImageExecutionStage = "produced"
)

type ImageExecutionProgress struct {
	Stage         ImageExecutionStage
	ArtifactIndex int32
	ArtifactCount int32
}

type ImageProgressFunc func(ImageExecutionProgress)

// ImageArtifact is one Host-produced image. Index is one-based and follows the
// captured Driver plan's requested artifact count.
type ImageArtifact struct {
	Index     int32
	Bytes     []byte
	ComputeMS int64
}

type ImageResult struct {
	Artifacts []ImageArtifact
	ComputeMS int64
}

type ImageArtifactFunc func(ImageArtifact) error

// ImageExecutionHost executes only the exact substrate instructions already
// formed by an image Driver. It owns the private serial media lease and emits
// each artifact at its production boundary.
type ImageExecutionHost interface {
	ExecuteImage(context.Context, *capabilitydriver.ImageInvocationPlan, ImageArtifactFunc, ImageProgressFunc) (ImageResult, error)
}

type FailureKind string

const (
	FailureLoad            FailureKind = "load"
	FailureContentMismatch FailureKind = "content_mismatch"
	FailureInference       FailureKind = "inference"
	FailureCanceled        FailureKind = "cancel"
	FailureProcessCrash    FailureKind = "process_crash"
)

// ExecutionError preserves the private failure phase so service boundaries can
// map load, inference/crash, and cancellation to distinct typed public reasons.
type ExecutionError struct {
	Kind FailureKind
	Err  error
}

func (e *ExecutionError) Error() string {
	if e == nil || e.Err == nil {
		return "local execution failed"
	}
	return e.Err.Error()
}

func (e *ExecutionError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

func FailureKindOf(err error) FailureKind {
	var executionErr *ExecutionError
	if errors.As(err, &executionErr) {
		return executionErr.Kind
	}
	return ""
}
