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
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/types/known/structpb"
)

// ExactBinding is one verified occurrence in a selected local configuration.
// AbsolutePath is resolved beneath Runtime's owned models root. BundleDir and
// DeclaredFiles are captured from the same verified ModelAsset manifest.
type ExactBinding struct {
	RequirementID     string
	RequirementRole   runtimev1.LocalCapabilityRequirementRole
	OccurrenceOrdinal uint32
	DisplayLabel      string
	ModelAssetID      string
	AbsolutePath      string
	BundleDir         string
	DeclaredFiles     []string
	VerifiedContentID string
	EntrySHA256       string
	// TemplateIdentity is the Runtime-private digest of an exact model-authored
	// chat template. Empty is a valid base-text state with no behavior match.
	TemplateIdentity string
}

type ExactDependencySource struct {
	DependencyFamily       string
	DependencyID           string
	ConsumerScope          string
	SelectedSourceRecordID string
	CanonicalRoot          string
	Version                string
	VerifiedArtifacts      []string
	Hashes                 map[string]string
}

// SelectedLocalExecution is the all-or-nothing execution projection for one
// machine selection. Configured is true for every successful resolution;
// incomplete configurations return a typed error instead of a partial value.
type SelectedLocalExecution struct {
	LoadoutID          string
	CapabilityContract string
	DisplayName        string
	RecipeID           string
	RecipeRevision     string
	RecipeCustody      []*runtimev1.LoadoutRecipeCustodyReference
	DriverIdentity     *runtimev1.CapabilityImplementationIdentity
	PortableConfig     *structpb.Struct
	// ModelContextWindowTokens is the exact bound model's authored capacity.
	// Zero means the verified model does not expose a usable capacity fact.
	ModelContextWindowTokens        uint64
	Requirements                    []*runtimev1.LocalCapabilityRequirement
	ExactBindings                   []ExactBinding
	ExactDependencySources          []ExactDependencySource
	ImplementationSupportedFeatures []string
	ConfiguredFeatures              []string
	TextBehaviors                   []*runtimev1.TextBehaviorCapabilityProjection
	// ExecutionTarget is the exact Runtime-private local target captured from
	// the selected verified asset occurrence. It is used for cross-capability
	// compatibility checks such as voice.create -> audio.synthesize and is
	// never projected through public protobufs.
	ExecutionTarget *runtimeidentity.Target
	Configured      bool
}

type LoadoutOption struct {
	LoadoutID                       string
	DisplayName                     string
	CapabilityContract              string
	Implementation                  *runtimev1.CapabilityImplementationIdentity
	ImplementationSupportedFeatures []string
	ConfiguredFeatures              []string
	TextBehaviors                   []*runtimev1.TextBehaviorCapabilityProjection
	ValidationState                 runtimev1.LoadoutValidationState
	Reasons                         []runtimev1.ReasonCode
}

// Resolver is the private machine-configuration seam consumed by Runtime
// AIConfig projection and Job composition. AIConfig reads use the current
// machine selection; exact resolution remains available only for Runtime
// inputs that already captured one immutable Loadout identity.
type Resolver interface {
	ProjectSelectedLocalLoadout(capabilityContract string) (LoadoutOption, bool, error)
	ResolveSelectedLocalExecution(capabilityContract string) (*SelectedLocalExecution, error)
	ResolveLocalExecution(capabilityContract string, loadoutRef string) (*SelectedLocalExecution, error)
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
	Text string
	// Ordered is populated only by an exact TextBehaviorAdapter. Base llama v1
	// continues to use Text. There is deliberately no raw-reasoning carrier.
	Ordered *textbehavior.OrderedDelta
}

type TextResult struct {
	Text         string
	Items        []textbehavior.OrderedItem
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
	Stage           ImageExecutionStage
	ArtifactIndex   int32
	ArtifactCount   int32
	CurrentStep     int32
	TotalSteps      int32
	ProgressPercent int32
}

type ImageProgressFunc func(ImageExecutionProgress)

