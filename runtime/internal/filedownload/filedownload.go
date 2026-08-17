// Package filedownload is the single shared core download primitive for the
// runtime: GET a URL, stream it to a destination file, with bounded
// retry-with-backoff on transient failures, HTTP Range resume from a
// `<dest>.download` partial, and sha256 verification of the whole assembled
// file.
//
// It is a low-level package both `internal/engine` (managed engine binaries)
// and `internal/services/localservice` (managed model assets) depend on, so
// there is exactly ONE implementation of download retry + resume in the
// runtime. The package must not import `engine` or `localservice`; callers
// inject their own configured `*http.Client`, transient-error classifier, and
// progress/wait hooks.
package filedownload

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// ErrHashMismatch is the non-transient failure for a verified sha256 mismatch
// on the assembled file. The retry loop must never retry it; the partial is
// discarded.
var ErrHashMismatch = errors.New("filedownload: sha256 mismatch")

// ErrMaxBodyExceeded is the non-transient failure when the assembled file would
// exceed the configured size budget.
var ErrMaxBodyExceeded = errors.New("filedownload: response body exceeds size budget")

// ErrHTTPStatus is the non-transient failure for a non-success, non-transient
// HTTP status (a `4xx`). A `5xx` is treated as transient and retried.
var ErrHTTPStatus = errors.New("filedownload: unexpected HTTP status")

// ProgressFunc receives absolute progress for the whole assembled file:
// bytesReceived counts bytes already on disk (including any resumed prefix),
// bytesTotal is the known final size or 0 when unknown.
type ProgressFunc func(bytesReceived, bytesTotal int64)

// WaitFunc is an optional cooperative pause hook invoked between read chunks.
// It must return a non-nil error to abort the download (e.g. a cancellation).
// The model transfer path passes its `transferControl.wait`; the engine path
// passes nil.
type WaitFunc func(ctx context.Context) error

// Options configures one shared-core download. The zero value is not valid;
// URL, DestPath, and Client are required.
type Options struct {
	// URL is the source to GET.
	URL string
	// DestPath is the final file path. The download streams into
	// `DestPath + ".download"` and is renamed onto DestPath only after sha256
	// verification.
	DestPath string
	// Client is the caller-configured HTTP client. The engine path feeds its
	// HTTP/2-negotiating, redirect-validating client here; the model path feeds
	// a timeout client. The core never builds its own transport.
	Client *http.Client
	// Header carries extra request headers (User-Agent, Accept, …). Range is
	// managed by the core and must not be set here.
	Header http.Header
	// ExpectedSHA256 is the lowercase hex digest the assembled file must match.
	// Empty disables verification (the engine path verifies separately for some
	// callers); when set a mismatch fails closed with ErrHashMismatch.
	ExpectedSHA256 string
	// MaxBodyBytes bounds the assembled file size. 0 disables the bound.
	MaxBodyBytes int64
	// MaxAttempts is the total number of attempts (first try + retries). Values
	// below 1 are clamped to 1.
	MaxAttempts int
	// RetryBackoff is the base backoff between transient retries; attempt N
	// waits N*RetryBackoff. 0 disables the wait.
	RetryBackoff time.Duration
	// IsTransient classifies a transport/stream error as transient (worth a
	// retry) or not. nil means "never transient". Caller context cancellation,
	// 4xx, hash mismatch and oversize are handled by the core and never routed
	// here. Client/read timeouts whose caller ctx is still alive are routed here
	// so callers can resume long downloads after a socket timeout.
	IsTransient func(err error) bool
	// Progress is the optional progress callback.
	Progress ProgressFunc
	// Wait is the optional cooperative pause hook.
	Wait WaitFunc
	// PreservePartialOnError lets a caller retain the `.download` file for an
	// explicit later resume. The default is fail-closed cleanup. Callers must
	// return false for failures that invalidate the partial, such as an explicit
	// cancellation or an integrity mismatch.
	PreservePartialOnError func(error) bool
}

