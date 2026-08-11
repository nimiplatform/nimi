// Package localexecution defines the Runtime-private job-time projection shared
// by machine configuration and execution consumers. It is not a public RPC or
// persisted contract.
package localexecution

import (
	"context"
	"errors"
	"io"

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
	// AssetID is the stable manifest/catalog identity admitted by supervised
	// Hosts. LocalAssetID remains the machine-local occurrence identity.
	AssetID           string
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
	// ModelContextWindowTokens is the exact bound model's authored capacity.
	// Zero means the verified model does not expose a usable capacity fact.
	ModelContextWindowTokens uint64
	Requirements             []*runtimev1.LocalCapabilityRequirement
	ExactBindings            []ExactBinding
	SupportedFeatures        []string
	Configured               bool
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

type EmbedResult struct {
	Vectors     []*runtimev1.EmbeddingVector
	InputTokens int64
	ComputeMS   int64
}

// EmbedExecutionHost executes only an exact embedding plan already formed by
// the selected Driver. It shares the Runtime-private llama process lease with
// text execution without becoming route or machine-selection authority.
type EmbedExecutionHost interface {
	ExecuteEmbed(context.Context, *capabilitydriver.EmbedInvocationPlan, TextProgressFunc) (EmbedResult, error)
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

// VideoExecutionStage reports factual private Host work after the video lease
// is acquired. Encoding is separate because raw AV production precedes public
// artifact encoding/muxing.
type VideoExecutionStage string

const (
	VideoExecutionStageLoading    VideoExecutionStage = "loading"
	VideoExecutionStageReady      VideoExecutionStage = "ready"
	VideoExecutionStageReused     VideoExecutionStage = "reused"
	VideoExecutionStageGenerating VideoExecutionStage = "generating"
	VideoExecutionStageProduced   VideoExecutionStage = "produced"
	VideoExecutionStageEncoding   VideoExecutionStage = "encoding"
)

type VideoExecutionProgress struct {
	Stage       VideoExecutionStage
	FrameIndex  int32
	FrameCount  int32
	CurrentStep int32
	TotalSteps  int32
}

type VideoProgressFunc func(VideoExecutionProgress)

// RawVideoFrame is one ordered packed-RGB frame owned by the private Runtime
// execution seam. RGBBytes has exactly Width*Height*3 bytes.
type RawVideoFrame struct {
	RGBBytes []byte
	Width    int
	Height   int
}

// RawAudio is interleaved floating-point PCM. MiniMax-H3 candidates are
// required to carry non-empty stereo 32000 Hz audio.
type RawAudio struct {
	PCMSamples []float32
	Channels   int
	SampleRate int
}

// RawAVCandidate is an unencoded Host result, not a public ScenarioArtifact.
// Frames preserve generation order and FrameCount repeats the expected count
// for fail-closed substrate validation.
type RawAVCandidate struct {
	Frames     []RawVideoFrame
	FrameCount int
	FPS        int
	Audio      RawAudio
	ComputeMS  int64
}

// VideoExecutionHost executes one immutable Driver plan and returns only a raw
// AV candidate. Services/encoding owners decide artifact publication.
type VideoExecutionHost interface {
	ExecuteVideo(context.Context, *capabilitydriver.VideoInvocationPlan, VideoProgressFunc) (RawAVCandidate, error)
}

type SpeechSynthesisResult struct {
	AudioBytes []byte
	AudioBody  io.ReadCloser
	SizeBytes  int64
	MIMEType   string
	Usage      *runtimev1.UsageStats
}

type SpeechTranscriptionResult struct {
	Text  string
	Usage *runtimev1.UsageStats
}

// SpeechExecutionStartFunc is invoked only after the exact speech request has
// acquired the private serial Host lease and is about to begin Host work.
type SpeechExecutionStartFunc func() error

// SpeechExecutionHost dispatches only immutable exact Qwen3 speech plans to
// the Runtime-supervised loopback Host. It never discovers assets or decides
// route, machine selection, implementation identity, or fallback.
type SpeechExecutionHost interface {
	ExecuteSpeechSynthesis(context.Context, *capabilitydriver.SpeechSynthesizeInvocationPlan, SpeechExecutionStartFunc) (SpeechSynthesisResult, error)
	ExecuteSpeechTranscription(context.Context, *capabilitydriver.SpeechTranscribeInvocationPlan, SpeechExecutionStartFunc) (SpeechTranscriptionResult, error)
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
