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

// Store keeps write-call replay records with LRU eviction.
type Store struct {
	mu       sync.RWMutex
	ttl      time.Duration
	capacity int
	entries  map[string]entry
	order    []string // insertion/access order for LRU eviction
}

func New(ttl time.Duration, capacity int) *Store {
	if ttl <= 0 {
		ttl = 24 * time.Hour
	}
	if capacity <= 0 {
		capacity = 10000
	}
	return &Store{
		ttl:      ttl,
		capacity: capacity,
		entries:  make(map[string]entry, capacity),
		order:    make([]string, 0, capacity),
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
		s.removeFromOrder(key)
		return nil, false, false
	}
	if item.requestHash != strings.TrimSpace(requestHash) {
		return nil, false, true
	}
	// Refresh LRU position on hit.
	s.moveToBack(key)
	return cloneAny(item.response), true, false
}

func (s *Store) Save(method string, appID string, participantID string, idempotencyKey string, requestHash string, response any) {
	key := s.key(method, appID, participantID, idempotencyKey)
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.entries[key]; exists {
		s.moveToBack(key)
	} else {
		s.order = append(s.order, key)
	}

	s.entries[key] = entry{
		requestHash: strings.TrimSpace(requestHash),
		response:    cloneAny(response),
		storedAt:    time.Now().UTC(),
	}

	// Evict LRU entries when over capacity.
	for len(s.entries) > s.capacity && len(s.order) > 0 {
		evictKey := s.order[0]
		s.order = s.order[1:]
		delete(s.entries, evictKey)
	}
}

func (s *Store) removeFromOrder(key string) {
	for i, k := range s.order {
		if k == key {
			s.order = append(s.order[:i], s.order[i+1:]...)
			return
		}
	}
}

func (s *Store) moveToBack(key string) {
	s.removeFromOrder(key)
	s.order = append(s.order, key)
}

func cloneAny(value any) any {
	msg, ok := value.(proto.Message)
	if !ok {
		return value
	}
	return proto.Clone(msg)
}