// Result reports the outcome of a successful download.
type Result struct {
	// SHA256 is the lowercase hex digest of the whole assembled file.
	SHA256 string
	// BytesTotal is the final size of the assembled file.
	BytesTotal int64
	// Attempts is the number of HTTP attempts made (>=1).
	Attempts int
	// Resumed reports whether at least one attempt resumed from a non-empty
	// `.download` partial via an HTTP Range request.
	Resumed bool
}

// Download performs the shared-core download. It is the ONE place in the
// runtime that implements download retry + Range resume.
//
//   - Transient failures (per Options.IsTransient, plus 5xx) are retried up to
//     MaxAttempts; the `.download` partial is kept between attempts and a
//     `Range: bytes=N-` request resumes from it.
//   - A 200 response to a Range request (server ignored Range) restarts the
//     download from byte 0.
//   - Non-transient failures (4xx, oversize, hash mismatch) fail closed
//     immediately and discard the partial.
//   - A cancelled caller ctx aborts immediately with no further retry.
func Download(ctx context.Context, opts Options) (Result, error) {
	if strings.TrimSpace(opts.URL) == "" {
		return Result{}, fmt.Errorf("filedownload: URL is required")
	}
	if strings.TrimSpace(opts.DestPath) == "" {
		return Result{}, fmt.Errorf("filedownload: DestPath is required")
	}
	if opts.Client == nil {
		return Result{}, fmt.Errorf("filedownload: HTTP client is required")
	}
	attempts := opts.MaxAttempts
	if attempts < 1 {
		attempts = 1
	}

	partialPath := opts.DestPath + ".download"
	var result Result

	for attempt := 1; attempt <= attempts; attempt++ {
		result.Attempts = attempt
		if err := ctx.Err(); err != nil {
			discardPartialOnError(opts, partialPath, err)
			return Result{}, err
		}

		resumeFrom := partialSize(partialPath)
		assembled, total, resumed, err := streamAttempt(ctx, opts, partialPath, resumeFrom)
		if resumed {
			result.Resumed = true
		}
		if err == nil {
			result.BytesTotal = assembled
			if total > 0 {
				result.BytesTotal = total
			}
			break
		}

		// Caller context cancellation aborts immediately — no retry, no
		// resume. A timeout produced by the injected HTTP client while the
		// caller ctx is still alive is a transport error; let IsTransient decide
		// whether it should resume.
		if ctxErr := ctx.Err(); ctxErr != nil {
			discardPartialOnError(opts, partialPath, ctxErr)
			return Result{}, ctxErr
		}
		if errors.Is(err, context.Canceled) {
			discardPartialOnError(opts, partialPath, err)
			return Result{}, err
		}

		var nonTransient *nonTransientError
		if errors.As(err, &nonTransient) {
			// Callers may retain a still-valid partial for an explicit retry;
			// integrity failures remain invalid and are discarded below.
			discardPartialOnError(opts, partialPath, nonTransient.err)
			return Result{}, nonTransient.err
		}

		transient := false
		if isTransientHTTP(err) {
			transient = true
		} else if opts.IsTransient != nil && opts.IsTransient(err) {
			transient = true
		}
		if !transient || attempt == attempts {
			// A non-transient transport error, or retries exhausted: fail
			// closed. The partial is kept on a transient exhaustion so an
			// explicit caller retry can still resume; a non-transient error
			// discards it.
			if !transient {
				discardPartialOnError(opts, partialPath, err)
				return Result{}, fmt.Errorf("filedownload: %s: %w", opts.URL, err)
			}
			return Result{}, fmt.Errorf("%w: %s: %w", ErrTransientAttemptsExhausted, opts.URL, err)
		}

		// Transient: keep the partial as the resume point and back off.
		if opts.RetryBackoff > 0 {
			select {
			case <-ctx.Done():
				discardPartialOnError(opts, partialPath, ctx.Err())
				return Result{}, ctx.Err()
			case <-time.After(time.Duration(attempt) * opts.RetryBackoff):
			}
		}
	}

	// The assembled `.download` partial is complete. Verify its sha256 over the
	// whole file (re-hash once — never hash only a resumed tail).
	sum, err := sha256File(partialPath)
	if err != nil {
		discardPartialOnError(opts, partialPath, err)
		return Result{}, fmt.Errorf("filedownload: hash %s: %w", opts.DestPath, err)
	}
	result.SHA256 = sum
	if expected := strings.ToLower(strings.TrimSpace(opts.ExpectedSHA256)); expected != "" && !strings.EqualFold(expected, sum) {
		hashErr := fmt.Errorf("%w: expected=%s actual=%s", ErrHashMismatch, expected, sum)
		discardPartialOnError(opts, partialPath, hashErr)
		return Result{}, hashErr
	}

	if err := promotePartial(partialPath, opts.DestPath); err != nil {
		discardPartialOnError(opts, partialPath, err)
		return Result{}, fmt.Errorf("filedownload: promote %s: %w", opts.DestPath, err)
	}
	return result, nil
}

