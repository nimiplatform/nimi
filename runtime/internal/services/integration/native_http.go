package integration

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptrace"
	"sync/atomic"
)

func (s *Service) platformClient() *http.Client {
	client := *s.http
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &client
}
func boundedRead(body io.ReadCloser, max int64) ([]byte, error) {
	defer body.Close()
	data, err := io.ReadAll(io.LimitReader(body, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > max {
		return nil, adapterError("INTEGRATION_RESPONSE_BOUNDS")
	}
	return data, nil
}
func (s *Service) platformRequest(ctx context.Context, method, endpoint string, headers http.Header, body io.Reader, limit int64) ([]byte, http.Header, int, effectOutcome, error) {
	var connected atomic.Bool
	trace := &httptrace.ClientTrace{GotConn: func(httptrace.GotConnInfo) { connected.Store(true) }}
	req, err := http.NewRequestWithContext(httptrace.WithClientTrace(ctx, trace), method, endpoint, body)
	if err != nil {
		return nil, nil, 0, notDispatched, adapterError("INTEGRATION_REQUEST_INVALID")
	}
	req.Header = headers.Clone()
	response, err := s.platformClient().Do(req)
	outcome := notDispatched
	if connected.Load() {
		outcome = effectUnknown
	}
	if err != nil {
		return nil, nil, 0, outcome, adapterError("INTEGRATION_NETWORK_FAILED")
	}
	// Injected test transports need not invoke httptrace; a response proves dispatch.
	outcome = effectUnknown
	data, err := boundedRead(response.Body, limit)
	if err != nil {
		return nil, response.Header, response.StatusCode, outcome, adapterError("INTEGRATION_RESPONSE_INVALID")
	}
	return data, response.Header, response.StatusCode, outcome, nil
}
func (s *Service) platformJSON(ctx context.Context, method, endpoint string, headers http.Header, input any, limit int64) ([]byte, int, effectOutcome, error) {
	var body io.Reader
	if input != nil {
		data, err := json.Marshal(input)
		if err != nil {
			return nil, 0, notDispatched, adapterError("INTEGRATION_REQUEST_INVALID")
		}
		body = bytes.NewReader(data)
	}
	headers = headers.Clone()
	headers.Set("Content-Type", "application/json")
	data, _, code, outcome, err := s.platformRequest(ctx, method, endpoint, headers, body, limit)
	return data, code, outcome, err
}
func mediaDigest(data []byte) string {
	digest := sha256.Sum256(data)
	return "sha256:" + hex.EncodeToString(digest[:])
}
