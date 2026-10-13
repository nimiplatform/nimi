package runtimeagent

import (
	"context"
	"strconv"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestListAgentsRejectsUnrepresentablePageCursor(t *testing.T) {
	maxInt := uint64(^uint(0) >> 1)
	for _, token := range []string{strconv.FormatUint(maxInt+1, 10), "18446744073709551615"} {
		t.Run(token, func(t *testing.T) {
			svc := &Service{}
			response, err := svc.ListAgents(context.Background(), &runtimev1.ListAgentsRequest{PageToken: token})
			if response != nil || status.Code(err) != codes.InvalidArgument {
				t.Fatalf("invalid page cursor: response=%v err=%v", response, err)
			}
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
				t.Fatalf("invalid cursor reason=%v, present=%v", reason, ok)
			}
		})
	}
}

func TestPageBoundsRepresentableCursorLimits(t *testing.T) {
	maxInt := int(^uint(0) >> 1)
	for _, tc := range []struct {
		name       string
		cursor     int
		total      int
		start, end int
	}{
		{name: "past final page", cursor: maxInt, total: 3, start: 3, end: 3},
		{name: "page end at int limit", cursor: maxInt - 1, total: maxInt, start: maxInt - 1, end: maxInt},
	} {
		t.Run(tc.name, func(t *testing.T) {
			start, end, next, err := pageBounds(strconv.Itoa(tc.cursor), 50, 50, 100, tc.total)
			if err != nil || start != tc.start || end != tc.end || next != "" {
				t.Fatalf("page bounds=(%d,%d,%q,%v), want (%d,%d,empty,nil)", start, end, next, err, tc.start, tc.end)
			}
		})
	}
}