// nonTransientError marks a typed failure the retry loop must never retry.
type nonTransientError struct {
	err error
}

func (e *nonTransientError) Error() string { return e.err.Error() }
func (e *nonTransientError) Unwrap() error { return e.err }

// streamAttempt performs one HTTP GET + body copy. resumeFrom>0 sends a Range
// header and appends; a 206 response resumes, a 200 response restarts from 0.
// It returns the absolute assembled byte count, the known total (0 if unknown),
// whether the attempt resumed, and any error.
func streamAttempt(ctx context.Context, opts Options, partialPath string, resumeFrom int64) (assembled int64, total int64, resumed bool, err error) {
	req, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, opts.URL, nil)
	if reqErr != nil {
		return 0, 0, false, &nonTransientError{err: fmt.Errorf("build request: %w", reqErr)}
	}
	for key, values := range opts.Header {
		for _, value := range values {
			req.Header.Add(key, value)
		}
	}
	if resumeFrom > 0 {
		req.Header.Set("Range", "bytes="+strconv.FormatInt(resumeFrom, 10)+"-")
	}

	resp, doErr := opts.Client.Do(req)
	if doErr != nil {
		// A transport-level error: transient classification happens upstream.
		return 0, 0, false, doErr
	}
	defer func() { _ = resp.Body.Close() }()

	switch resp.StatusCode {
	case http.StatusOK:
		// Server ignored Range (or none requested): restart from byte 0.
		resumeFrom = 0
		total = resp.ContentLength
	case http.StatusPartialContent:
		if resumeFrom <= 0 {
			// We did not ask for a range but got 206: treat defensively as a
			// full body from 0.
			resumeFrom = 0
		} else {
			resumed = true
		}
		total = contentRangeTotal(resp.Header.Get("Content-Range"))
		if total <= 0 && resp.ContentLength > 0 {
			total = resumeFrom + resp.ContentLength
		}
	default:
		if resp.StatusCode >= 500 {
			// 5xx: transient — retry.
			return 0, 0, false, fmt.Errorf("%w %d (transient)", ErrHTTPStatus, resp.StatusCode)
		}
		// 4xx and other non-success: non-transient, fail closed.
		return 0, 0, false, &nonTransientError{err: fmt.Errorf("%w %d", ErrHTTPStatus, resp.StatusCode)}
	}

	if opts.MaxBodyBytes > 0 && total > 0 && total > opts.MaxBodyBytes {
		return 0, 0, resumed, &nonTransientError{err: fmt.Errorf("%w: total=%d budget=%d", ErrMaxBodyExceeded, total, opts.MaxBodyBytes)}
	}

	openFlags := os.O_CREATE | os.O_WRONLY
	if resumeFrom > 0 {
		openFlags |= os.O_APPEND
	} else {
		openFlags |= os.O_TRUNC
	}
	file, openErr := os.OpenFile(partialPath, openFlags, 0o644)
	if openErr != nil {
		return 0, 0, resumed, &nonTransientError{err: fmt.Errorf("open partial: %w", openErr)}
	}

	written, copyErr := copyBody(ctx, file, resp.Body, copyParams{
		baseOffset:   resumeFrom,
		maxBodyBytes: opts.MaxBodyBytes,
		total:        total,
		progress:     opts.Progress,
		wait:         opts.Wait,
	})
	closeErr := file.Close()
	assembled = resumeFrom + written
	if copyErr != nil {
		// Keep the partial: it is the resume point for the next attempt unless
		// the caller classifies copyErr as non-transient.
		return assembled, total, resumed, copyErr
	}
	if closeErr != nil {
		return assembled, total, resumed, &nonTransientError{err: fmt.Errorf("close partial: %w", closeErr)}
	}
	return assembled, total, resumed, nil
}

