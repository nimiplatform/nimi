package nimillm

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestJobTransportNeverReplaysFailedEffectOrFollowsItsRedirect(t *testing.T) {
	for _, mode := range []string{"eof-with-body", "eof-empty", "redirect"} {
		t.Run(mode, func(t *testing.T) {
			var creates, redirects atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/prime" {
					io.WriteString(w, "ready")
					return
				}
				if r.URL.Path == "/redirected" {
					redirects.Add(1)
					io.WriteString(w, "unexpected")
					return
				}
				creates.Add(1)
				io.Copy(io.Discard, r.Body)
				if mode == "redirect" {
					http.Redirect(w, r, "/redirected", http.StatusTemporaryRedirect)
					return
				}
				conn, _, err := w.(http.Hijacker).Hijack()
				if err != nil {
					t.Error(err)
					return
				}
				conn.Close()
			}))
			defer server.Close()
			ctx := WithOutboundGate(context.Background(), func(_ context.Context, handoff func() error) error { return handoff() })
			client := httpClientWithOutboundGate(ctx, &http.Client{Transport: &http.Transport{}})
			defer client.CloseIdleConnections()
			prime, err := client.Get(server.URL + "/prime")
			if err != nil {
				t.Fatal(err)
			}
			io.Copy(io.Discard, prime.Body)
			prime.Body.Close()
			var body io.Reader
			if mode != "eof-empty" {
				body = bytes.NewBufferString(`{"create":true}`)
			}
			request, _ := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+"/create", body)
			request.Header.Set("Idempotency-Key", "original-action")
			response, err := client.Do(request)
			if response != nil {
				response.Body.Close()
			}
			if mode != "redirect" && err == nil {
				t.Fatal("unknown create became success")
			}
			if mode == "redirect" && (err != nil || response.StatusCode != http.StatusTemporaryRedirect) {
				t.Fatalf("redirect was hidden: %v %v", response, err)
			}
			if creates.Load() != 1 || redirects.Load() != 0 {
				t.Fatalf("implicit effect replay: %d/%d", creates.Load(), redirects.Load())
			}
		})
	}
}

func TestJobReadFailureWaitsForNextAuthorizedRequest(t *testing.T) {
	var revoked atomic.Bool
	var calls atomic.Int32
	denied := errors.New("original Connector changed")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/prime" {
			io.WriteString(w, "ready")
			return
		}
		calls.Add(1)
		revoked.Store(true)
		conn, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		conn.Close()
	}))
	defer server.Close()
	ctx := WithOutboundGate(context.Background(), func(_ context.Context, handoff func() error) error {
		if revoked.Load() {
			return denied
		}
		return handoff()
	})
	client := httpClientWithOutboundGate(ctx, &http.Client{Transport: &http.Transport{}})
	defer client.CloseIdleConnections()
	response, err := client.Get(server.URL + "/prime")
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, response.Body)
	response.Body.Close()
	if response, err = client.Get(server.URL + "/query"); err == nil {
		response.Body.Close()
		t.Fatal("failed query unexpectedly succeeded")
	}
	if _, err = client.Get(server.URL + "/query"); !errors.Is(err, denied) || calls.Load() != 1 {
		t.Fatalf("new IO bypassed original authority: %v calls=%d", err, calls.Load())
	}
}

func TestJobTransportDoesNotInheritHTTP2ReplayFromInitializedClient(t *testing.T) {
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/create" && r.ProtoMajor != 1 {
			t.Errorf("Job request inherited HTTP/%d replay machinery", r.ProtoMajor)
		}
		io.WriteString(w, "ok")
	}))
	server.EnableHTTP2 = true
	server.StartTLS()
	defer server.Close()
	base := server.Client()
	response, err := base.Get(server.URL + "/prime")
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, response.Body)
	response.Body.Close()
	ctx := WithOutboundGate(context.Background(), func(_ context.Context, handoff func() error) error { return handoff() })
	client := httpClientWithOutboundGate(ctx, base)
	defer client.CloseIdleConnections()
	response, err = client.Post(server.URL+"/create", "application/json", bytes.NewBufferString(`{"create":true}`))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.ProtoMajor != 1 {
		t.Fatal("Job connection did not retain its explicit HTTP/1 boundary")
	}
}
