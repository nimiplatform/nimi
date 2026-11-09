package remoteaccess

import (
	"bytes"
	"context"
	"errors"
	"io"
	"testing"
	"time"
)

func TestInputWindowBackpressureAndExplicitEOF(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	grants := make(chan uint32, 8)
	release := make(chan struct{})
	input := newInputStream(func(ctx context.Context, n uint32) error {
		grants <- n
		if n == inputWindow {
			select {
			case <-release:
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		return nil
	})
	first := make(chan []byte, 1)
	failures := make(chan error, 1)
	go func() {
		value, err := input.receive(ctx)
		if err != nil {
			failures <- err
		} else {
			first <- value
		}
	}()
	select {
	case n := <-grants:
		if n != inputWindow {
			t.Fatal(n)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	for n := 0; n < inputWindow; n++ {
		if err := input.accept([]byte{byte(n)}, true); err != nil {
			t.Fatal(err)
		}
	}
	if err := input.accept([]byte("outside-window"), true); err == nil {
		t.Fatal("accepted input without credit")
	}
	close(release)
	select {
	case value := <-first:
		if !bytes.Equal(value, []byte{0}) {
			t.Fatal(value)
		}
	case err := <-failures:
		t.Fatal(err)
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	if n := <-grants; n != 1 {
		t.Fatal(n)
	}
	if err := input.accept([]byte{4}, true); err != nil {
		t.Fatal(err)
	}
	if _, err := input.end(); err != nil {
		t.Fatal(err)
	}
	for n := 1; n <= inputWindow; n++ {
		value, err := input.receive(ctx)
		if err != nil || !bytes.Equal(value, []byte{byte(n)}) {
			t.Fatalf("value=%v error=%v", value, err)
		}
	}
	if _, err := input.receive(ctx); !errors.Is(err, io.EOF) {
		t.Fatalf("end=%v", err)
	}
	if err := input.accept([]byte{5}, true); err == nil {
		t.Fatal("accepted data after EOF")
	}
}

func TestCanceledInputIsNotEOF(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	granted := make(chan struct{})
	input := newInputStream(func(context.Context, uint32) error { close(granted); return nil })
	result := make(chan error, 1)
	go func() { _, err := input.receive(ctx); result <- err }()
	<-granted
	cancel()
	if err := <-result; !errors.Is(err, context.Canceled) || errors.Is(err, io.EOF) {
		t.Fatalf("cancel became EOF: %v", err)
	}
}

func TestInputRejectsOversizedAndIncompleteMessages(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	grants := make(chan uint32, 1)
	release := make(chan struct{})
	input := newInputStream(func(ctx context.Context, n uint32) error {
		grants <- n
		select {
		case <-release:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	})
	done := make(chan struct{})
	go func() { defer close(done); _, _ = input.receive(ctx) }()
	<-grants
	part := make([]byte, chunkBytes)
	for n := 0; n < maxInputMessageBytes/chunkBytes; n++ {
		if err := input.accept(part, false); err != nil {
			t.Fatal(err)
		}
	}
	if err := input.accept(part, true); err == nil {
		t.Fatal("accepted an oversized method message")
	}
	if _, err := input.end(); err == nil {
		t.Fatal("accepted EOF in a fragmented message")
	}
	cancel()
	<-done
}
