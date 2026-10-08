package integration

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/oklog/ulid/v2"
)

const nativeEventLimit = 64 * 1024
const nativeFeedByteLimit = 64 * 1024 * 1024
const nativePageLimit = 900 * 1024

type nativeEvent struct {
	sequence         uint64
	id, conversation string
	received         time.Time
	payload          json.RawMessage
	sources          map[string]nativeSource
	bytes            int
}
type nativeCursor struct {
	Binding  string `json:"b"`
	Epoch    string `json:"e"`
	Sequence uint64 `json:"s"`
}
type nativeFeed struct {
	mu             sync.Mutex
	epoch          string
	key            [32]byte
	next, floor    uint64
	events         []nativeEvent
	bytes, readers int
	wake           chan struct{}
	gap            string
	err            error
	leases         map[*invocation]struct{}
	publish        func(func() error) error
	upstreamCursor string
	qqSession      string
	qqSequence     int64
	qqHasSequence  bool
}
type nativeReceiver struct {
	feed       *nativeFeed
	ctx        context.Context
	cancel     context.CancelFunc
	done       chan struct{}
	generation uint64
}

func newNativeFeed() *nativeFeed {
	f := &nativeFeed{epoch: ulid.Make().String(), wake: make(chan struct{}), gap: "restart", leases: map[*invocation]struct{}{}}
	if _, err := rand.Read(f.key[:]); err != nil {
		panic(err)
	}
	return f
}
func (f *nativeFeed) notifyLocked() { close(f.wake); f.wake = make(chan struct{}) }
func (f *nativeFeed) pruneLocked(now time.Time) {
	for len(f.events) > 0 && (len(f.events) > 1000 || f.bytes > nativeFeedByteLimit || now.Sub(f.events[0].received) >= 24*time.Hour) {
		removed := f.events[0]
		f.events[0] = nativeEvent{}
		f.events = f.events[1:]
		f.bytes -= removed.bytes
		f.floor = removed.sequence
	}
}

