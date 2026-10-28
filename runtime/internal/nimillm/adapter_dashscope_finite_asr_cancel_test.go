package nimillm

import (
	"context"
	"encoding/binary"
	"errors"
	"golang.org/x/net/websocket"
	"net/http/httptest"
	"runtime"
	"strings"
	"testing"
	"time"
)

// Exercises the actual finite ASR adapter against a local peer which completes
// the opening exchange, sends task-started, then applies ordinary backpressure.
// Cancellation must release the actual sender and adapter without peer help.
func TestFiniteASRBackpressureCancellationReleasesTransport(t *testing.T) {
	audio := make([]byte, 44+24000*2*120)
	copy(audio, finiteASRTestWAV()[:44])
	binary.LittleEndian.PutUint32(audio[4:8], uint32(len(audio)-8))
	binary.LittleEndian.PutUint32(audio[40:44], uint32(len(audio)-44))
	if _, duration, err := finiteASRWAVInfo(audio); err != nil || duration != 120 {
		t.Fatalf("invalid fixture: %v %.2f", err, duration)
	}
	ready, release := make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(websocket.Handler(func(conn *websocket.Conn) {
		defer conn.Close()
		var start map[string]any
		if err := websocket.JSON.Receive(conn, &start); err != nil {
			return
		}
		taskID := ValueAsString(MapField(start["header"], "task_id"))
		finiteASRSendEvent(t, conn, taskID, "task-started", nil)
		close(ready)
		<-release
	}))
	defer server.Close()
	defer close(release)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, _, _, err := executeDashScopeFiniteASR(ctx, MediaAdapterConfig{BaseURL: server.URL, APIKey: "local-fixture", AllowLoopbackEndpoint: true}, finiteASRTestRequest(audio), "qwen-audio-3.0-asr-flash-streaming")
		done <- err
	}()
	select {
	case <-ready:
	case err := <-done:
		t.Fatalf("never reached transport: %v", err)
	case <-time.After(3 * time.Second):
		t.Fatal("open timeout")
	}
	// Establish the concrete blocked write, not merely an arbitrary timing guess.
	blocked := false
	for until := time.Now().Add(3 * time.Second); time.Now().Before(until); {
		buf := make([]byte, 1<<20)
		stack := string(buf[:runtime.Stack(buf, true)])
		for _, goroutine := range strings.Split(stack, "\n\n") {
			if strings.Contains(goroutine, "sendFiniteASRAudio") && strings.Contains(goroutine, "internal/poll") {
				blocked = true
				break
			}
		}
		if blocked {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !blocked {
		t.Fatal("fixture did not establish blocked physical send")
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancel outcome: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("cancel did not release blocked physical send")
	}
}
