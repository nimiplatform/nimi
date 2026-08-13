package capabilitydriver

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/known/structpb"
)

// CloudMediaStreamMode is exact audio.synthesize stream behavior captured from
// implementation metadata. It is never inferred from provider identity.
type CloudMediaStreamMode string

const (
	CloudMediaStreamNone      CloudMediaStreamMode = "none"
	CloudMediaStreamNative    CloudMediaStreamMode = "native"
	CloudMediaStreamSimulated CloudMediaStreamMode = "simulated"
)

// Driver-owned transport dialects. Remote ExecutionHost transports the exact
// dialect selected here and never chooses one from connector or model state.
const (
	CloudMediaAdapterOpenAICompat            = "openai_compat_adapter"
	CloudMediaAdapterBytedanceOpenSpeech     = "bytedance_openspeech_adapter"
	CloudMediaAdapterBytedanceARKTask        = "bytedance_ark_task_adapter"
	CloudMediaAdapterAlibabaNative           = "alibaba_native_adapter"
	CloudMediaAdapterGeminiOperation         = "gemini_operation_adapter"
	CloudMediaAdapterGeminiChatSTT           = "gemini_chat_transcribe_adapter"
	CloudMediaAdapterDashScopeChatSTT        = "dashscope_chat_transcribe_adapter"
	CloudMediaAdapterMimoChatTTS             = "mimo_chat_synthesize_adapter"
	CloudMediaAdapterMimoChatSTT             = "mimo_chat_transcribe_adapter"
	CloudMediaAdapterMiniMaxTask             = "minimax_task_adapter"
	CloudMediaAdapterGLMTask                 = "glm_task_adapter"
	CloudMediaAdapterGLMNative               = "glm_native_adapter"
	CloudMediaAdapterKimiChatMultimodal      = "kimi_chat_multimodal_adapter"
	CloudMediaAdapterElevenLabsNative        = "elevenlabs_native_adapter"
	CloudMediaAdapterFishAudioNative         = "fish_audio_native_adapter"
	CloudMediaAdapterAWSPollyNative          = "aws_polly_native_adapter"
	CloudMediaAdapterAzureSpeechNative       = "azure_speech_native_adapter"
	CloudMediaAdapterGoogleCloudTTS          = "google_cloud_tts_adapter"
	CloudMediaAdapterFluxNative              = "flux_native_adapter"
	CloudMediaAdapterIdeogramNative          = "ideogram_native_adapter"
	CloudMediaAdapterStabilityNative         = "stability_native_adapter"
	CloudMediaAdapterKlingTask               = "kling_task_adapter"
	CloudMediaAdapterLumaTask                = "luma_task_adapter"
	CloudMediaAdapterPikaTask                = "pika_task_adapter"
	CloudMediaAdapterRunwayTask              = "runway_task_adapter"
	CloudMediaAdapterGoogleVeoOperation      = "google_veo_operation_adapter"
	CloudMediaAdapterStepFunNative           = "stepfun_native_adapter"
	CloudMediaAdapterStabilityMusic          = "stability_music_adapter"
	CloudMediaAdapterSoundverseMusic         = "soundverse_music_adapter"
	CloudMediaAdapterMubertMusic             = "mubert_music_adapter"
	CloudMediaAdapterLoudlyMusic             = "loudly_music_adapter"
	CloudMediaAdapterWorldLabsNative         = "worldlabs_world_adapter"
	CloudMediaAdapterDashScopeVoiceWorkflow  = "dashscope_voice_workflow_adapter"
	CloudMediaAdapterElevenLabsVoiceWorkflow = "elevenlabs_voice_workflow_adapter"
	CloudMediaAdapterFishAudioVoiceWorkflow  = "fish_audio_voice_workflow_adapter"
	CloudMediaAdapterMimoVoiceWorkflow       = "mimo_voice_workflow_adapter"
	CloudMediaAdapterStepFunVoiceWorkflow    = "stepfun_voice_workflow_adapter"
	CloudMediaAdapterElevenLabsVoiceDelete   = "elevenlabs_voice_delete_adapter"
	CloudMediaAdapterFishAudioVoiceDelete    = "fish_audio_voice_delete_adapter"
)

// CloudMediaTarget is one exact provider/model target interpreted by a media
// Driver. It contains no route, credential, endpoint, or Host facts.
type CloudMediaTarget struct {
	provider             string
	providerModelID      string
	remoteModelCatalogID string
	region               string
	capabilityContract   string
}

func (t CloudMediaTarget) Provider() string             { return t.provider }
func (t CloudMediaTarget) ProviderModelID() string      { return t.providerModelID }
func (t CloudMediaTarget) RemoteModelCatalogID() string { return t.remoteModelCatalogID }
func (t CloudMediaTarget) Region() string               { return t.region }
func (t CloudMediaTarget) CapabilityContract() string   { return t.capabilityContract }

// CloudMediaMappedRequest is the immutable Driver request mapping. Accessors
// clone protobuf state so captured jobs cannot be changed after submission.
type CloudMediaMappedRequest struct {
	providerModelID string
	adapter         string
	request         *runtimev1.SubmitScenarioJobRequest
	streamMode      CloudMediaStreamMode
	detachedPolling bool
}

func (r *CloudMediaMappedRequest) ProviderModelID() string {
	if r == nil {
		return ""
	}
	return r.providerModelID
}

func (r *CloudMediaMappedRequest) Adapter() string {
	if r == nil {
		return ""
	}
	return r.adapter
}

func (r *CloudMediaMappedRequest) Request() *runtimev1.SubmitScenarioJobRequest {
	if r == nil || r.request == nil {
		return nil
	}
	cloned, _ := proto.Clone(r.request).(*runtimev1.SubmitScenarioJobRequest)
	return cloned
}

func (r *CloudMediaMappedRequest) StreamMode() CloudMediaStreamMode {
	if r == nil {
		return CloudMediaStreamNone
	}
	return r.streamMode
}

func (r *CloudMediaMappedRequest) DetachedPolling() bool {
	return r != nil && r.detachedPolling
}

// CloudMediaStreamChunk is a credential-free provider stream frame crossing
// the Host-to-Driver seam.
type CloudMediaStreamChunk struct {
	Bytes         []byte
	MIMEType      string
	SampleRateHz  int32
	FailureReason runtimev1.ReasonCode
}

type ArtifactBodyKind string

const (
	ArtifactBodyBoundedBytes       ArtifactBodyKind = "bounded_bytes"
	ArtifactBodyIncrementalStream  ArtifactBodyKind = "incremental_stream"
	ArtifactBodyCommittedReference ArtifactBodyKind = "committed_custody_reference"
)

// ArtifactBody is the closed Host/Driver body handoff. Exactly one variant is
// present. An accepted incremental stream has one consumer and one Close owner.
type ArtifactBody struct {
	mu        sync.Mutex
	kind      ArtifactBodyKind
	bytes     []byte
	stream    io.ReadCloser
	reference *RuntimeCustodyReference
}