type copyParams struct {
	baseOffset   int64
	maxBodyBytes int64
	total        int64
	progress     ProgressFunc
	wait         WaitFunc
}

// copyBody streams src into dst, returning the bytes written by this call. A
// cancelled ctx or a non-nil Wait error aborts immediately. MaxBodyBytes is
// enforced against the absolute assembled size.
func copyBody(ctx context.Context, dst io.Writer, src io.Reader, params copyParams) (int64, error) {
	buffer := make([]byte, 128*1024)
	var written int64
	for {
		if err := ctx.Err(); err != nil {
			return written, err
		}
		if params.wait != nil {
			if err := params.wait(ctx); err != nil {
				return written, err
			}
		}
		n, readErr := src.Read(buffer)
		if n > 0 {
			absolute := params.baseOffset + written + int64(n)
			if params.maxBodyBytes > 0 && absolute > params.maxBodyBytes {
				return written, &nonTransientError{err: fmt.Errorf("%w: budget=%d", ErrMaxBodyExceeded, params.maxBodyBytes)}
			}
			if _, err := dst.Write(buffer[:n]); err != nil {
				return written, &nonTransientError{err: fmt.Errorf("write partial: %w", err)}
			}
			written += int64(n)
			if params.progress != nil {
				params.progress(params.baseOffset+written, params.total)
			}
		}
		if readErr == nil {
			continue
		}
		if readErr == io.EOF {
			return written, nil
		}
		// io.ErrUnexpectedEOF and other read errors are surfaced verbatim so the
		// caller's transient classifier can decide.
		return written, readErr
	}
}

// isTransientHTTP reports whether err is a 5xx ErrHTTPStatus the core itself
// classified as transient.
func isTransientHTTP(err error) bool {
	if !errors.Is(err, ErrHTTPStatus) {
		return false
	}
	return strings.Contains(err.Error(), "(transient)")
}

// partialSize reports the byte size of the partial file, or 0 when it is
// absent, non-regular, or unreadable (a clean restart from byte 0).
func partialSize(partialPath string) int64 {
	info, err := os.Stat(partialPath)
	if err != nil || !info.Mode().IsRegular() || info.Size() < 0 {
		return 0
	}
	return info.Size()
}

// discardPartialOnError applies the caller's explicit resume policy. Integrity
// and cancellation owners can reject retention while resumable transfer owners
// keep bytes that remain valid across an interruption.
func discardPartialOnError(opts Options, partialPath string, err error) {
	if opts.PreservePartialOnError != nil && opts.PreservePartialOnError(err) {
		return
	}
	removePartial(partialPath)
}

func removePartial(partialPath string) {
	_ = os.Remove(partialPath)
}

// promotePartial atomically renames the verified partial onto its final path.
func promotePartial(partialPath, destPath string) error {
	return os.Rename(partialPath, destPath)
}

// sha256File hashes the whole file at path — for a resumed download this
// re-hashes the assembled file once so the digest covers every byte.
func sha256File(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer func() { _ = file.Close() }()
	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

// contentRangeTotal parses the total size out of a `Content-Range:
// bytes A-B/C` header, returning 0 when C is absent or `*`.
func contentRangeTotal(header string) int64 {
	trimmed := strings.TrimSpace(header)
	slash := strings.LastIndex(trimmed, "/")
	if slash < 0 || slash == len(trimmed)-1 {
		return 0
	}
	totalToken := strings.TrimSpace(trimmed[slash+1:])
	if totalToken == "" || totalToken == "*" {
		return 0
	}
	total, err := strconv.ParseInt(totalToken, 10, 64)
	if err != nil || total < 0 {
		return 0
	}
	return total
}
