package nimillm

import (
	"encoding/json"
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const (
	chatGPTPlanProvider       = "openai_chatgpt_plan"
	chatGPTPlanResponsesPath  = "/v1/responses"
	chatGPTPlanErrorBodyLimit = 64 << 10
)

func (b *Backend) isChatGPTPlanBackend() bool {
	return b != nil && strings.TrimSpace(b.Name) == "cloud-"+chatGPTPlanProvider
}

// withoutRedirects returns a clone whose client reports a redirect as the
// final response, so a fixed SIWC endpoint also bounds every hop.
func (b *Backend) withoutRedirects() *Backend {
	if b == nil || b.client == nil {
		return b
	}
	clone := *b
	client := *b.client
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	clone.client = &client
	return &clone
}

func chatGPTPlanPrimitiveTextUnsupported() error {
	return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED, grpcerr.ReasonOptions{
		Message: "ChatGPT plan text runs only through its exact stateless Responses adapter",
	})
}

// chatGPTPlanHTTPError maps a pre-stream admission or Responses failure. The
// route may answer with a Responses error object or a diagnostic detail body.
func chatGPTPlanHTTPError(status int, body []byte) error {
	var payload struct {
		Error *struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	code := ""
	if json.Unmarshal(body, &payload) == nil && payload.Error != nil {
		code = payload.Error.Code
	}
	return capabilitydriver.ChatGPTPlanFailure(status, code)
}