func NewBoundedArtifactBody(payload []byte) (*ArtifactBody, error) {
	if len(payload) == 0 {
		return nil, fmt.Errorf("bounded artifact body is empty")
	}
	return &ArtifactBody{kind: ArtifactBodyBoundedBytes, bytes: append([]byte(nil), payload...)}, nil
}

func NewIncrementalArtifactBody(source io.ReadCloser) (*ArtifactBody, error) {
	if source == nil {
		return nil, fmt.Errorf("incremental artifact body is missing")
	}
	return &ArtifactBody{kind: ArtifactBodyIncrementalStream, stream: source}, nil
}

func NewCommittedArtifactBody(reference *RuntimeCustodyReference) (*ArtifactBody, error) {
	if reference == nil {
		return nil, fmt.Errorf("committed artifact reference is missing")
	}
	return &ArtifactBody{kind: ArtifactBodyCommittedReference, reference: reference}, nil
}

func (body *ArtifactBody) Kind() ArtifactBodyKind {
	if body == nil {
		return ""
	}
	return body.kind
}

func (body *ArtifactBody) BoundedBytes() []byte {
	if body == nil || body.kind != ArtifactBodyBoundedBytes {
		return nil
	}
	return append([]byte(nil), body.bytes...)
}

func (body *ArtifactBody) TakeIncrementalStream() io.ReadCloser {
	if body == nil || body.kind != ArtifactBodyIncrementalStream {
		return nil
	}
	body.mu.Lock()
	defer body.mu.Unlock()
	source := body.stream
	body.stream = nil
	return source
}

func (body *ArtifactBody) CommittedReference() *RuntimeCustodyReference {
	if body == nil || body.kind != ArtifactBodyCommittedReference {
		return nil
	}
	return body.reference
}

func (body *ArtifactBody) valid() bool {
	if body == nil {
		return false
	}
	switch body.kind {
	case ArtifactBodyBoundedBytes:
		return len(body.bytes) > 0 && body.stream == nil && body.reference == nil
	case ArtifactBodyIncrementalStream:
		return len(body.bytes) == 0 && body.stream != nil && body.reference == nil
	case ArtifactBodyCommittedReference:
		return len(body.bytes) == 0 && body.stream == nil && body.reference != nil
	default:
		return false
	}
}

type RuntimeCustodyDescriptor struct {
	ArtifactID           string
	AccountID            string
	RegisteredAppSubject string
	ProducerAppID        string
	SizeBytes            int64
	ContentSHA256        string
	MIMEType             string
	EligibleOperation    string
	ExpiresAt            time.Time
}

// RuntimeCustodyIssuer is process-private Runtime identity. References issued
// by another issuer cannot validate even when every visible descriptor value
// is copied.
type RuntimeCustodyIssuer struct{ identity *byte }

type RuntimeCustodyReference struct {
	issuer     *RuntimeCustodyIssuer
	descriptor RuntimeCustodyDescriptor
}

func (reference *RuntimeCustodyReference) ArtifactID() string {
	if reference == nil {
		return ""
	}
	return reference.descriptor.ArtifactID
}

func NewRuntimeCustodyIssuer() *RuntimeCustodyIssuer {
	return &RuntimeCustodyIssuer{identity: new(byte)}
}

func (issuer *RuntimeCustodyIssuer) Issue(descriptor RuntimeCustodyDescriptor) (*RuntimeCustodyReference, error) {
	descriptor.ArtifactID = strings.TrimSpace(descriptor.ArtifactID)
	descriptor.AccountID = strings.TrimSpace(descriptor.AccountID)
	descriptor.RegisteredAppSubject = strings.TrimSpace(descriptor.RegisteredAppSubject)
	descriptor.ProducerAppID = strings.TrimSpace(descriptor.ProducerAppID)
	descriptor.ContentSHA256 = strings.ToLower(strings.TrimSpace(descriptor.ContentSHA256))
	descriptor.MIMEType = strings.ToLower(strings.TrimSpace(descriptor.MIMEType))
	descriptor.EligibleOperation = strings.TrimSpace(descriptor.EligibleOperation)
	if issuer == nil || issuer.identity == nil || descriptor.ArtifactID == "" || descriptor.AccountID == "" ||
		descriptor.RegisteredAppSubject == "" || descriptor.SizeBytes < 0 || descriptor.ContentSHA256 == "" ||
		descriptor.MIMEType == "" || descriptor.EligibleOperation == "" || !descriptor.ExpiresAt.After(time.Now()) {
		return nil, fmt.Errorf("Runtime custody descriptor is invalid")
	}
	return &RuntimeCustodyReference{issuer: issuer, descriptor: descriptor}, nil
}

func (issuer *RuntimeCustodyIssuer) Resolve(reference *RuntimeCustodyReference) (RuntimeCustodyDescriptor, bool) {
	if issuer == nil || issuer.identity == nil || reference == nil || reference.issuer != issuer ||
		reference.issuer.identity != issuer.identity || !reference.descriptor.ExpiresAt.After(time.Now()) {
		return RuntimeCustodyDescriptor{}, false
	}
	return reference.descriptor, true
}

// CloudMediaTransportResponse is the credential-free carrier returned by the
// Remote ExecutionHost before Driver response normalization.
type CloudMediaTransportResponse struct {
	Artifacts      []*runtimev1.ScenarioArtifact
	ArtifactBodies map[string]*ArtifactBody
	Usage          *runtimev1.UsageStats
	FinishReason   runtimev1.FinishReason
	Streamed       bool
}

// CloudMediaResult is the Runtime-normalized media Driver result.
type CloudMediaResult struct {
	Artifacts      []*runtimev1.ScenarioArtifact
	ArtifactBodies map[string]*ArtifactBody
	Usage          *runtimev1.UsageStats
	FinishReason   runtimev1.FinishReason
	Streamed       bool
}

// CloudVoiceWorkflowConfig is catalog/config input to Driver request mapping.
// It contains no connector, credential, endpoint, route, or Host state.
type CloudVoiceWorkflowConfig struct {
	WorkflowType    string
	WorkflowModelID string
	CatalogModelID  string
	APIModelID      string
	Extensions      *structpb.Struct
}

// CloudVoiceWorkflowMappedRequest is the immutable provider request mapping
// consumed by Remote ExecutionHost.
type CloudVoiceWorkflowMappedRequest struct {
	provider        string
	adapter         string
	workflowType    string
	workflowModelID string
	modelID         string
	payload         *structpb.Struct
	extensions      *structpb.Struct
}

func (r *CloudVoiceWorkflowMappedRequest) Provider() string {
	if r == nil {
		return ""
	}
	return r.provider
}
func (r *CloudVoiceWorkflowMappedRequest) Adapter() string {
	if r == nil {
		return ""
	}
	return r.adapter
}
func (r *CloudVoiceWorkflowMappedRequest) WorkflowType() string {
	if r == nil {
		return ""
	}
	return r.workflowType
}
func (r *CloudVoiceWorkflowMappedRequest) WorkflowModelID() string {
	if r == nil {
		return ""
	}
	return r.workflowModelID
}
func (r *CloudVoiceWorkflowMappedRequest) ModelID() string {
	if r == nil {
		return ""
	}
	return r.modelID
}
func (r *CloudVoiceWorkflowMappedRequest) Payload() map[string]any {
	if r == nil || r.payload == nil {
		return nil
	}
	cloned, _ := proto.Clone(r.payload).(*structpb.Struct)
	return cloned.AsMap()
}
func (r *CloudVoiceWorkflowMappedRequest) Extensions() map[string]any {
	if r == nil || r.extensions == nil {
		return nil
	}
	cloned, _ := proto.Clone(r.extensions).(*structpb.Struct)
	return cloned.AsMap()
}

