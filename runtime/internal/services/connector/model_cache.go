package connector

import (
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const modelCacheTTL = 5 * time.Minute

type cacheEntry struct {
	models    []*runtimev1.ConnectorModelDescriptor
	fetchedAt time.Time
}

// ModelCache provides per-connector model list caching with TTL.
type ModelCache struct {
	mu      sync.Mutex
	entries map[string]*cacheEntry
}

// NewModelCache creates a new empty model cache.
func NewModelCache() *ModelCache {
	return &ModelCache{
		entries: make(map[string]*cacheEntry),
	}
}

// Get returns cached models for a connector, or nil if cache miss or expired.
func (c *ModelCache) Get(connectorID string) []*runtimev1.ConnectorModelDescriptor {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[connectorID]
	if !ok {
		return nil
	}
	if time.Since(entry.fetchedAt) > modelCacheTTL {
		delete(c.entries, connectorID)
		return nil
	}
	return entry.models
}

// Set stores models in the cache for a connector.
func (c *ModelCache) Set(connectorID string, models []*runtimev1.ConnectorModelDescriptor) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[connectorID] = &cacheEntry{
		models:    models,
		fetchedAt: time.Now(),
	}
}

// Invalidate removes cache for a specific connector.
func (c *ModelCache) Invalidate(connectorID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.entries, connectorID)
}
