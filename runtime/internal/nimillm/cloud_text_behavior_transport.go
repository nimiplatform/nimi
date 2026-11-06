package nimillm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
)

type textBehaviorDispatchObserverKey struct{}

// WithTextBehaviorDispatchObserver lets the execution owner observe the actual
// text POST boundary, after account-model admission and request construction.
// Inventory reads and requests rejected before dispatch never call observer.
func WithTextBehaviorDispatchObserver(ctx context.Context, observer func()) context.Context {
	return context.WithValue(ctx, textBehaviorDispatchObserverKey{}, observer)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.anthropic-messages-text-behaviors
// @nimi-authority: rule.nimi.runtime.ai-provider.chatgpt-plan-text-behaviors
// @nimi-authority: rule.nimi.runtime.ai-provider.deepseek-v4-json-output
// @nimi-authority: rule.nimi.runtime.ai-provider.openai-responses-text-behaviors
// @nimi-authority: rule.nimi.runtime.ai-provider.mimo-v26-tool-text
// @nimi-authority: rule.nimi.runtime.ai-provider.glm53-native-text
// @nimi-authority: rule.nimi.runtime.ai-provider.minimax-m3-messages
// @nimi-authority: rule.nimi.runtime.ai-provider.mistral-native-text
// @nimi-authority: rule.nimi.runtime.ai-provider.stepfun-current-text
// @nimi-authority: rule.nimi.runtime.ai-provider.azure-current-responses
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
	case "mimo":
	case "mistral":
	case "stepfun":
	case "glm":
	case "minimax":
	case chatGPTPlanProvider:
		// The public ChatGPT-plan route admits only streaming Responses.
		path, wireStream = chatGPTPlanResponsesPath, true
	case "openai":
		// Standard Responses steps collect the same SSE stream in both modes.
		wireStream = true
	case "azure":
		wireStream = true
	default:
		return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED)
	}
	backend, resolvedModelID := p.resolveBackendForTarget(modelID, target)
	if backend == nil {
		return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	nativeGemini := serialized.Protocol == capabilitydriver.GeminiNativeBaseProtocol
	argonGemini := serialized.Protocol == capabilitydriver.GeminiArgonInteractionsProtocol
	miniMaxMessages := serialized.Protocol == capabilitydriver.MiniMaxMessagesProtocol
	if serialized.Protocol != "" && !nativeGemini && !argonGemini && !miniMaxMessages {
		return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED)
	}
	if nativeGemini && (target.ProviderType != "gemini" || resolvedModelID != "gemini-3.8-flash") {
		return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED)
	}
	if argonGemini && (target.ProviderType != "gemini" || resolvedModelID != "gemini-4-argon") {
		return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED)
	}
	if miniMaxMessages && (target.ProviderType != "minimax" || resolvedModelID != "MiniMax-M3.1-Flash" && resolvedModelID != "MiniMax-M3") || target.ProviderType == "minimax" && !miniMaxMessages {
		return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED)
	}
	if target.ProviderType == "deepseek" || target.ProviderType == "dashscope" || target.ProviderType == "gemini" || target.ProviderType == "mimo" || target.ProviderType == "mistral" || target.ProviderType == "stepfun" {
		path = resolveOpenAICompatiblePath(backend.baseURL, "/chat/completions")
	}
	if target.ProviderType == "openai" {
		path = resolveOpenAICompatiblePath(backend.baseURL, "/responses")
	}
	if target.ProviderType == "azure" {
		path = backend.compatiblePath("/responses")
	}
	if target.ProviderType == "glm" {
		path = resolveGLMAPIPath(backend.baseURL, "chat/completions")
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
		body["model"], _ = json.Marshal(backend.requestModelID(resolvedModelID))
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return textbehavior.NormalizedResult{}, MapProviderRequestError(err)
	}
	endpoint := backend.baseURL + path
	if miniMaxMessages {
		if len(payload) > capabilitydriver.MiniMaxMessagesMaxRequestBytes {
			return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		parsed, parseErr := url.Parse(backend.baseURL)
		if parseErr != nil {
			return textbehavior.NormalizedResult{}, MapProviderRequestError(parseErr)
		}
		prefix := strings.TrimRight(parsed.Path, "/")
		for _, suffix := range []string{"/anthropic/v1", "/anthropic", "/v1"} {
			if strings.HasSuffix(prefix, suffix) {
				prefix = strings.TrimSuffix(prefix, suffix)
				break
			}
		}
		parsed.Path, parsed.RawPath = prefix+"/anthropic/v1/messages", ""
		endpoint, path = parsed.String(), parsed.Path
	}
	if argonGemini {
		if len(payload) > capabilitydriver.GeminiNativeMaxRequestBytes {
			return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		path = "/interactions"
		endpoint = resolveGeminiNativeBaseURL(backend.baseURL) + path
	}
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
	if nativeGemini || argonGemini {
		request.Header.Del("Authorization")
		request.Header.Set("x-goog-api-key", backend.apiKey)
	}
	if miniMaxMessages || target.ProviderType == "mistral" || target.ProviderType == "stepfun" {
		// These exact protocols use Bearer even when a gateway path contains
		// /anthropic; generic URL heuristics cannot select credential semantics.
		request.Header.Del("x-api-key")
		request.Header.Set("Authorization", "Bearer "+backend.apiKey)
	}
	if wireStream {
		request.Header.Set("Accept", "text/event-stream")
	}
	if err := ctx.Err(); err != nil {
		return textbehavior.NormalizedResult{}, MapProviderRequestError(err)
	}
	if observer, _ := ctx.Value(textBehaviorDispatchObserverKey{}).(func()); observer != nil {
		observer()
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
		if nativeGemini || argonGemini || miniMaxMessages {
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
	failed := func(cause error) (textbehavior.NormalizedResult, error) {
		observed, _ := assembler.Finish()
		return textbehavior.NormalizedResult{Usage: observed.Usage}, cause
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
				return failed(err)
			}
		} else if strings.HasPrefix(line, "data:") {
			data = append(data, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
		}
	}
	if err := scanner.Err(); err != nil {
		logProviderStreamFailure(backend.Name, path, started, err)
		return failed(MapProviderRequestError(err))
	}
	if err := consume(); err != nil {
		return failed(err)
	}
	if err := ctx.Err(); err != nil {
		return failed(err)
	}
	return assembler.Finish()
}