// CloudVoiceDeleteMappedRequest is an immutable exact-dialect lifecycle
// request for one provider-persistent voice handle.
type CloudVoiceDeleteMappedRequest struct {
	provider         string
	adapter          string
	providerVoiceRef string
}

func (r *CloudVoiceDeleteMappedRequest) Provider() string {
	if r == nil {
		return ""
	}
	return r.provider
}
func (r *CloudVoiceDeleteMappedRequest) Adapter() string {
	if r == nil {
		return ""
	}
	return r.adapter
}
func (r *CloudVoiceDeleteMappedRequest) ProviderVoiceRef() string {
	if r == nil {
		return ""
	}
	return r.providerVoiceRef
}

// CloudVoiceWorkflowTransportResponse is the credential-free Host carrier.
type CloudVoiceWorkflowTransportResponse struct {
	ProviderVoiceRef string
	Metadata         *structpb.Struct
	Usage            *runtimev1.UsageStats
}

// CloudVoiceWorkflowResult is the Driver-normalized voice asset result.
type CloudVoiceWorkflowResult struct {
	ProviderVoiceRef string
	Metadata         map[string]any
	Usage            *runtimev1.UsageStats
}

// CloudMediaDriver owns the four r051 layers for one provider dialect:
// target/config validation, request mapping, stream/response normalization,
// and reason-code normalization. Route, Host lifecycle, and fallback
// are deliberately absent.
type CloudMediaDriver interface {
	ValidateTarget(Identity, *structpb.Struct, string) (CloudMediaTarget, error)
	MapRequest(CloudMediaTarget, *runtimev1.SubmitScenarioJobRequest, *structpb.Struct, CloudMediaStreamMode) (*CloudMediaMappedRequest, error)
	MapVoiceWorkflowRequest(CloudMediaTarget, *runtimev1.SubmitScenarioJobRequest, *structpb.Struct, CloudVoiceWorkflowConfig) (*CloudVoiceWorkflowMappedRequest, error)
	MapVoiceDeleteRequest(CloudMediaTarget, string) (*CloudVoiceDeleteMappedRequest, error)
	NormalizeStreamChunk(CloudMediaStreamChunk) (CloudMediaStreamChunk, error)
	NormalizeResponse(CloudMediaTransportResponse) (CloudMediaResult, error)
	NormalizeVoiceWorkflowResponse(CloudVoiceWorkflowTransportResponse) (CloudVoiceWorkflowResult, error)
	NormalizeReason(CloudMediaTarget, error) error
	NormalizeVoiceDeleteReason(CloudMediaTarget, error) error
}

// CloudMediaRegistry resolves an admitted existing provider dialect. It never
// sees Connector custody and cannot become an account or route selector.
type CloudMediaRegistry struct {
	drivers map[string]CloudMediaDriver
}

func NewProductionCloudMediaRegistry() *CloudMediaRegistry {
	drivers := make(map[string]CloudMediaDriver)
	for providerID, record := range providerregistry.Records {
		if record.RuntimePlane != "remote" || !providerSupportsAnyCloudMedia(record) {
			continue
		}
		drivers[providerID] = providerCloudMediaDriver{provider: providerID}
	}
	return &CloudMediaRegistry{drivers: drivers}
}

func providerSupportsAnyCloudMedia(record providerregistry.ProviderRecord) bool {
	return record.SupportsImage || record.SupportsVideo || record.SupportsTTS || record.SupportsSTT ||
		record.SupportsMusic || record.SupportsVoiceReferenceAudio || record.SupportsVoiceTextDescription || record.ID == "worldlabs"
}

// Resolve validates an exact target through one provider Driver. Provider is
// Driver configuration, not a Connector-derived routing choice.
func (r *CloudMediaRegistry) Resolve(identity Identity, rawTarget *structpb.Struct, capabilityContract string) (CloudMediaDriver, CloudMediaTarget, error) {
	provider, ok := exactCloudTargetText(rawTarget, "provider")
	if !ok || r == nil {
		return nil, CloudMediaTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("cloud media provider target is required"))
	}
	driver := r.drivers[provider]
	if driver == nil {
		return nil, CloudMediaTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("cloud media provider %q has no admitted Driver", provider))
	}
	target, err := driver.ValidateTarget(identity, rawTarget, capabilityContract)
	if err != nil {
		return nil, CloudMediaTarget{}, err
	}
	return driver, target, nil
}

type providerCloudMediaDriver struct {
	provider string
}

func (d providerCloudMediaDriver) ValidateTarget(identity Identity, raw *structpb.Struct, capabilityContract string) (CloudMediaTarget, error) {
	capabilityContract = strings.TrimSpace(capabilityContract)
	if !exactCloudIdentity(identity) {
		return CloudMediaTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("cloud implementation identity is incomplete"))
	}
	if raw == nil || len(raw.GetFields()) == 0 || capabilityContract == "" {
		return CloudMediaTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("provider media target is required"))
	}
	for key := range raw.GetFields() {
		switch key {
		case "provider", "providerModelId", "remoteModelCatalogId", "region":
		default:
			return CloudMediaTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("media target field %q is unsupported", key))
		}
	}
	provider, ok := exactCloudTargetText(raw, "provider")
	if !ok || provider != d.provider {
		return CloudMediaTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("provider target does not match Driver"))
	}
	record, ok := providerregistry.Lookup(provider)
	if !ok || !cloudMediaCapabilitySupported(record, capabilityContract) || cloudMediaAdapterFor(provider, capabilityContract) == "" {
		return CloudMediaTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("provider %q does not implement %s", provider, capabilityContract))
	}
	providerModelID, ok := exactCloudTargetText(raw, "providerModelId")
	if !ok {
		return CloudMediaTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("provider model identity is required"))
	}
	remoteModelCatalogID, ok := exactCloudTargetText(raw, "remoteModelCatalogId")
	if !ok {
		return CloudMediaTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("remote model catalog identity is required"))
	}
	region := ""
	if _, present := raw.GetFields()["region"]; present {
		var valid bool
		region, valid = exactCloudTargetText(raw, "region")
		if !valid {
			return CloudMediaTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("provider region is invalid"))
		}
	}
	return CloudMediaTarget{
		provider:             provider,
		providerModelID:      providerModelID,
		remoteModelCatalogID: remoteModelCatalogID,
		region:               region,
		capabilityContract:   capabilityContract,
	}, nil
}

