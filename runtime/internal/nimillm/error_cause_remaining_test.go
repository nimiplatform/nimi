package nimillm

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc/status"
)

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
