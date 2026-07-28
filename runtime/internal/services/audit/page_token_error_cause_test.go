package audit

import (
	"errors"
	"strconv"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/pagination"
	"google.golang.org/grpc/status"
)

func TestParsePageTokenPreservesCursorConversionCause(t *testing.T) {
	const filterDigest = "audit-service-filter"
	cursor := strings.Repeat("9", 100)

	_, err := parsePageToken(pagination.Encode(cursor, filterDigest), filterDigest)
	if err == nil {
		t.Fatal("expected invalid audit service cursor error")
	}
	var numErr *strconv.NumError
	if !errors.As(err, &numErr) {
		t.Fatalf("expected strconv.NumError cause, got %T", errors.Unwrap(err))
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PAGE_TOKEN_INVALID {
		t.Fatalf("unexpected reason = %s, ok = %v", reason, ok)
	}
	if strings.Contains(status.Convert(err).Message(), cursor) {
		t.Fatalf("public status leaked audit service cursor: %q", status.Convert(err).Message())
	}
}