func cloudMediaCapabilitySupported(record providerregistry.ProviderRecord, capability string) bool {
	switch strings.TrimSpace(capability) {
	case "image.generate":
		return record.SupportsImage
	case "video.generate":
		return record.SupportsVideo
	case "audio.synthesize":
		return record.SupportsTTS
	case "audio.transcribe":
		return record.SupportsSTT
	case "music.generate":
		return record.SupportsMusic
	case "world.generate":
		return record.ID == "worldlabs"
	case "voice.create":
		return record.SupportsVoiceReferenceAudio || record.SupportsVoiceTextDescription
	case "voice_asset.delete":
		return cloudVoiceDeleteAdapter(record.ID) != ""
	default:
		return false
	}
}

func (d providerCloudMediaDriver) MapRequest(target CloudMediaTarget, request *runtimev1.SubmitScenarioJobRequest, defaults *structpb.Struct, streamMode CloudMediaStreamMode) (*CloudMediaMappedRequest, error) {
	if target.provider != d.provider || target.providerModelID == "" || request == nil || request.GetSpec() == nil {
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("cloud media request mapping input is incomplete"))
	}
	if scenarioCapabilityContract(request.GetScenarioType()) != target.capabilityContract {
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("cloud media request capability does not match target"))
	}
	if streamMode != CloudMediaStreamNone && target.capabilityContract != "audio.synthesize" {
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("stream behavior is only valid for audio.synthesize"))
	}
	if streamMode != CloudMediaStreamNone && streamMode != CloudMediaStreamNative && streamMode != CloudMediaStreamSimulated {
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("cloud media stream behavior is invalid"))
	}
	mapped, _ := proto.Clone(request).(*runtimev1.SubmitScenarioJobRequest)
	if mapped == nil {
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("clone cloud media request"))
	}
	if err := applyCloudMediaDefaults(mapped, defaults); err != nil {
		return nil, err
	}
	if err := validateCloudMediaMappedRequest(mapped); err != nil {
		return nil, err
	}
	if mapped.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE && cloudMusicIterationRequested(mapped) && d.provider != "stability" {
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("provider does not support music iteration mapping"))
	}
	adapter := cloudMediaAdapterFor(d.provider, target.capabilityContract)
	if adapter == "" {
		return nil, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("provider %q has no %s transport dialect", d.provider, target.capabilityContract))
	}
	return &CloudMediaMappedRequest{
		providerModelID: target.providerModelID,
		adapter:         adapter,
		request:         mapped,
		streamMode:      streamMode,
		detachedPolling: cloudMediaDetachedPolling(mapped.GetScenarioType(), adapter),
	}, nil
}

func (d providerCloudMediaDriver) MapVoiceWorkflowRequest(
	target CloudMediaTarget,
	request *runtimev1.SubmitScenarioJobRequest,
	defaults *structpb.Struct,
	config CloudVoiceWorkflowConfig,
) (*CloudVoiceWorkflowMappedRequest, error) {
	if target.provider != d.provider || target.providerModelID == "" || request == nil || request.GetSpec() == nil ||
		target.capabilityContract != "voice.create" ||
		scenarioCapabilityContract(request.GetScenarioType()) != target.capabilityContract {
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("cloud voice workflow request mapping input is incomplete"))
	}
	if defaults != nil && len(defaults.GetFields()) > 0 {
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("cloud voice workflow defaults are unsupported"))
	}
	if err := validateCloudMediaMappedRequest(request); err != nil {
		return nil, err
	}
	workflowType := strings.TrimSpace(config.WorkflowType)
	workflowModelID := strings.TrimSpace(config.WorkflowModelID)
	catalogModelID := strings.TrimSpace(config.CatalogModelID)
	if workflowType == "" || workflowModelID == "" || catalogModelID == "" {
		return nil, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("cloud voice workflow configuration is incomplete"))
	}
	payload := map[string]any{
		"workflow_model_id": workflowModelID,
		"creation_source":   workflowType,
	}
	var extensions *structpb.Struct
	if config.Extensions != nil && len(config.Extensions.GetFields()) > 0 {
		extensions, _ = proto.Clone(config.Extensions).(*structpb.Struct)
		payload["extensions"] = extensions.AsMap()
	}
	spec := request.GetSpec().GetVoiceCreate()
	if spec == nil {
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("cloud voice creation spec is missing"))
	}
	switch source := spec.GetSource().(type) {
	case *runtimev1.VoiceCreateScenarioSpec_ReferenceAudio:
		input := source.ReferenceAudio
		preferredName := strings.TrimSpace(input.GetPreferredName())
		if preferredName == "" {
			preferredName = "nimi-voice-" + strings.ToLower(ulid.Make().String())
		}
		languageHints := make([]any, 0, len(input.GetLanguageHints()))
		for _, hint := range input.GetLanguageHints() {
			languageHints = append(languageHints, strings.TrimSpace(hint))
		}
		inputPayload := map[string]any{
			"reference_audio_uri":  strings.TrimSpace(input.GetReferenceAudioUri()),
			"reference_audio_mime": strings.TrimSpace(input.GetReferenceAudioMime()),
			"language_hints":       languageHints,
			"preferred_name":       preferredName,
			"text":                 strings.TrimSpace(input.GetText()),
		}
		if len(input.GetReferenceAudioBytes()) > 0 {
			inputPayload["reference_audio_base64"] = base64.StdEncoding.EncodeToString(input.GetReferenceAudioBytes())
		}
		payload["target_model_id"] = strings.TrimSpace(spec.GetTargetModelId())
		payload["input"] = inputPayload
	case *runtimev1.VoiceCreateScenarioSpec_TextDescription:
		input := source.TextDescription
		preferredName := strings.TrimSpace(input.GetPreferredName())
		if preferredName == "" {
			preferredName = "nimi-voice-" + strings.ToLower(ulid.Make().String())
		}
		payload["target_model_id"] = strings.TrimSpace(spec.GetTargetModelId())
		payload["input"] = map[string]any{
			"instruction_text": strings.TrimSpace(input.GetInstructionText()),
			"preview_text":     strings.TrimSpace(input.GetPreviewText()),
			"language":         strings.TrimSpace(input.GetLanguage()),
			"preferred_name":   preferredName,
		}
	default:
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("cloud voice workflow scenario is unsupported"))
	}
	payloadStruct, err := structpb.NewStruct(payload)
	if err != nil {
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("map cloud voice workflow request: %w", err))
	}
	adapter := cloudMediaAdapterFor(target.provider, target.capabilityContract)
	if adapter == "" {
		return nil, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("provider has no voice workflow transport dialect"))
	}
	return &CloudVoiceWorkflowMappedRequest{
		provider:        target.provider,
		adapter:         adapter,
		workflowType:    workflowType,
		workflowModelID: workflowModelID,
		modelID:         catalogModelID,
		payload:         payloadStruct,
		extensions:      extensions,
	}, nil
}

