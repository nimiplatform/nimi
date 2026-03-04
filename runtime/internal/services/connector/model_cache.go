package connector

import (
	"sync"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type cacheEntry struct {
	models []*runtimev1.ConnectorModelDescriptor
}

// ModelCache provides per-connector model list caching until explicit invalidation.
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

// Get returns cached models for a connector, or nil if cache miss.
func (c *ModelCache) Get(connectorID string) []*runtimev1.ConnectorModelDescriptor {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[connectorID]
	if !ok {
		return nil
	}
	return entry.models
}

// Set stores models in the cache for a connector.
func (c *ModelCache) Set(connectorID string, models []*runtimev1.ConnectorModelDescriptor) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[connectorID] = &cacheEntry{
		models: models,
	}
}

// Invalidate removes cache for a specific connector.
func (c *ModelCache) Invalidate(connectorID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.entries, connectorID)
}
