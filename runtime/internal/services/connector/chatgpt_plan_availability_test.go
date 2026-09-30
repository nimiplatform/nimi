package connector

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

type fakeChatGPTPlanAccountLister struct {
	release chan struct{}
	models  map[string]struct{}

	mu       sync.Mutex
	err      error
	finished int
}

func (lister *fakeChatGPTPlanAccountLister) ChatGPTPlanAccountModels(ctx context.Context, _ *nimillm.RemoteTarget) (map[string]struct{}, error) {
	<-lister.release
	lister.mu.Lock()
	defer lister.mu.Unlock()
	lister.finished++
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return lister.models, lister.err
}

func (lister *fakeChatGPTPlanAccountLister) finishedReads() int {
	lister.mu.Lock()
	defer lister.mu.Unlock()
	return lister.finished
}

// A configuration read waits only briefly: a slow account list read is not a
// failure and keeps running, the next read is answered, and only a failed
// read makes further reads skip the lookup for a while.
func TestChatGPTPlanAccountAvailabilityOutlivesSlowReads(t *testing.T) {
	store, _, record := newChatGPTPlanTestStore(t, &fakeChatGPTPlanRenewer{result: func(int32, string) (ChatGPTPlanTokenSet, error) {
		return ChatGPTPlanTokenSet{}, errors.New("a fresh credential is not renewed")
	}})
	lister := &fakeChatGPTPlanAccountLister{release: make(chan struct{}), models: map[string]struct{}{"gpt-6-astra": {}}}
	availability := &chatGPTPlanAccountAvailability{
		store: store, lister: lister, renewalWait: time.Second, listWait: 10 * time.Millisecond, unknownUntil: map[string]time.Time{},
	}
	ctx, cancel := context.WithCancel(context.Background())
	if _, known := availability.ListedModels(ctx, record); known {
		t.Fatal("a list read still running was reported as known")
	}
	// The caller leaving does not cancel the running read.
	cancel()
	close(lister.release)
	for deadline := time.Now().Add(2 * time.Second); lister.finishedReads() == 0; {
		if time.Now().After(deadline) {
			t.Fatal("the slow list read never finished")
		}
		time.Sleep(time.Millisecond)
	}
	availability.listWait = time.Second
	listed, known := availability.ListedModels(context.Background(), record)
	if _, offered := listed["gpt-6-astra"]; !known || !offered || len(listed) != 1 {
		t.Fatalf("read after a slow read = %v known=%v", listed, known)
	}
	lister.mu.Lock()
	lister.err = errors.New("account list unavailable")
	lister.mu.Unlock()
	if _, known := availability.ListedModels(context.Background(), record); known {
		t.Fatal("a failed list read was reported as known")
	}
	reads := lister.finishedReads()
	if _, known := availability.ListedModels(context.Background(), record); known || lister.finishedReads() != reads {
		t.Fatalf("read after a failure: known=%v reads %d -> %d", known, reads, lister.finishedReads())
	}
}