func (d providerCloudMediaDriver) MapVoiceDeleteRequest(target CloudMediaTarget, providerVoiceRef string) (*CloudVoiceDeleteMappedRequest, error) {
	providerVoiceRef = strings.TrimSpace(providerVoiceRef)
	if target.provider != d.provider || !cloudVoiceDeleteSourceCapability(target.capabilityContract) || providerVoiceRef == "" {
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("cloud voice delete request mapping input is invalid"))
	}
	adapter := cloudVoiceDeleteAdapter(d.provider)
	if adapter == "" {
		return nil, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("provider has no voice delete transport dialect"))
	}
	return &CloudVoiceDeleteMappedRequest{provider: d.provider, adapter: adapter, providerVoiceRef: providerVoiceRef}, nil
}

func cloudVoiceDeleteSourceCapability(capability string) bool {
	return capability == "voice_asset.delete" || capability == "voice.create"
}

func scenarioCapabilityContract(scenarioType runtimev1.ScenarioType) string {
	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE:
		return "image.generate"
	case runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE:
		return "video.generate"
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		return "audio.synthesize"
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		return "audio.transcribe"
	case runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE:
		return "music.generate"
	case runtimev1.ScenarioType_SCENARIO_TYPE_WORLD_GENERATE:
		return "world.generate"
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE:
		return "voice.create"
	default:
		return ""
	}
}

// ResolveCloudMediaAdapter exposes Driver-owned dialect resolution to bounded
// diagnostics and tests. Execution captures the same value through MapRequest.
func ResolveCloudMediaAdapter(provider string, capability string) string {
	return cloudMediaAdapterFor(provider, capability)
}

func cloudMediaAdapterFor(provider string, capability string) string {
	provider = strings.ToLower(strings.TrimSpace(provider))
	record, ok := providerregistry.Lookup(provider)
	if !ok || !cloudMediaCapabilitySupported(record, capability) {
		return ""
	}
	if capability == "voice_asset.delete" {
		return cloudVoiceDeleteAdapter(provider)
	}
	if capability == "voice.create" {
		switch provider {
		case "dashscope":
			return CloudMediaAdapterDashScopeVoiceWorkflow
		case "elevenlabs":
			return CloudMediaAdapterElevenLabsVoiceWorkflow
		case "fish_audio":
			return CloudMediaAdapterFishAudioVoiceWorkflow
		case "mimo":
			return CloudMediaAdapterMimoVoiceWorkflow
		case "stepfun":
			return CloudMediaAdapterStepFunVoiceWorkflow
		default:
			return ""
		}
	}
	switch provider {
	case "volcengine_openspeech":
		if capability == "audio.synthesize" || capability == "audio.transcribe" {
			return CloudMediaAdapterBytedanceOpenSpeech
		}
	case "volcengine":
		if capability == "image.generate" || capability == "video.generate" {
			return CloudMediaAdapterBytedanceARKTask
		}
	case "dashscope":
		switch capability {
		case "image.generate", "video.generate", "audio.synthesize":
			return CloudMediaAdapterAlibabaNative
		case "audio.transcribe":
			return CloudMediaAdapterDashScopeChatSTT
		}
	case "gemini":
		switch capability {
		case "image.generate", "video.generate", "audio.synthesize":
			return CloudMediaAdapterGeminiOperation
		case "audio.transcribe":
			return CloudMediaAdapterGeminiChatSTT
		}
	case "mimo":
		if capability == "audio.synthesize" {
			return CloudMediaAdapterMimoChatTTS
		}
		if capability == "audio.transcribe" {
			return CloudMediaAdapterMimoChatSTT
		}
	case "minimax":
		return CloudMediaAdapterMiniMaxTask
	case "glm":
		if capability == "video.generate" {
			return CloudMediaAdapterGLMTask
		}
		return CloudMediaAdapterGLMNative
	case "kimi":
		if capability == "image.generate" {
			return CloudMediaAdapterKimiChatMultimodal
		}
	case "elevenlabs":
		if capability == "audio.synthesize" {
			return CloudMediaAdapterElevenLabsNative
		}
		return ""
	case "fish_audio":
		return CloudMediaAdapterFishAudioNative
	case "aws_polly":
		return CloudMediaAdapterAWSPollyNative
	case "azure_speech":
		return CloudMediaAdapterAzureSpeechNative
	case "google_cloud_tts":
		return CloudMediaAdapterGoogleCloudTTS
	case "flux":
		return CloudMediaAdapterFluxNative
	case "ideogram":
		return CloudMediaAdapterIdeogramNative
	case "stability":
		if capability == "music.generate" {
			return CloudMediaAdapterStabilityMusic
		}
		return CloudMediaAdapterStabilityNative
	case "kling":
		return CloudMediaAdapterKlingTask
	case "luma":
		return CloudMediaAdapterLumaTask
	case "pika":
		return CloudMediaAdapterPikaTask
	case "runway":
		return CloudMediaAdapterRunwayTask
	case "google_veo":
		return CloudMediaAdapterGoogleVeoOperation
	case "stepfun":
		return CloudMediaAdapterStepFunNative
	case "soundverse":
		return CloudMediaAdapterSoundverseMusic
	case "mubert":
		return CloudMediaAdapterMubertMusic
	case "loudly":
		return CloudMediaAdapterLoudlyMusic
	case "worldlabs":
		return CloudMediaAdapterWorldLabsNative
	}
	return CloudMediaAdapterOpenAICompat
}

// CloudVoiceDeleteSupported reports Driver admission for provider-persistent
// voice deletion without exposing provider routing to a service or Host.
func CloudVoiceDeleteSupported(provider string) bool {
	return cloudVoiceDeleteAdapter(provider) != ""
}

func cloudVoiceDeleteAdapter(provider string) string {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "elevenlabs":
		return CloudMediaAdapterElevenLabsVoiceDelete
	case "fish_audio":
		return CloudMediaAdapterFishAudioVoiceDelete
	default:
		return ""
	}
}

// CloudMediaUsesDetachedPolling reports whether the exact Driver mapping uses
// a provider async task. Polling itself remains private to Remote Host.
func CloudMediaUsesDetachedPolling(scenarioType runtimev1.ScenarioType, adapter string) bool {
	return cloudMediaDetachedPolling(scenarioType, adapter)
}

func cloudMediaDetachedPolling(scenarioType runtimev1.ScenarioType, adapter string) bool {
	if scenarioType == runtimev1.ScenarioType_SCENARIO_TYPE_WORLD_GENERATE {
		return adapter == CloudMediaAdapterWorldLabsNative
	}
	if scenarioType != runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE {
		return false
	}
	switch adapter {
	case CloudMediaAdapterBytedanceARKTask,
		CloudMediaAdapterAlibabaNative,
		CloudMediaAdapterGeminiOperation,
		CloudMediaAdapterMiniMaxTask,
		CloudMediaAdapterGLMTask,
		CloudMediaAdapterKlingTask,
		CloudMediaAdapterLumaTask,
		CloudMediaAdapterPikaTask,
		CloudMediaAdapterRunwayTask,
		CloudMediaAdapterGoogleVeoOperation:
		return true
	default:
		return false
	}
}

