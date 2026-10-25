package localexecution

import (
	"context"
	"errors"
	"sync"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

type readProjectionKey struct{}

type readProjection struct {
	ctx     context.Context
	once    sync.Once
	done    chan struct{}
	profile *runtimev1.LocalDeviceProfile
	err     error
}

// WithReadProjection starts one AIConfig read's private projection pass. It
// always creates a new pass, even when the caller reused an incoming context.
// The pass is not an execution, Apply, or background Job admission snapshot.
// @nimi-authority: rule.nimi.runtime.local-compute.r066
func WithReadProjection(ctx context.Context) context.Context {
	return context.WithValue(ctx, readProjectionKey{}, &readProjection{ctx: ctx, done: make(chan struct{})})
}

// ReadProjectionDeviceProfile collects current device facts on first use and
// shares them only with this read's consumers. Clones prevent either a
// collector or consumer from changing the pass's captured facts. Calls outside
// an explicit read pass keep collecting fresh facts.
func ReadProjectionDeviceProfile(ctx context.Context, collect func(context.Context) (*runtimev1.LocalDeviceProfile, error)) (*runtimev1.LocalDeviceProfile, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	pass, _ := ctx.Value(readProjectionKey{}).(*readProjection)
	if pass == nil {
		return collectReadProjectionDeviceProfile(ctx, collect)
	}
	pass.once.Do(func() {
		go func() {
			pass.profile, pass.err = collectReadProjectionDeviceProfile(pass.ctx, collect)
			close(pass.done)
		}()
	})
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-pass.done:
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if pass.err != nil {
			return nil, pass.err
		}
		return proto.Clone(pass.profile).(*runtimev1.LocalDeviceProfile), nil
	}
}

func collectReadProjectionDeviceProfile(ctx context.Context, collect func(context.Context) (*runtimev1.LocalDeviceProfile, error)) (*runtimev1.LocalDeviceProfile, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	profile, err := collect(ctx)
	if contextErr := ctx.Err(); contextErr != nil {
		return nil, contextErr
	}
	if err != nil {
		return nil, err
	}
	if profile == nil {
		return nil, errors.New("device profile collection returned no facts")
	}
	return proto.Clone(profile).(*runtimev1.LocalDeviceProfile), nil
}
