package nimillm

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"math"
	"mime"
	"mime/multipart"
	"net/http"
	"strconv"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

const stabilityAudioQueryPath = "/v2beta/audio/results/{task_id}"

// @nimi-authority: rule.nimi.runtime.ai-provider.music-generation
// The native audio reference transforms a new mix at fixed denoising strength
// 0.5. Range clipping has already happened in Runtime's owned input capture.
func ValidateStabilityMusicReference(model string, reference *MusicReferenceAudio) error {
	maximum := capabilitydriver.StabilityMusicMaxDuration(model)
	if reference == nil || maximum == 0 || reference.MIMEType != "audio/wav" || len(reference.Bytes) == 0 || len(reference.Bytes) > 32<<20 || math.IsNaN(reference.DurationSeconds) || reference.DurationSeconds < 6 || reference.DurationSeconds > float64(maximum) {
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{Message: "Stable Audio reference must be an owned WAV of 6 seconds up to the selected model limit, within 32 MiB"})
	}
	return nil
}

func ExecuteStabilityMusic(ctx context.Context, cfg MediaAdapterConfig, req *runtimev1.SubmitScenarioJobRequest, model string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	s := req.GetSpec().GetMusicGenerate()
	if s == nil || capabilitydriver.StabilityMusicMaxDuration(model) == 0 {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	async := model == "stable-audio-3"
	path, format := "/v2beta/audio/stable-audio-2", "mp3"
	if async {
		if err := requireNativeTaskPublisher(ctx); err != nil {
			return nil, nil, "", err
		}
		path, format = "/v2beta/audio/stable-audio", "wav"
	}
	fields := map[string]string{"prompt": s.GetPrompt(), "model": model, "duration": strconv.Itoa(int(s.GetDurationSeconds())), "output_format": format, "seed": strconv.FormatUint(uint64(s.GetSeed()), 10)}
	var reference *MusicReferenceAudio
	if s.GetAudioReference() != nil {
		reference, _ = ctx.Value(musicReferenceContextKey{}).(*MusicReferenceAudio)
		if reference == nil || reference.ArtifactID != s.GetAudioReference().GetArtifactId() {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
		fields["strength"] = "0.5"
		path += "/audio-to-audio"
	} else {
		path += "/text-to-audio"
	}
	if async {
		ctx = nativeCreateRequest(ctx)
	}
	response, err := stabilityMultipart(ctx, cfg, path, "audio/*", fields, func(w *multipart.Writer) error {
		if reference == nil {
			return nil
		}
		file, err := w.CreateFormFile("audio", "reference.wav")
		if err != nil {
			return err
		}
		_, err = file.Write(reference.Bytes)
		return err
	})
	if err != nil {
		return nil, nil, "", err
	}
	defer func(cleanup func() error) { _ = cleanup() }(response.Body.Close)
	if async {
		if response.StatusCode != http.StatusAccepted {
			return nil, nil, "", stabilityResponseError(response)
		}
		raw, err := readLimitedResponseBody(response.Body, maxJSONOrBinaryResponseBytes)
		if err != nil {
			return nil, nil, "", markNativeCreateResponseUnavailable(ctx, providerResponseReadError(err))
		}
		var receipt struct {
			ID string `json:"id"`
		}
		if json.Unmarshal(raw, &receipt) != nil || !validStabilityTaskID(receipt.ID) {
			return nil, nil, "", stabilityInvalidOutput()
		}
		_, err = publishNativeTask(ctx, &NativeTaskReceipt{Version: 1, Adapter: AdapterStabilityMusic, Model: model, TaskID: receipt.ID, QueryPathTemplate: stabilityAudioQueryPath, Artifact: BinaryArtifact("audio/wav", nil, map[string]any{"adapter": AdapterStabilityMusic})})
		return nil, nil, receipt.ID, err
	}
	seed, err := stabilityResultHeaders(response)
	if err != nil {
		return nil, nil, "", err
	}
	mimeType, err := stabilityAudioMIME(response, "audio/mpeg")
	if err != nil {
		return nil, nil, "", err
	}
	raw, err := readLimitedResponseBody(response.Body, maxJSONOrBinaryResponseBytes)
	if err != nil {
		return nil, nil, "", providerResponseReadError(err)
	}
	if len(raw) == 0 {
		return nil, nil, "", stabilityInvalidOutput()
	}
	return []*runtimev1.ScenarioArtifact{BinaryArtifact(mimeType, raw, map[string]any{"adapter": AdapterStabilityMusic, "actual_seed": seed})}, nil, "", nil
}

func validStabilityTaskID(id string) bool {
	if len(id) != 64 {
		return false
	}
	for _, ch := range id {
		if !(ch >= 'a' && ch <= 'f' || ch >= '0' && ch <= '9') {
			return false
		}
	}
	return true
}

func stabilityAudioMIME(response *http.Response, expected string) (string, error) {
	value, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if value == "audio/x-wav" {
		value = "audio/wav"
	}
	if err != nil || value != expected || response.ContentLength == 0 || response.ContentLength > 512<<20 {
		return "", stabilityInvalidOutput()
	}
	return value, nil
}

// The original-result GET is also the status API. Inspect headers, close the
// unacquired body, then let the existing custody owner stream that exact result.
func observeStabilityAudio(ctx context.Context, cfg MediaAdapterConfig, r *NativeTaskReceipt) (*NativeTaskObservation, bool, error) {
	target := JoinURL(cfg.BaseURL, ResolveTaskQueryPath(stabilityAudioQueryPath, r.TaskID))
	response, err := stabilityRequest(ctx, cfg, http.MethodGet, target, "audio/*", "", nil)
	if err != nil {
		return nil, false, err
	}
	defer func(cleanup func() error) { _ = cleanup() }(response.Body.Close)
	if response.StatusCode == http.StatusAccepted {
		raw, err := readLimitedResponseBody(response.Body, maxJSONOrBinaryResponseBytes)
		if err != nil {
			return nil, false, providerResponseReadError(err)
		}
		var pending struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		}
		if json.Unmarshal(raw, &pending) != nil || pending.ID != r.TaskID || pending.Status != "in-progress" {
			return nil, false, stabilityInvalidOutput()
		}
		return nil, false, nil
	}
	if response.StatusCode == http.StatusNotFound {
		return nil, true, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_PROVIDER_TASK_EXPIRED)
	}
	seed, err := stabilityResultHeaders(response)
	if err != nil {
		reason, _ := grpcerr.ExtractReasonCode(err)
		return nil, reason == runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED, err
	}
	if _, err := stabilityAudioMIME(response, "audio/wav"); err != nil {
		return nil, false, err
	}
	artifact := proto.Clone(r.Artifact).(*runtimev1.ScenarioArtifact)
	artifact.Uri = target
	artifact.Metadata = ToStruct(map[string]any{"adapter": AdapterStabilityMusic, "actual_seed": seed})
	return &NativeTaskObservation{Artifacts: []*runtimev1.ScenarioArtifact{artifact}}, true, nil
}

