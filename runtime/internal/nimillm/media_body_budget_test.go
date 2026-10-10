package nimillm

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestMediaBodyBudgetsBoundHeadersAndStalledReadsWithoutEndingParent(t *testing.T) {
	for _, phase := range []string{"headers", "body"} {
		t.Run(phase, func(t *testing.T) {
			stopped := make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if phase == "body" {
					w.Header().Set("Content-Type", "video/mp4")
					w.WriteHeader(200)
					w.(http.Flusher).Flush()
				}
				<-r.Context().Done()
				close(stopped)
			}))
			defer server.Close()
			parent, cancel := context.WithCancel(loopbackProviderTestContext(context.Background()))
			defer cancel()
			body, _, _, err := openBinaryArtifactStreamWithLimits(parent, server.URL, mediaBodyLimits{headers: 60 * time.Millisecond, idle: 40 * time.Millisecond, bytes: 1 << 20})
			if phase == "body" {
				if err != nil {
					t.Fatal(err)
				}
				_, err = io.ReadAll(body)
				body.Close()
			}
			if !errors.Is(err, context.DeadlineExceeded) {
				t.Fatalf("%s budget did not terminate IO: %v", phase, err)
			}
			if parent.Err() != nil {
				t.Fatalf("transfer resource timer ended parent: %v", parent.Err())
			}
			select {
			case <-stopped:
			case <-time.After(time.Second):
				t.Fatal("timed-out HTTP request stayed active")
			}
		})
	}
}

func TestMediaBodyResourceBudgetUsesAdmittedByteBound(t *testing.T) {
	if got := mediaBodyTotalBudget(8 << 30); got != 32888*time.Second {
		t.Fatalf("8GiB transfer budget=%s", got)
	}
	if got := mediaBodyTotalBudget(1 << 20); got != 124*time.Second {
		t.Fatalf("bounded transfer budget=%s", got)
	}
}
