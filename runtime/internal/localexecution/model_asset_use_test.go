package localexecution

import (
	"context"
	"sync/atomic"
	"testing"
)

func TestModelAssetUseRequestHandoffAndNestedScope(t *testing.T) {
	var releases atomic.Int32
	use := NewModelAssetUse(func() { releases.Add(1) })
	ctx, closeRequest := WithModelAssetUseScope(context.Background())
	if err := TrackModelAssetUse(ctx, use); err != nil {
		t.Fatal(err)
	}
	nested, closeNested := WithModelAssetUseScope(ctx)
	if err := TrackModelAssetUse(nested, use); err != nil {
		t.Fatal(err)
	}
	job, err := use.Retain()
	if err != nil {
		t.Fatal(err)
	}
	closeNested()
	closeRequest()
	if releases.Load() != 0 {
		t.Fatal("request return released the Job's captured files")
	}
	if _, err := use.Retain(); err == nil {
		t.Fatal("released request can retain a new use")
	}
	job.Release()
	job.Release()
	closeRequest()
	if releases.Load() != 1 {
		t.Fatalf("inventory release count = %d", releases.Load())
	}
}

func TestModelAssetUseClosedScopeFailsAndDisposesCapture(t *testing.T) {
	ctx, closeScope := WithModelAssetUseScope(context.Background())
	closeScope()
	released := false
	if err := TrackModelAssetUse(ctx, NewModelAssetUse(func() { released = true })); err == nil || !released {
		t.Fatalf("closed scope capture: err=%v released=%v", err, released)
	}
}