// @nimi-authority: rule.nimi.runtime.integration.native-messaging
// Accept is the normalized buffer commit. Adapters ACK only a successful
// insertion; malformed/oversized input and a stopped receiver never ACK.
func (f *nativeFeed) Accept(ctx context.Context, id, conversation string, payload []byte) error {
	return f.accept(ctx, id, conversation, payload, nil)
}
func (f *nativeFeed) accept(ctx context.Context, id, conversation string, payload []byte, sources map[string]nativeSource) error {
	private, err := json.Marshal(sources)
	if err != nil || len(private) > nativeEventLimit {
		return adapterError("INTEGRATION_EVENT_BOUNDS")
	}
	size := len(payload)
	if sources != nil {
		size += len(private)
	}
	if len(payload) > nativeEventLimit || !json.Valid(payload) || !validExternalIdentifier(id) || conversation == "" || len(conversation) > 512 {
		return adapterError("INTEGRATION_EVENT_BOUNDS")
	}
	commit := func() error {
		if ctx.Err() != nil || f.readers == 0 {
			return context.Canceled
		}
		for _, event := range f.events {
			if event.id == id {
				return nil
			}
		}
		f.next++
		f.events = append(f.events, nativeEvent{sequence: f.next, id: id, conversation: conversation, received: time.Now(), payload: append(json.RawMessage(nil), payload...), sources: sources, bytes: size})
		f.bytes += size
		f.pruneLocked(time.Now())
		f.notifyLocked()
		return nil
	}
	if f.publish == nil {
		return adapterError("INTEGRATION_RECEIVER_UNAVAILABLE")
	}
	return f.publish(commit)
}
func (f *nativeFeed) fail(err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	// Preserve the initiating failure through secondary worker cancellation
	// and socket teardown. Explicit receiver restart clears this field.
	if f.err == nil {
		f.err = err
	}
	f.gap = "reconnect"
	f.notifyLocked()
}
func nativeBinding(d accountservice.LocalAppCallerDecision, t target, filter []string) string {
	sorted := append([]string(nil), filter...)
	sort.Strings(sorted)
	return ref("", d.AccountID, t.Public.TargetRef, strconv.FormatUint(t.CredentialGeneration, 10), strings.Join(sorted, "\x00"))
}
func (f *nativeFeed) cursor(binding string, sequence uint64) string {
	data, _ := json.Marshal(nativeCursor{Binding: binding, Epoch: f.epoch, Sequence: sequence})
	mac := hmac.New(sha256.New, f.key[:])
	mac.Write(data)
	return base64.RawURLEncoding.EncodeToString(data) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func (f *nativeFeed) parseCursor(raw, binding string) (uint64, error) {
	if len(raw) > 1024 {
		return 0, adapterError("INTEGRATION_CURSOR_INVALID")
	}
	parts := strings.Split(raw, ".")
	if len(parts) != 2 {
		return 0, adapterError("INTEGRATION_CURSOR_INVALID")
	}
	data, e := base64.RawURLEncoding.DecodeString(parts[0])
	if e != nil {
		return 0, adapterError("INTEGRATION_CURSOR_INVALID")
	}
	signature, e := base64.RawURLEncoding.DecodeString(parts[1])
	if e != nil {
		return 0, adapterError("INTEGRATION_CURSOR_INVALID")
	}
	var cursor nativeCursor
	if json.Unmarshal(data, &cursor) != nil || cursor.Binding != binding {
		return 0, adapterError("INTEGRATION_CURSOR_INVALID")
	}
	if cursor.Epoch != f.epoch {
		return 0, adapterError("INTEGRATION_CURSOR_EXPIRED")
	}
	mac := hmac.New(sha256.New, f.key[:])
	mac.Write(data)
	if !hmac.Equal(signature, mac.Sum(nil)) || cursor.Sequence > f.next {
		return 0, adapterError("INTEGRATION_CURSOR_INVALID")
	}
	if cursor.Sequence < f.floor {
		return 0, adapterError("INTEGRATION_CURSOR_EXPIRED")
	}
	return cursor.Sequence, nil
}
// @nimi-authority: rule.nimi.runtime.integration.native-messaging
func (f *nativeFeed) read(ctx context.Context, d accountservice.LocalAppCallerDecision, t target, filter []string, cursor string, wait time.Duration) (string, error) {
	binding := nativeBinding(d, t, filter)
	allowed := map[string]bool{}
	for _, key := range filter {
		allowed[key] = true
	}
	f.mu.Lock()
	f.pruneLocked(time.Now())
	after := f.next
	if cursor != "" {
		var err error
		after, err = f.parseCursor(cursor, binding)
		if err != nil {
			f.mu.Unlock()
			return "", err
		}
	}
	f.mu.Unlock()
	timer := time.NewTimer(wait)
	defer timer.Stop()
	for {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		f.mu.Lock()
		f.pruneLocked(time.Now())
		if after < f.floor {
			f.mu.Unlock()
			return "", adapterError("INTEGRATION_CURSOR_EXPIRED")
		}
		items := []json.RawMessage{}
		size := 0
		for _, event := range f.events {
			if event.sequence <= after {
				continue
			}
			if len(filter) != 0 && !allowed[event.conversation] {
				after = event.sequence
				continue
			}
			// Reserve room for the bounded cursor and result envelope before adding.
			if len(items) >= 32 || size+len(event.payload)+1024 > nativePageLimit {
				break
			}
			items = append(items, event.payload)
			size += len(event.payload) + 1
			after = event.sequence
		}
		wake, receiveErr, gap := f.wake, f.err, f.gap
		result, err := json.Marshal(map[string]any{"cursor": f.cursor(binding, after), "events": items, "coverageGap": gap})
		f.mu.Unlock()
		if err != nil {
			return "", err
		}
		if len(items) > 0 || wait == 0 {
			return string(result), nil
		}
		if receiveErr != nil {
			return "", receiveErr
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-timer.C:
			return string(result), nil
		case <-wake:
		}
	}
}
