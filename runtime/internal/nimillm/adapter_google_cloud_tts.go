package nimillm

import (
	"context"
	"encoding/base64"
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const AdapterGoogleCloudTTS = "google_cloud_tts_adapter"

// ExecuteGoogleCloudTTS consumes the Driver-captured single-speaker request.
// This is Cloud TTS's JSON/Bearer protocol, not the Gemini API dialect.
func ExecuteGoogleCloudTTS(ctx context.Context, cfg MediaAdapterConfig, req *runtimev1.SubmitScenarioJobRequest, modelResolved string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	apiKey, err := requireProviderAPIKey(cfg.APIKey)
	if err != nil {
		return nil, nil, "", err
	}
	s := req.GetSpec().GetSpeechSynthesize()
	if s == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	input := map[string]any{"text": s.GetText()}
	if s.GetEmotion() != "" {
		input["prompt"] = s.GetEmotion()
	}
	voice := map[string]any{"languageCode": s.GetLanguage(), "name": scenarioVoiceRef(s)}
	if modelResolved != "chirp-3-hd" {
		voice["modelName"] = modelResolved
	}
	wireEncoding := map[string]string{"wav": "LINEAR16", "mp3": "MP3", "ogg": "OGG_OPUS", "pcm": "PCM", "mulaw": "MULAW", "alaw": "ALAW"}[s.GetAudioFormat()]
	audioConfig := map[string]any{"audioEncoding": wireEncoding, "sampleRateHertz": s.GetSampleRateHz()}
	if s.Speed != nil {
		audioConfig["speakingRate"] = s.GetSpeed()
	}
	payload := map[string]any{"input": input, "voice": voice, "audioConfig": audioConfig}
	var response map[string]any
	if err := DoJSONRequestWithHeaders(ctx, http.MethodPost, JoinURL(baseURL, "/v1/text:synthesize"), apiKey, payload, &response, cfg.Headers); err != nil {
		return nil, nil, "", err
	}
	encoded, ok := response["audioContent"].(string)
	if !ok || encoded == "" || base64.StdEncoding.DecodedLen(len(encoded)) > maxJSONOrBinaryResponseBytes {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	audio, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	encoding := s.GetAudioFormat()
	switch encoding {
	case "ogg":
		encoding = "ogg_opus"
	case "mulaw":
		encoding = "wav_mulaw"
	case "alaw":
		encoding = "wav_alaw"
	}
	artifact, err := nativeSpeechArtifact(ctx, audio, encoding, s.GetSampleRateHz(), map[string]any{"adapter": AdapterGoogleCloudTTS, "endpoint": "/v1/text:synthesize", "voice": scenarioVoiceRef(s), "language": s.GetLanguage(), "resolved_model": modelResolved})
	if err != nil {
		return nil, nil, "", err
	}
	// The native response has no usage report.
	return []*runtimev1.ScenarioArtifact{artifact}, nil, "", nil
}
