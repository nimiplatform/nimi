package idempotency

import (
	"container/list"
	"errors"
	"fmt"
	"sync"
	"time"

	"google.golang.org/protobuf/proto"
)

var (
	ErrInvalidTTL      = errors.New("ttl must be > 0")
	ErrInvalidCapacity = errors.New("capacity must be > 0")
)

type storeKey struct {
	Method         string
	AppID          string
	ParticipantID  string
	IdempotencyKey string
}

type entry struct {
	requestHash string
	response    proto.Message
	storedAt    time.Time
	element     *list.Element
}

// Store keeps write-call replay records with LRU eviction.
type Store struct {
	mu       sync.RWMutex
	ttl      time.Duration
	capacity int
	entries  map[storeKey]*entry
	order    *list.List
}

func New(ttl time.Duration, capacity int) (*Store, error) {
	if ttl <= 0 {
		return nil, fmt.Errorf("idempotency.New: %w", ErrInvalidTTL)
	}
	if capacity <= 0 {
		return nil, fmt.Errorf("idempotency.New: %w", ErrInvalidCapacity)
	}
	return &Store{
		ttl:      ttl,
		capacity: capacity,
		entries:  make(map[storeKey]*entry, capacity),
		order:    list.New(),
	}, nil
}

func (s *Store) key(method string, appID string, participantID string, idempotencyKey string) storeKey {
	return storeKey{
		Method:         method,
		AppID:          appID,
		ParticipantID:  participantID,
		IdempotencyKey: idempotencyKey,
	}
}

// Load returns cached response for an equivalent request.
// conflict=true means key exists but request hash mismatched.
// Conflicts intentionally preserve the original entry and do not refresh LRU position.
func (s *Store) Load(method string, appID string, participantID string, idempotencyKey string, requestHash string) (response proto.Message, hit bool, conflict bool) {
	key := s.key(method, appID, participantID, idempotencyKey)
	now := time.Now().UTC()

	s.mu.Lock()
	defer s.mu.Unlock()

	item, ok := s.entries[key]
	if !ok {
		return nil, false, false
	}
	if now.Sub(item.storedAt) > s.ttl {
		s.removeEntry(key, item)
		return nil, false, false
	}
	if item.requestHash != requestHash {
		return nil, false, true
	}
	s.moveToBack(item)
	return cloneMessage(item.response), true, false
}

func (s *Store) Save(method string, appID string, participantID string, idempotencyKey string, requestHash string, response proto.Message) {
	if response == nil {
		return
	}

	key := s.key(method, appID, participantID, idempotencyKey)
	s.mu.Lock()
	defer s.mu.Unlock()

	if item, exists := s.entries[key]; exists {
		item.requestHash = requestHash
		item.response = cloneMessage(response)
		item.storedAt = time.Now().UTC()
		s.moveToBack(item)
	} else {
		element := s.order.PushBack(key)
		s.entries[key] = &entry{
			requestHash: requestHash,
			response:    cloneMessage(response),
			storedAt:    time.Now().UTC(),
			element:     element,
		}
	}

	for len(s.entries) > s.capacity {
		oldest := s.order.Front()
		if oldest == nil {
			break
		}
		evictKey, _ := oldest.Value.(storeKey)
		if item := s.entries[evictKey]; item != nil {
			s.removeEntry(evictKey, item)
			continue
		}
		s.order.Remove(oldest)
	}
}

func (s *Store) removeEntry(key storeKey, item *entry) {
	delete(s.entries, key)
	if item != nil && item.element != nil {
		s.order.Remove(item.element)
		item.element = nil
	}
}

func (s *Store) moveToBack(item *entry) {
	if item == nil || item.element == nil {
		return
	}
	s.order.MoveToBack(item.element)
}

func cloneMessage(value proto.Message) proto.Message {
	if value == nil {
		return nil
	}
	return proto.Clone(value)
}
