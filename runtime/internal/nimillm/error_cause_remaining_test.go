package nimillm

import (
	"context"
	"encoding/base64"
	"errors"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestNormalizeMusicIterationSecondValuePreservesParseCauseWithoutLeakingInput(t *testing.T) {
	const privateInput = "private-invalid-duration"

	_, err := normalizeMusicIterationSecondValue(privateInput)
	if err == nil {
		t.Fatal("expected invalid duration error")
	}
	var parseErr *strconv.NumError
	if !errors.As(err, &parseErr) {
		t.Fatalf("expected strconv parse cause, got %T: %v", err, err)
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatal("expected gRPC status error")
	}
	if strings.Contains(st.Message(), privateInput) {
		t.Fatalf("public status leaked private input: %q", st.Message())
	}
}

func TestDecodeMusicIterationBase64PreservesBothDecoderCausesWithoutLeakingInput(t *testing.T) {
	const privateInput = "private-invalid-base64%%%"

	_, err := decodeMusicIterationBase64(privateInput)
	if err == nil {
		t.Fatal("expected invalid base64 error")
	}
	var joined interface{ Unwrap() []error }
	if !errors.As(err, &joined) {
		t.Fatalf("expected joined decoder causes, got %T: %v", err, err)
	}
	causes := joined.Unwrap()
	if len(causes) != 2 {
		t.Fatalf("expected both decoder causes, got %d: %#v", len(causes), causes)
	}
	for i, cause := range causes {
		var corruptInput base64.CorruptInputError
		if !errors.As(cause, &corruptInput) {
			t.Fatalf("decoder cause %d is not a base64 corruption error: %T: %v", i, cause, cause)
		}
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatal("expected gRPC status error")
	}
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("unexpected status code: %v", st.Code())
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID {
		t.Fatalf("unexpected reason: ok=%v reason=%v", ok, reason)
	}
	if strings.Contains(st.Message(), privateInput) {
		t.Fatalf("public status leaked private input: %q", st.Message())
	}
}

func TestFireworksModelDiscoveryPreservesBaseURLCauseWithoutPublishingIt(t *testing.T) {
	const invalidBaseURL = "https://private.example/%zz?api_key=secret"
	backend := NewBackend("cloud-fireworks", invalidBaseURL, "secret", time.Second)

	tests := []struct {
		name string
		run  func() error
	}{
		{
			name: "probe",
			run:  func() error { return backend.ProbeConnector(context.Background()) },
		},
		{
			name: "list",
			run: func() error {
				_, err := backend.ListModels(context.Background())
				return err
			},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.run()
			if err == nil {
				t.Fatal("expected invalid Fireworks base URL error")
			}
			var urlErr *url.Error
			if !errors.As(err, &urlErr) {
				t.Fatalf("expected URL parse cause, got %T: %v", errors.Unwrap(err), err)
			}
			if strings.Contains(status.Convert(err).Message(), invalidBaseURL) || strings.Contains(status.Convert(err).Message(), "api_key=secret") {
				t.Fatalf("public status leaked Fireworks base URL: %q", status.Convert(err).Message())
			}
		})
	}
}