// ImageArtifact is one Host-produced image. Index is one-based and follows the
// captured Driver plan's requested artifact count.
type ImageArtifact struct {
	Index     int32
	Seed      int64
	Bytes     []byte
	MediaType string
	ComputeMS int64
}

type ImageResult struct {
	Artifacts []ImageArtifact
	ComputeMS int64
}

type ImageArtifactFunc func(ImageArtifact) error

// ImageExecutionStartFunc is invoked only after the exact image request has
// acquired the private serial Host lease and is about to begin Host work.
type ImageExecutionStartFunc func() error

// ImageExecutionHost executes only the exact substrate instructions already
// formed by an image Driver. It owns the private serial media lease and emits
// each artifact at its production boundary.
type ImageExecutionHost interface {
	AdmitImage(*capabilitydriver.ImageInvocationPlan) error
	ExecuteImage(context.Context, *capabilitydriver.ImageInvocationPlan, ImageExecutionStartFunc, ImageArtifactFunc, ImageProgressFunc) (ImageResult, error)
}

type MusicExecutionStartFunc func() error

// MusicResult contains only factual staging-WAV output. Runtime Scenario Job
// validation and artifact custody remain above this seam.
type MusicResult struct {
	StagingWAVPath string
	SizeBytes      int64
	SampleRate     int
	Channels       int
	BitsPerSample  int
	DurationMS     int64
	ComputeMS      int64
}

type MusicExecutionHost interface {
	ExecuteMusic(context.Context, *capabilitydriver.MusicInvocationPlan, MusicExecutionStartFunc) (MusicResult, error)
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

// VideoExecutionStartFunc is invoked only after the exact video request has
// acquired the private serial Host lease and is about to begin Host work.
type VideoExecutionStartFunc func() error

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
	AdmitVideo(*capabilitydriver.VideoInvocationPlan) error
	ExecuteVideo(context.Context, *capabilitydriver.VideoInvocationPlan, VideoExecutionStartFunc, VideoProgressFunc) (RawAVCandidate, error)
}

type SpeechSynthesisResult struct {
	AudioBytes     []byte
	AudioBody      io.ReadCloser
	StagingWAVPath string
	SizeBytes      int64
	MIMEType       string
	ComputeMS      int64
	Usage          *runtimev1.UsageStats
}

type SpeechTranscriptionResult struct {
	Text  string
	Usage *runtimev1.UsageStats
}

type VoiceCreateResult struct {
	ProviderVoiceRef string
	Metadata         map[string]any
	Usage            *runtimev1.UsageStats
}

// SpeechExecutionStartFunc is invoked only after the exact speech request has
// acquired the private serial Host lease and is about to begin Host work.
type SpeechExecutionStartFunc func() error

// SpeechExecutionHost dispatches only immutable exact speech and voice-create
// plans to the Runtime-supervised loopback Host. It never discovers assets or decides
// route, machine selection, implementation identity, or fallback.
type SpeechExecutionHost interface {
	ExecuteSpeechSynthesis(context.Context, capabilitydriver.SpeechSynthesizePlan, SpeechExecutionStartFunc) (SpeechSynthesisResult, error)
	ExecuteSpeechTranscription(context.Context, capabilitydriver.SpeechTranscribePlan, SpeechExecutionStartFunc) (SpeechTranscriptionResult, error)
	ExecuteVoiceCreate(context.Context, *capabilitydriver.VoiceCreateInvocationPlan, SpeechExecutionStartFunc) (VoiceCreateResult, error)
}

type FailureKind string

const (
	FailureLoad                 FailureKind = "load"
	FailureContentMismatch      FailureKind = "content_mismatch"
	FailureInference            FailureKind = "inference"
	FailureOutOfMemory          FailureKind = "out_of_memory"
	FailureCanceled             FailureKind = "cancel"
	FailureTimeout              FailureKind = "timeout"
	FailureProcessCrash         FailureKind = "process_crash"
	FailureTextOutputIncomplete FailureKind = "text_output_incomplete"
	FailureTextOutputInvalid    FailureKind = "text_output_invalid"
	FailureToolCallInvalid      FailureKind = "tool_call_invalid"
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
