package idempotency

import (
	"strings"
	"sync"
	"time"

	"google.golang.org/protobuf/proto"
)

type entry struct {
	requestHash string
	response    any
	storedAt    time.Time
}

// Store keeps write-call replay records.
type Store struct {
	mu      sync.RWMutex
	ttl     time.Duration
	entries map[string]entry
}

func New(ttl time.Duration) *Store {
	if ttl <= 0 {
		ttl = 24 * time.Hour
	}
	return &Store{
		ttl:     ttl,
		entries: make(map[string]entry),
	}
}

func (s *Store) key(method string, appID string, participantID string, idempotencyKey string) string {
	return strings.TrimSpace(method) + "::" +
		strings.TrimSpace(appID) + "::" +
		strings.TrimSpace(participantID) + "::" +
		strings.TrimSpace(idempotencyKey)
}

// Load returns cached response for an equivalent request.
// conflict=true means key exists but request hash mismatched.
func (s *Store) Load(method string, appID string, participantID string, idempotencyKey string, requestHash string) (response any, hit bool, conflict bool) {
	key := s.key(method, appID, participantID, idempotencyKey)
	now := time.Now().UTC()

	s.mu.Lock()
	defer s.mu.Unlock()

	item, ok := s.entries[key]
	if !ok {
		return nil, false, false
	}
	if now.Sub(item.storedAt) > s.ttl {
		delete(s.entries, key)
		return nil, false, false
	}
	if item.requestHash != strings.TrimSpace(requestHash) {
		return nil, false, true
	}
	return cloneAny(item.response), true, false
}

func (s *Store) Save(method string, appID string, participantID string, idempotencyKey string, requestHash string, response any) {
	key := s.key(method, appID, participantID, idempotencyKey)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entries[key] = entry{
		requestHash: strings.TrimSpace(requestHash),
		response:    cloneAny(response),
		storedAt:    time.Now().UTC(),
	}
}

func cloneAny(value any) any {
	msg, ok := value.(proto.Message)
	if !ok {
		return value
	}
	return proto.Clone(msg)
}
