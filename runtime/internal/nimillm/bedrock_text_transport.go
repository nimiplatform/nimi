package nimillm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws/protocol/eventstream"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.bedrock-native-routing
func (p *CloudProvider) executeBedrockTextBehavior(ctx context.Context, model string, target *RemoteTarget, invocation *textbehavior.Invocation, serialized textbehavior.SerializedRequest, onDelta func(textbehavior.OrderedDelta) error) (textbehavior.NormalizedResult, error) {
	backend, _ := p.resolveBackendForTarget(model, target)
	if backend == nil {
		return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	path := ""
	stream := onDelta != nil
	responses := serialized.Protocol == capabilitydriver.BedrockResponsesProtocol
	converse := serialized.Protocol == capabilitydriver.BedrockNovaConverseProtocol
	payload := serialized.Payload
	switch serialized.Protocol {
	case capabilitydriver.BedrockNovaConverseProtocol:
		path = "/model/" + url.PathEscape(target.BedrockInvocationModelID) + "/converse"
		if stream {
			path += "-stream"
		}
	case capabilitydriver.BedrockClaudeInvokeProtocol:
		path = "/model/" + url.PathEscape(target.BedrockInvocationModelID) + "/invoke"
		if stream {
			path += "-with-response-stream"
		}
	case capabilitydriver.BedrockResponsesProtocol:
		path = "/openai/v1/responses"
		var body map[string]json.RawMessage
		if json.Unmarshal(payload, &body) != nil || body == nil {
			return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		body["model"], _ = json.Marshal(target.BedrockInvocationModelID)
		payload, _ = json.Marshal(body)
	default:
		return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED)
	}
	if len(payload) > 25_000_000 {
		return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	request, err := backend.newRequest(ctx, http.MethodPost, backend.baseURL+path, bytes.NewReader(payload))
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	request.Header.Del("x-api-key")
	request.Header.Set("Authorization", "Bearer "+backend.apiKey)
	request.Header.Set("Content-Type", "application/json")
	if stream {
		request.Header.Set("Accept", "application/vnd.amazon.eventstream")
	}
	if stream && responses {
		request.Header.Set("Accept", "text/event-stream")
	}
	if err := ctx.Err(); err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	if observer, _ := ctx.Value(textBehaviorDispatchObserverKey{}).(func()); observer != nil {
		observer()
	}
	started := time.Now()
	response, err := backend.do(request)
	if err != nil {
		return textbehavior.NormalizedResult{}, MapProviderRequestError(err)
	}
	defer func(cleanup func() error) { _ = cleanup() }(response.Body.Close)
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var body map[string]any
		_ = json.NewDecoder(response.Body).Decode(&body)
		return textbehavior.NormalizedResult{}, MapProviderHTTPError(response.StatusCode, body)
	}
	if !stream {
		data, err := readLimitedResponseBody(response.Body, anthropicMessageStreamLimit)
		if err != nil {
			return textbehavior.NormalizedResult{}, MapProviderRequestError(err)
		}
		return invocation.ParseNonStream(data)
	}
	if responses {
		return readTextBehaviorSSE(ctx, response.Body, invocation, onDelta, backend.Name, path, started)
	}
	assembler, err := invocation.NewStreamAssembler()
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	failed := func(err error) (textbehavior.NormalizedResult, error) {
		observed, _ := assembler.Finish()
		return textbehavior.NormalizedResult{Usage: observed.Usage}, err
	}
	decoder := eventstream.NewDecoder()
	for {
		message, err := decoder.Decode(response.Body, nil)
		if err == io.EOF {
			break
		}
		if err != nil {
			logProviderStreamFailure(backend.Name, path, started, err)
			if ctx.Err() != nil {
				return failed(ctx.Err())
			}
			var checksum eventstream.ChecksumError
			var length eventstream.LengthError
			if errors.As(err, &checksum) || errors.As(err, &length) {
				return failed(grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID))
			}
			if errors.Is(err, io.ErrUnexpectedEOF) {
				return failed(grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE))
			}
			return failed(MapProviderRequestError(err))
		}
		kind, ok := message.Headers.Get(":message-type").(eventstream.StringValue)
		event, hasEvent := message.Headers.Get(":event-type").(eventstream.StringValue)
		if ok && kind == "exception" {
			exception, _ := message.Headers.Get(":exception-type").(eventstream.StringValue)
			code := 500
			switch exception {
			case "throttlingException":
				code = 429
			case "validationException":
				code = 400
			case "modelTimeoutException":
				code = 408
			case "serviceUnavailableException":
				code = 503
			case "modelStreamErrorException":
				code = 424
			}
			var body map[string]any
			_ = json.Unmarshal(message.Payload, &body)
			return failed(MapProviderHTTPError(code, body))
		}
		if !ok || kind != "event" || !hasEvent || (!converse && event != "chunk") {
			return failed(grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID))
		}
		var payload []byte
		if converse {
			payload, err = json.Marshal(map[string]json.RawMessage{string(event): message.Payload})
		} else {
			var chunk struct {
				Bytes string `json:"bytes"`
			}
			if json.Unmarshal(message.Payload, &chunk) != nil {
				return failed(grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID))
			}
			payload, err = base64.StdEncoding.DecodeString(chunk.Bytes)
		}
		if err != nil || len(payload) == 0 || len(payload) > anthropicMessageStreamLimit {
			return failed(grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID))
		}
		deltas, err := assembler.Append(payload)
		if err != nil {
			return failed(err)
		}
		for _, delta := range deltas {
			if delta.HasPublicPayload() {
				if err := onDelta(delta); err != nil {
					return failed(err)
				}
			}
		}
	}
	if err := ctx.Err(); err != nil {
		return failed(err)
	}
	return assembler.Finish()
}
