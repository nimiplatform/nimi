package nimillm

import (
	"context"
	"net/http"
	"strconv"

	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const maxWorldReadAttempts int32 = 10

// World status/result reads are idempotent. An unexpired owner deadline is
// compatible with bounded transient retries; it is not itself a failure.
// This helper never submits work, uploads inputs or retries a partial asset.
func retryWorldProviderRead(ctx context.Context, read func() error) error {
	for attempt := int32(1); ; attempt++ {
		if err := ctx.Err(); err != nil {
			return providerPollContextError(err)
		}
		err := read()
		if contextErr := ctx.Err(); contextErr != nil {
			return providerPollContextError(contextErr)
		}
		if err == nil || attempt >= maxWorldReadAttempts || !worldProviderReadRetryable(err) {
			return err
		}
		if err := sleepWithContext(ctx, providerPollDelay(attempt)); err != nil {
			return providerPollContextError(err)
		}
	}
}

func worldProviderReadRetryable(err error) bool {
	if !isTransientPollError(err) {
		return false
	}
	if metadata, ok := grpcerr.ExtractReasonMetadata(err); ok {
		if raw, present := metadata["provider_http_status"]; present {
			code, parseErr := strconv.Atoi(raw)
			if parseErr != nil {
				return false
			}
			switch code {
			case http.StatusRequestTimeout, http.StatusInternalServerError, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
				return true
			default:
				return false
			}
		}
	}
	return true
}