func (providerCloudMediaDriver) NormalizeStreamChunk(chunk CloudMediaStreamChunk) (CloudMediaStreamChunk, error) {
	if chunk.FailureReason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		return CloudMediaStreamChunk{}, grpcerr.WithReasonCode(mediaReasonGRPCCode(chunk.FailureReason), chunk.FailureReason)
	}
	if len(chunk.Bytes) == 0 {
		return CloudMediaStreamChunk{}, nil
	}
	mimeType := strings.ToLower(strings.TrimSpace(chunk.MIMEType))
	if mimeType != "" && !strings.HasPrefix(mimeType, "audio/") && mimeType != "application/octet-stream" {
		return CloudMediaStreamChunk{}, cloudInvocationError(CloudInvocationFailureResponse, fmt.Errorf("provider stream returned non-audio content"))
	}
	chunk.Bytes = append([]byte(nil), chunk.Bytes...)
	chunk.MIMEType = strings.TrimSpace(chunk.MIMEType)
	return chunk, nil
}

func (providerCloudMediaDriver) NormalizeVoiceWorkflowResponse(response CloudVoiceWorkflowTransportResponse) (CloudVoiceWorkflowResult, error) {
	providerVoiceRef := strings.TrimSpace(response.ProviderVoiceRef)
	if providerVoiceRef == "" {
		return CloudVoiceWorkflowResult{}, cloudInvocationError(CloudInvocationFailureResponse, fmt.Errorf("provider returned no voice reference"))
	}
	metadata := map[string]any{}
	if sanitized := sanitizeCloudMediaMetadata(response.Metadata); sanitized != nil {
		metadata = sanitized.AsMap()
	}
	var usage *runtimev1.UsageStats
	if response.Usage != nil {
		usage, _ = proto.Clone(response.Usage).(*runtimev1.UsageStats)
	}
	return CloudVoiceWorkflowResult{
		ProviderVoiceRef: providerVoiceRef,
		Metadata:         metadata,
		Usage:            usage,
	}, nil
}

func (providerCloudMediaDriver) NormalizeResponse(response CloudMediaTransportResponse) (CloudMediaResult, error) {
	fail := func(err error) (CloudMediaResult, error) {
		closeArtifactBodies(response.ArtifactBodies)
		return CloudMediaResult{}, err
	}
	finish := response.FinishReason
	if finish == runtimev1.FinishReason_FINISH_REASON_UNSPECIFIED {
		finish = runtimev1.FinishReason_FINISH_REASON_STOP
	}
	if finish == runtimev1.FinishReason_FINISH_REASON_ERROR {
		return fail(cloudInvocationError(CloudInvocationFailureResponse, fmt.Errorf("provider returned an error finish reason without an error")))
	}
	artifacts := cloneCloudMediaArtifacts(response.Artifacts)
	if !response.Streamed && len(artifacts) == 0 {
		return fail(cloudInvocationError(CloudInvocationFailureResponse, fmt.Errorf("provider returned no media artifact")))
	}
	if len(response.ArtifactBodies) != len(artifacts) {
		return fail(cloudInvocationError(CloudInvocationFailureResponse, fmt.Errorf("remote media artifact body count is invalid")))
	}
	for _, artifact := range artifacts {
		if artifact.GetArtifactId() == "" || artifact.GetArtifactId() != strings.TrimSpace(artifact.GetArtifactId()) {
			return fail(cloudInvocationError(CloudInvocationFailureResponse, fmt.Errorf("provider artifact identity is invalid")))
		}
		body, ok := response.ArtifactBodies[artifact.GetArtifactId()]
		if !ok || !body.valid() || len(artifact.GetBytes()) != 0 || strings.TrimSpace(artifact.GetUri()) != "" {
			return fail(cloudInvocationError(CloudInvocationFailureResponse, fmt.Errorf("remote media artifact body handoff is invalid")))
		}
		// Provider URLs and polling envelopes are transport details. The public
		// artifact is identified by its Runtime artifact id and owned bytes.
		artifact.Uri = ""
		artifact.Metadata = sanitizeCloudMediaMetadata(artifact.GetMetadata())
	}
	var usage *runtimev1.UsageStats
	if response.Usage != nil {
		usage, _ = proto.Clone(response.Usage).(*runtimev1.UsageStats)
	}
	return CloudMediaResult{
		Artifacts:      artifacts,
		ArtifactBodies: response.ArtifactBodies,
		Usage:          usage,
		FinishReason:   finish,
		Streamed:       response.Streamed,
	}, nil
}

func closeArtifactBodies(values map[string]*ArtifactBody) {
	for _, body := range values {
		if body == nil {
			continue
		}
		if stream := body.TakeIncrementalStream(); stream != nil {
			_ = stream.Close()
		}
	}
}

func CloseArtifactBodies(values map[string]*ArtifactBody) {
	closeArtifactBodies(values)
}

func cloneCloudMediaArtifacts(values []*runtimev1.ScenarioArtifact) []*runtimev1.ScenarioArtifact {
	if len(values) == 0 {
		return nil
	}
	out := make([]*runtimev1.ScenarioArtifact, 0, len(values))
	for _, value := range values {
		if value == nil {
			continue
		}
		cloned, _ := proto.Clone(value).(*runtimev1.ScenarioArtifact)
		if cloned != nil {
			out = append(out, cloned)
		}
	}
	return out
}

func sanitizeCloudMediaMetadata(input *structpb.Struct) *structpb.Struct {
	if input == nil {
		return nil
	}
	values := sanitizeCloudMediaMetadataMap(input.AsMap())
	if len(values) == 0 {
		return nil
	}
	out, err := structpb.NewStruct(values)
	if err != nil {
		return nil
	}
	return out
}

func sanitizeCloudMediaMetadataMap(input map[string]any) map[string]any {
	out := make(map[string]any, len(input))
	for key, value := range input {
		if isPrivateCloudMediaMetadataKey(key) {
			continue
		}
		switch typed := value.(type) {
		case map[string]any:
			nested := sanitizeCloudMediaMetadataMap(typed)
			if len(nested) > 0 {
				out[key] = nested
			}
		case []any:
			items := make([]any, 0, len(typed))
			for _, item := range typed {
				if nested, ok := item.(map[string]any); ok {
					clean := sanitizeCloudMediaMetadataMap(nested)
					if len(clean) > 0 {
						items = append(items, clean)
					}
					continue
				}
				items = append(items, item)
			}
			if len(items) > 0 {
				out[key] = items
			}
		default:
			out[key] = value
		}
	}
	return out
}

func isPrivateCloudMediaMetadataKey(key string) bool {
	normalized := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(key), "-", "_"))
	switch normalized {
	case "response", "provider_response", "submit_response", "provider_job_id", "job_id", "task_id", "request_id",
		"operation_id", "provider_operation", "track_id", "generation_id", "submit_endpoint", "query_endpoint",
		"poll_endpoint", "task_status", "job_status", "operation_status", "next_poll_at", "retry_after", "uri", "url":
		return true
	default:
		return strings.HasSuffix(normalized, "_url") || strings.HasSuffix(normalized, "_uri")
	}
}

