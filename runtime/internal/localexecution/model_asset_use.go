package localexecution

import (
	"context"
	"errors"
	"sync"
)

// ModelAssetUse is an in-process handoff of one inventory owner's pins. It is
// never serialized. A request owns the initial handle; a published Job retains
// its own handle before the request returns.
type ModelAssetUse struct {
	state    *modelAssetUseState
	released bool // guarded by state.mu
}

type modelAssetUseState struct {
	mu      sync.Mutex
	refs    int
	release func()
}

func NewModelAssetUse(release func()) *ModelAssetUse {
	return &ModelAssetUse{state: &modelAssetUseState{refs: 1, release: release}}
}

func (use *ModelAssetUse) Retain() (*ModelAssetUse, error) {
	if use == nil {
		return nil, nil
	}
	use.state.mu.Lock()
	defer use.state.mu.Unlock()
	if use.released || use.state.refs == 0 {
		return nil, errors.New("captured ModelAsset use was already released")
	}
	use.state.refs++
	return &ModelAssetUse{state: use.state}, nil
}

func (use *ModelAssetUse) Release() {
	if use == nil {
		return
	}
	use.state.mu.Lock()
	var release func()
	if !use.released {
		use.released = true
		use.state.refs--
		if use.state.refs == 0 {
			release = use.state.release
		}
	}
	use.state.mu.Unlock()
	if release != nil {
		release()
	}
}

type modelAssetUseScopeKey struct{}
type modelAssetUseScope struct {
	mu     sync.Mutex
	closed bool
	uses   map[*ModelAssetUse]struct{}
}

// Nested Runtime calls share their caller's scope. This is request lifetime,
// not an external host task or a second durable reference owner.
func WithModelAssetUseScope(ctx context.Context) (context.Context, func()) {
	if ctx == nil {
		ctx = context.Background()
	}
	if _, exists := ctx.Value(modelAssetUseScopeKey{}).(*modelAssetUseScope); exists {
		return ctx, func() {}
	}
	scope := &modelAssetUseScope{uses: make(map[*ModelAssetUse]struct{})}
	if selected, ok := ctx.Value(selectedLocalExecutionContextKey{}).(*SelectedLocalExecution); ok && selected != nil && selected.ModelAssetUse != nil {
		scope.uses[selected.ModelAssetUse] = struct{}{}
	}
	return context.WithValue(ctx, modelAssetUseScopeKey{}, scope), func() {
		scope.mu.Lock()
		uses := scope.uses
		scope.uses = nil
		scope.closed = true
		scope.mu.Unlock()
		for use := range uses {
			use.Release()
		}
	}
}

func TrackModelAssetUse(ctx context.Context, use *ModelAssetUse) error {
	if use == nil {
		return nil
	}
	use.state.mu.Lock()
	active := !use.released && use.state.refs > 0
	use.state.mu.Unlock()
	if !active {
		return errors.New("captured ModelAsset use was already released")
	}
	scope, ok := ctx.Value(modelAssetUseScopeKey{}).(*modelAssetUseScope)
	if !ok {
		use.Release()
		return errors.New("ModelAsset capture requires an execution lifetime scope")
	}
	scope.mu.Lock()
	if scope.closed {
		scope.mu.Unlock()
		use.Release()
		return errors.New("execution lifetime scope is closed")
	}
	scope.uses[use] = struct{}{}
	scope.mu.Unlock()
	return nil
}
