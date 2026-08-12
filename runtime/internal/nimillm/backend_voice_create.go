package nimillm

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// CreateLocalVoice invokes the implementation-neutral supervised speech Host
// voice.create endpoint. Provider/model/LCC selection is already fixed before
// this transport boundary; the Host returns only an opaque reusable handle and
// non-routing metadata.
func (b *Backend) CreateLocalVoice(ctx context.Context, payload map[string]any) (VoiceWorkflowResult, error) {
	if b == nil || len(payload) == 0 {
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}
	response := struct {
		VoiceID  string         `json:"voice_id"`
		Metadata map[string]any `json:"metadata"`
	}{}
	if err := b.postJSON(ctx, "/v1/voice/create", payload, &response); err != nil {
		return VoiceWorkflowResult{}, err
	}
	voiceID := strings.TrimSpace(response.VoiceID)
	if voiceID == "" {
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return VoiceWorkflowResult{ProviderVoiceRef: voiceID, Metadata: response.Metadata}, nil
}
