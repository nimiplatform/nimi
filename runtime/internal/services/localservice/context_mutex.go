package localservice

import (
	"context"
	"sync"
)

// contextMutex is a mutual-exclusion lock whose waiters can give up when their
// context ends. Its zero value is an unlocked mutex; it must not be copied
// after first use.
type contextMutex struct {
	once sync.Once
	slot chan struct{}
}

func (m *contextMutex) init() {
	m.once.Do(func() { m.slot = make(chan struct{}, 1) })
}

func (m *contextMutex) Lock() {
	m.init()
	m.slot <- struct{}{}
}

// LockContext waits for the lock until ctx ends and then returns ctx's error
// without holding it.
func (m *contextMutex) LockContext(ctx context.Context) error {
	m.init()
	if err := ctx.Err(); err != nil {
		return err
	}
	select {
	case m.slot <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// TryLock takes the lock only if it is free now.
func (m *contextMutex) TryLock() bool {
	m.init()
	select {
	case m.slot <- struct{}{}:
		return true
	default:
		return false
	}
}

func (m *contextMutex) Unlock() {
	m.init()
	select {
	case <-m.slot:
	default:
		panic("localservice: unlock of unlocked contextMutex")
	}
}