func (providerCloudMediaDriver) NormalizeReason(target CloudMediaTarget, err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) || status.Code(err) == codes.Canceled {
		return grpcerr.WrapWithReasonCode(codes.Canceled, runtimev1.ReasonCode_ACTION_EXECUTED, err, grpcerr.ReasonOptions{Message: "remote media execution canceled"})
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return grpcerr.WrapWithReasonCode(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, err, grpcerr.ReasonOptions{Message: "provider request timed out"})
	}
	if metadata, ok := grpcerr.ExtractReasonMetadata(err); ok {
		if statusCode, parseErr := strconv.Atoi(metadata["provider_http_status"]); parseErr == nil && statusCode > 0 {
			reason := CloudMediaReasonForHTTPStatus(target.CapabilityContract(), statusCode)
			// Body-aware transport classification can be more specific than the
			// HTTP class (for example a 400 quota, model, or content rejection).
			if existing, exists := grpcerr.ExtractReasonCode(err); exists && cloudMediaSpecificTransportReason(statusCode, existing) {
				reason = existing
			}
			grpcCode := mediaReasonGRPCCode(reason)
			return grpcerr.WrapWithReasonCode(grpcCode, reason, err, grpcerr.ReasonOptions{Metadata: map[string]string{"provider_http_status": strconv.Itoa(statusCode)}})
		}
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); ok {
		switch reason {
		case runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED,
			runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED,
			runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
			runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT,
			runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
			runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN,
			runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING,
			runtimev1.ReasonCode_AI_MODEL_NOT_FOUND,
			runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED,
			runtimev1.ReasonCode_AI_INPUT_INVALID,
			runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID,
			runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED,
			runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID,
			runtimev1.ReasonCode_AI_VOICE_TARGET_MODEL_MISMATCH,
			runtimev1.ReasonCode_AI_VOICE_ASSET_SCOPE_FORBIDDEN,
			runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED,
			runtimev1.ReasonCode_AI_OUTPUT_INVALID,
			runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED:
			return err
		}
	}
	switch status.Code(err) {
	case codes.Unauthenticated, codes.PermissionDenied:
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED, err, grpcerr.ReasonOptions{})
	case codes.ResourceExhausted:
		return grpcerr.WrapWithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED, err, grpcerr.ReasonOptions{})
	case codes.DeadlineExceeded:
		return grpcerr.WrapWithReasonCode(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, err, grpcerr.ReasonOptions{})
	default:
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{Message: "provider media request failed"})
	}
}

func (d providerCloudMediaDriver) NormalizeVoiceDeleteReason(target CloudMediaTarget, err error) error {
	if target.provider != d.provider || !cloudVoiceDeleteSourceCapability(target.capabilityContract) {
		return cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("voice delete Driver target is invalid"))
	}
	target.capabilityContract = "voice_asset.delete"
	return d.NormalizeReason(target, err)
}

func cloudMediaSpecificTransportReason(statusCode int, reason runtimev1.ReasonCode) bool {
	if statusCode >= 500 {
		// A small set of existing speech dialects use 502/503 to reject an
		// unsupported voice or audio option; their body classifier is exact.
		return reason == runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED
	}
	if statusCode == http.StatusRequestTimeout || statusCode == http.StatusGatewayTimeout || statusCode == http.StatusTooManyRequests {
		return false
	}
	switch reason {
	case runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED,
		runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED,
		runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN,
		runtimev1.ReasonCode_AI_MODEL_NOT_FOUND,
		runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED,
		runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED,
		runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID,
		runtimev1.ReasonCode_AI_VOICE_TARGET_MODEL_MISMATCH,
		runtimev1.ReasonCode_AI_VOICE_ASSET_SCOPE_FORBIDDEN,
		runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED:
		return true
	default:
		return false
	}
}

func mediaReasonGRPCCode(reason runtimev1.ReasonCode) codes.Code {
	switch reason {
	case runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED,
		runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN:
		return codes.FailedPrecondition
	case runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED:
		return codes.ResourceExhausted
	case runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT:
		return codes.DeadlineExceeded
	case runtimev1.ReasonCode_AI_MODEL_NOT_FOUND:
		return codes.NotFound
	case runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED,
		runtimev1.ReasonCode_AI_VOICE_ASSET_SCOPE_FORBIDDEN:
		return codes.PermissionDenied
	case runtimev1.ReasonCode_AI_INPUT_INVALID,
		runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID,
		runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED,
		runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED,
		runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID,
		runtimev1.ReasonCode_AI_VOICE_TARGET_MODEL_MISMATCH,
		runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED:
		return codes.InvalidArgument
	default:
		return codes.Internal
	}
}

// CloudMediaReasonForHTTPStatus is the capability-aware Driver reason table.
func CloudMediaReasonForHTTPStatus(capability string, statusCode int) runtimev1.ReasonCode {
	switch {
	case statusCode == http.StatusUnauthorized || statusCode == http.StatusForbidden:
		return runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED
	case statusCode == http.StatusTooManyRequests:
		return runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED
	case statusCode == http.StatusRequestTimeout || statusCode == http.StatusGatewayTimeout:
		return runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT
	case statusCode == http.StatusNotFound:
		return runtimev1.ReasonCode_AI_MODEL_NOT_FOUND
	case statusCode == http.StatusUnsupportedMediaType:
		return runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED
	case statusCode == http.StatusBadRequest || statusCode == http.StatusConflict ||
		statusCode == http.StatusRequestEntityTooLarge || statusCode == http.StatusUnprocessableEntity:
		if strings.TrimSpace(capability) == "voice.create" {
			return runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID
		}
		if strings.TrimSpace(capability) == "audio.synthesize" {
			return runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED
		}
		return runtimev1.ReasonCode_AI_INPUT_INVALID
	case statusCode >= 500 && statusCode <= 599:
		return runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
	default:
		return runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
	}
}

func applyCloudMediaDefaults(request *runtimev1.SubmitScenarioJobRequest, defaults *structpb.Struct) error {
	if defaults == nil || len(defaults.GetFields()) == 0 {
		return nil
	}
	message, allowed, replace := cloudMediaSpecForDefaults(request)
	if message == nil || len(allowed) == 0 || replace == nil {
		return cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("cloud media defaults are unsupported for scenario"))
	}
	descriptor := message.ProtoReflect().Descriptor()
	currentRaw, err := protojson.MarshalOptions{UseProtoNames: false}.Marshal(message)
	if err != nil {
		return cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("marshal cloud media request defaults: %w", err))
	}
	current := map[string]any{}
	if err := json.Unmarshal(currentRaw, &current); err != nil {
		return cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("decode cloud media request defaults: %w", err))
	}
	for key, value := range defaults.GetFields() {
		field := cloudMediaDefaultField(descriptor, key)
		if field == nil || !allowed[string(field.Name())] {
			return cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("cloud media default %q is unsupported", key))
		}
		jsonName := field.JSONName()
		incoming := value.AsInterface()
		if existing, exists := current[jsonName]; exists {
			current[jsonName] = mergeCloudMediaDefault(existing, incoming)
		} else {
			current[jsonName] = incoming
		}
	}
	mergedRaw, err := json.Marshal(current)
	if err != nil {
		return cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("encode cloud media defaults: %w", err))
	}
	mapped := message.ProtoReflect().New().Interface()
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(mergedRaw, mapped); err != nil {
		return cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("cloud media defaults are invalid: %w", err))
	}
	replace(mapped)
	return nil
}

