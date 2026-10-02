package nimillm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.anthropic-messages-text-behaviors
// @nimi-authority: rule.nimi.runtime.ai-provider.chatgpt-plan-text-behaviors
// @nimi-authority: rule.nimi.runtime.ai-provider.deepseek-v4-json-output
// @nimi-authority: rule.nimi.runtime.ai-provider.openai-responses-text-behaviors
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
	case "deepseek":
	case "dashscope":
	case "gemini":
	case chatGPTPlanProvider:
		// The public ChatGPT-plan route admits only streaming Responses.
		path, wireStream = chatGPTPlanResponsesPath, true
	case "openai":
		// Standard Responses steps collect the same SSE stream in both modes.
		wireStream = true
	default:
		return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED)
	}
	backend, resolvedModelID := p.resolveBackendForTarget(modelID, target)
	if backend == nil {
		return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	nativeGemini := serialized.Protocol == capabilitydriver.GeminiNativeBaseProtocol
	if serialized.Protocol != "" && !nativeGemini {
		return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED)
	}
	if nativeGemini && (target.ProviderType != "gemini" || resolvedModelID != "gemini-3.8-flash") {
		return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED)
	}
	if target.ProviderType == "deepseek" || target.ProviderType == "dashscope" || target.ProviderType == "gemini" {
		path = resolveOpenAICompatiblePath(backend.baseURL, "/chat/completions")
	}
	if target.ProviderType == "openai" {
		path = resolveOpenAICompatiblePath(backend.baseURL, "/responses")
	}
	if target.ProviderType == chatGPTPlanProvider {
		// The usable set is the reviewed target intersected with the current
		// account's list-visible inventory; a registered row alone never runs.
		if err := p.requireChatGPTPlanAccountModel(ctx, target, resolvedModelID); err != nil {
			return textbehavior.NormalizedResult{}, err
		}
	}
	var body map[string]json.RawMessage
	if json.Unmarshal(serialized.Payload, &body) != nil || body == nil {
		return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	// The adapter owns protocol shape, while the exact composed model remains
	// transport-owned and cannot be supplied in the App's text specification.
	if !nativeGemini {
		body["model"], _ = json.Marshal(resolvedModelID)
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return textbehavior.NormalizedResult{}, MapProviderRequestError(err)
	}
	endpoint := backend.baseURL + path
	if nativeGemini {
		if len(payload) > capabilitydriver.GeminiNativeMaxRequestBytes {
			return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		path = "/models/" + resolvedModelID + ":generateContent"
		if wireStream {
			path = "/models/" + resolvedModelID + ":streamGenerateContent?alt=sse"
		}
		endpoint = resolveGeminiNativeBaseURL(backend.baseURL) + path
	}
	request, err := backend.newRequest(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	request.Header.Set("Content-Type", serialized.ContentType)
	if nativeGemini {
		request.Header.Del("Authorization")
		request.Header.Set("x-goog-api-key", backend.apiKey)
	}
	if wireStream {
		request.Header.Set("Accept", "text/event-stream")
	}
	started := time.Now()
	response, err := backend.do(request)
	if err != nil {
		return textbehavior.NormalizedResult{}, MapProviderRequestError(err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		if target.ProviderType == chatGPTPlanProvider {
			body, _ := io.ReadAll(io.LimitReader(response.Body, chatGPTPlanErrorBodyLimit))
			return textbehavior.NormalizedResult{}, chatGPTPlanHTTPError(response.StatusCode, body)
		}
		var providerError map[string]any
		_ = json.NewDecoder(response.Body).Decode(&providerError)
		return textbehavior.NormalizedResult{}, MapProviderHTTPError(response.StatusCode, providerError)
	}
	if !wireStream {
		var body []byte
		var err error
		if nativeGemini {
			body, err = readLimitedResponseBody(response.Body, anthropicMessageStreamLimit)
		} else {
			body, err = io.ReadAll(response.Body)
		}
		if err != nil {
			logProviderStreamFailure(backend.Name, path, started, err)
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
		logProviderStreamFailure(backend.Name, path, started, err)
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
