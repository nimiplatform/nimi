package nimillm

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/status"
)

type failingResponseBody struct {
	err error
}

func (b failingResponseBody) Read([]byte) (int, error) {
	return 0, b.err
}

func (failingResponseBody) Close() error {
	return nil
}

func TestDecodeJSONOrBinaryResponsePreservesReadCause(t *testing.T) {
	cause := errors.New("private response transport detail")
	_, err := decodeJSONOrBinaryResponse(&http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       failingResponseBody{err: cause},
	})
	if err == nil {
		t.Fatal("expected response read failure")
	}
	if !errors.Is(err, cause) {
		t.Fatal("expected response read cause to remain available in-process")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
		t.Fatalf("unexpected reason code: %v (ok=%v)", reason, ok)
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatal("expected gRPC status error")
	}
	if message := structuredStatusMessage(t, st.Message()); message != "provider response body could not be read" {
		t.Fatalf("unexpected public status message %q", st.Message())
	}
}

func TestProviderResponseReadErrorReportsBoundedResponse(t *testing.T) {
	err := providerResponseReadError(io.ErrUnexpectedEOF)
	if !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatal("expected size failure cause to remain available in-process")
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatal("expected gRPC status error")
	}
	if message := structuredStatusMessage(t, st.Message()); message != "provider response exceeded the maximum allowed size" {
		t.Fatalf("unexpected public status message %q", st.Message())
	}
}

func structuredStatusMessage(t *testing.T, raw string) string {
	t.Helper()
	var payload struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		t.Fatalf("expected structured status message, got %q: %v", raw, err)
	}
	return payload.Message
}