func cloudMediaDefaultField(descriptor protoreflect.MessageDescriptor, key string) protoreflect.FieldDescriptor {
	trimmed := strings.TrimSpace(key)
	if trimmed == "" {
		return nil
	}
	fields := descriptor.Fields()
	for index := 0; index < fields.Len(); index++ {
		field := fields.Get(index)
		if trimmed == string(field.Name()) || trimmed == field.JSONName() {
			return field
		}
	}
	return nil
}

func mergeCloudMediaDefault(existing any, incoming any) any {
	existingMap, existingOK := existing.(map[string]any)
	incomingMap, incomingOK := incoming.(map[string]any)
	if !existingOK || !incomingOK {
		return existing
	}
	merged := make(map[string]any, len(existingMap)+len(incomingMap))
	for key, value := range incomingMap {
		merged[key] = value
	}
	for key, value := range existingMap {
		if defaultValue, exists := merged[key]; exists {
			merged[key] = mergeCloudMediaDefault(value, defaultValue)
		} else {
			merged[key] = value
		}
	}
	return merged
}

func cloudMediaSpecForDefaults(request *runtimev1.SubmitScenarioJobRequest) (proto.Message, map[string]bool, func(proto.Message)) {
	if request == nil || request.GetSpec() == nil {
		return nil, nil, nil
	}
	allowed := func(values ...string) map[string]bool {
		out := make(map[string]bool, len(values))
		for _, value := range values {
			out[value] = true
		}
		return out
	}
	switch request.GetScenarioType() {
	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE:
		return request.GetSpec().GetImageGenerate(), allowed("negative_prompt", "n", "size", "aspect_ratio", "quality", "style", "seed", "response_format"), func(value proto.Message) {
			request.Spec.Spec = &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: value.(*runtimev1.ImageGenerateScenarioSpec)}
		}
	case runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE:
		return request.GetSpec().GetVideoGenerate(), allowed("negative_prompt", "mode", "options"), func(value proto.Message) {
			request.Spec.Spec = &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: value.(*runtimev1.VideoGenerateScenarioSpec)}
		}
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		return request.GetSpec().GetSpeechSynthesize(), allowed("language", "audio_format", "sample_rate_hz", "speed", "pitch", "volume", "emotion", "timing_mode", "voice_render_hints"), func(value proto.Message) {
			request.Spec.Spec = &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: value.(*runtimev1.SpeechSynthesizeScenarioSpec)}
		}
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		return request.GetSpec().GetSpeechTranscribe(), allowed("mime_type", "language", "timestamps", "diarization", "speaker_count", "prompt", "response_format"), func(value proto.Message) {
			request.Spec.Spec = &runtimev1.ScenarioSpec_SpeechTranscribe{SpeechTranscribe: value.(*runtimev1.SpeechTranscribeScenarioSpec)}
		}
	case runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE:
		return request.GetSpec().GetMusicGenerate(), allowed("negative_prompt", "lyrics", "style", "title", "duration_seconds", "instrumental"), func(value proto.Message) {
			request.Spec.Spec = &runtimev1.ScenarioSpec_MusicGenerate{MusicGenerate: value.(*runtimev1.MusicGenerateScenarioSpec)}
		}
	case runtimev1.ScenarioType_SCENARIO_TYPE_WORLD_GENERATE:
		return request.GetSpec().GetWorldGenerate(), allowed("display_name", "tags", "seed"), func(value proto.Message) {
			request.Spec.Spec = &runtimev1.ScenarioSpec_WorldGenerate{WorldGenerate: value.(*runtimev1.WorldGenerateScenarioSpec)}
		}
	default:
		return nil, nil, nil
	}
}

func cloudMusicIterationRequested(request *runtimev1.SubmitScenarioJobRequest) bool {
	if request == nil {
		return false
	}
	for _, extension := range request.GetExtensions() {
		if strings.TrimSpace(extension.GetNamespace()) == "nimi.scenario.music_generate.request" && extension.GetPayload() != nil && len(extension.GetPayload().GetFields()) > 0 {
			return true
		}
	}
	return false
}

func validateCloudMediaMappedRequest(request *runtimev1.SubmitScenarioJobRequest) error {
	if request == nil || request.GetSpec() == nil {
		return cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("cloud media request is required"))
	}
	switch request.GetScenarioType() {
	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE:
		spec := request.GetSpec().GetImageGenerate()
		if spec == nil || strings.TrimSpace(spec.GetPrompt()) == "" || spec.GetN() < 0 || spec.GetN() > 16 {
			return cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("image.generate request is invalid"))
		}
	case runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE:
		if request.GetSpec().GetVideoGenerate() == nil {
			return cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("video.generate request is invalid"))
		}
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		spec := request.GetSpec().GetSpeechSynthesize()
		if spec == nil || strings.TrimSpace(spec.GetText()) == "" ||
			spec.GetSampleRateHz() < 0 || spec.GetSampleRateHz() > 192000 ||
			!finiteCloudMediaFloat(spec.GetSpeed()) || spec.GetSpeed() < 0 || spec.GetSpeed() > 4 ||
			!finiteCloudMediaFloat(spec.GetPitch()) || spec.GetPitch() < -24 || spec.GetPitch() > 24 ||
			!finiteCloudMediaFloat(spec.GetVolume()) || spec.GetVolume() < 0 || spec.GetVolume() > 4 {
			return cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("audio.synthesize parameters are invalid"))
		}
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		spec := request.GetSpec().GetSpeechTranscribe()
		if spec == nil || spec.GetAudioSource() == nil || spec.GetSpeakerCount() < 0 || spec.GetSpeakerCount() > 32 {
			return cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("audio.transcribe request is invalid"))
		}
	case runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE:
		spec := request.GetSpec().GetMusicGenerate()
		if spec == nil || strings.TrimSpace(spec.GetPrompt()) == "" || spec.GetDurationSeconds() < 0 || spec.GetDurationSeconds() > 600 {
			return cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("music.generate request is invalid"))
		}
	case runtimev1.ScenarioType_SCENARIO_TYPE_WORLD_GENERATE:
		if request.GetSpec().GetWorldGenerate() == nil {
			return cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("world.generate request is invalid"))
		}
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE:
		spec := request.GetSpec().GetVoiceCreate()
		if spec == nil || spec.GetSource() == nil || strings.TrimSpace(spec.GetTargetModelId()) == "" {
			return cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("voice creation request is invalid"))
		}
	default:
		return cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("cloud media scenario is unsupported"))
	}
	return nil
}

func finiteCloudMediaFloat(value float32) bool {
	number := float64(value)
	return !math.IsNaN(number) && !math.IsInf(number, 0)
}
