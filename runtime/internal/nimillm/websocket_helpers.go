package nimillm

import (
	"context"
	"net"
	"net/url"
	"strings"
	"time"
)

func computeWSReadDeadline(ctx context.Context, readTimeout time.Duration) time.Time {
	now := time.Now().UTC()
	deadline := now.Add(readTimeout)
	if ctxDeadline, hasDeadline := ctx.Deadline(); hasDeadline && ctxDeadline.Before(deadline) {
		return ctxDeadline
	}
	return deadline
}

func websocketOrigin(targetURL string) string {
	parsed, err := url.Parse(strings.TrimSpace(targetURL))
	if err != nil || parsed == nil || strings.TrimSpace(parsed.Host) == "" {
		return "http://localhost/"
	}
	if parsed.Scheme == "wss" {
		return "https://" + parsed.Host + "/"
	}
	return "http://" + parsed.Host + "/"
}

func isNetworkTimeout(err error) bool {
	if err == nil {
		return false
	}
	timeoutError, ok := err.(net.Error)
	return ok && timeoutError.Timeout()
}
