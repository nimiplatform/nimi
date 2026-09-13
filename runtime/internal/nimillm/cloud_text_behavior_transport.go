package nimillm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.anthropic-sonnet46-text-behaviors
// @nimi-authority: rule.nimi.runtime.ai-provider.codex-text-behaviors
// The Host supplies the exact credential-bearing target only for this call.
// Hooks were selected and their request serialized before Job publication.
func (p *CloudProvider) ExecuteTextBehaviorWithTarget(
	ctx context.Context, modelID string, target *RemoteTarget,
	invocation *textbehavior.Invocation, serialized textbehavior.SerializedRequest,
	onDelta func(textbehavior.OrderedDelta) error,
) (textbehavior.NormalizedResult, error) {
	if target == nil || invocation == nil {
		return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED)
	}
	path := "/v1/messages"
	wireStream := onDelta != nil
	switch target.ProviderType {
	case "anthropic":
	case "openai_codex":
		path, wireStream = codexResponsesPath, true
	default:
		return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED)
	}
	backend, resolvedModelID := p.resolveBackendForTarget(modelID, target)
	if backend == nil {
		return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	var body map[string]json.RawMessage
	if json.Unmarshal(serialized.Payload, &body) != nil || body == nil {
		return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	// The adapter owns protocol shape, while the exact composed model remains
	// transport-owned and cannot be supplied in the App's text specification.
	body["model"], _ = json.Marshal(resolvedModelID)
	payload, err := json.Marshal(body)
	if err != nil {
		return textbehavior.NormalizedResult{}, MapProviderRequestError(err)
	}
	request, err := backend.newRequest(ctx, http.MethodPost, backend.baseURL+path, bytes.NewReader(payload))
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	request.Header.Set("Content-Type", serialized.ContentType)
	if wireStream {
		request.Header.Set("Accept", "text/event-stream")
	}
	response, err := backend.do(request)
	if err != nil {
		return textbehavior.NormalizedResult{}, MapProviderRequestError(err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var providerError map[string]any
		_ = json.NewDecoder(response.Body).Decode(&providerError)
		return textbehavior.NormalizedResult{}, MapProviderHTTPError(response.StatusCode, providerError)
	}
	if !wireStream {
		body, err := io.ReadAll(response.Body)
		if err != nil {
			return textbehavior.NormalizedResult{}, MapProviderRequestError(err)
		}
		return invocation.ParseNonStream(body)
	}
	assembler, err := invocation.NewStreamAssembler()
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), anthropicMessageStreamLimit)
	var data []string
	consume := func() error {
		if len(data) == 0 {
			return nil
		}
		fragment := strings.Join(data, "\n")
		data = nil
		deltas, err := assembler.Append([]byte(fragment))
		if err != nil {
			return err
		}
		for _, delta := range deltas {
			if onDelta != nil && delta.HasPublicPayload() {
				if err := onDelta(delta); err != nil {
					return err
				}
			}
		}
		return nil
	}
	for scanner.Scan() {
		line := strings.TrimSuffix(scanner.Text(), "\r")
		if line == "" {
			if err := consume(); err != nil {
				return textbehavior.NormalizedResult{}, err
			}
		} else if strings.HasPrefix(line, "data:") {
			data = append(data, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
		}
	}
	if err := scanner.Err(); err != nil {
		return textbehavior.NormalizedResult{}, MapProviderRequestError(err)
	}
	if err := consume(); err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	if err := ctx.Err(); err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	return assembler.Finish()
}