func openStabilityAudio(ctx context.Context, cfg MediaAdapterConfig, r *NativeTaskReceipt, uri string, expectedSeed uint32) (io.ReadCloser, string, int64, error) {
	target := JoinURL(cfg.BaseURL, ResolveTaskQueryPath(stabilityAudioQueryPath, r.TaskID))
	if uri != target {
		return nil, "", -1, stabilityInvalidOutput()
	}
	key, err := requireProviderAPIKey(cfg.APIKey)
	if err != nil {
		return nil, "", -1, err
	}
	limits := defaultMediaBodyLimits()
	limits.bytes = 512 << 20
	client, request, budget, err := newMediaBodyRequest(ctx, target, limits)
	if err != nil {
		return nil, "", -1, err
	}
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	applyProviderRequestHeaders(request, cfg.Headers)
	request.Header.Set("Authorization", "Bearer "+key)
	request.Header.Set("Accept", "audio/*")
	response, err := client.Do(request)
	if err != nil {
		budget.close()
		return nil, "", -1, MapProviderRequestError(err)
	}
	budget.headersComplete(response.ContentLength)
	response.Body = &budgetedMediaBody{ReadCloser: response.Body, budget: budget}
	seed, err := stabilityResultHeaders(response)
	if err != nil {
		_ = response.Body.Close()
		return nil, "", -1, err
	}
	if seed != expectedSeed {
		_ = response.Body.Close()
		return nil, "", -1, stabilityInvalidOutput()
	}
	mimeType, err := stabilityAudioMIME(response, "audio/wav")
	if err != nil {
		_ = response.Body.Close()
		return nil, "", -1, err
	}
	buffered := bufio.NewReaderSize(response.Body, 512)
	head, err := buffered.Peek(12)
	if err != nil || string(head[:4]) != "RIFF" || string(head[8:12]) != "WAVE" {
		_ = response.Body.Close()
		return nil, "", -1, stabilityInvalidOutput()
	}
	return &boundedMediaArtifactStream{ReadCloser: &peekedMediaArtifactStream{Reader: buffered, Closer: response.Body}, remaining: limits.bytes + 1}, mimeType, response.ContentLength, nil
}
