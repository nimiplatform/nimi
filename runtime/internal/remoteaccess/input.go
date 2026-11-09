package remoteaccess

import (
	"context"
	"errors"
	"io"
	"sync"
)

const inputWindow = 4
const maxInputMessageBytes = (1 << 20) + 8192

// inputStream bounds unread method messages. EOF is explicit; connection or
// call cancellation never turns a partially received file into a valid upload.
// @nimi-authority: rule.nimi.runtime.remote-access.direct-transport
type inputStream struct {
	mu        sync.Mutex
	notify    chan struct{}
	queue     [][]byte
	partial   []byte
	receiving bool
	started   bool
	ended     bool
	finished  bool
	credits   uint32
	grant     func(context.Context, uint32) error
}

func newInputStream(grant func(context.Context, uint32) error) *inputStream {
	return &inputStream{notify: make(chan struct{}, 1), grant: grant}
}
func (s *inputStream) wake() {
	select {
	case s.notify <- struct{}{}:
	default:
	}
}
func (s *inputStream) accept(payload []byte, end bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ended || (!end && len(payload) == 0) {
		return errors.New("invalid upload message")
	}
	if !s.receiving {
		if s.credits == 0 {
			return errors.New("upload input window exceeded")
		}
		s.credits--
		s.receiving = true
	}
	if len(s.partial)+len(payload) > maxInputMessageBytes {
		return errors.New("upload method message too large")
	}
	s.partial = append(s.partial, payload...)
	if end {
		if !s.finished {
			s.queue = append(s.queue, s.partial)
		}
		s.partial = nil
		s.receiving = false
		s.wake()
	}
	return nil
}
func (s *inputStream) end() (finished bool, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ended || s.receiving {
		return false, errors.New("incomplete upload input")
	}
	s.ended = true
	s.wake()
	return s.finished, nil
}
func (s *inputStream) finish() (ended bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.finished = true
	s.queue = nil
	s.wake()
	return s.ended
}
func (s *inputStream) receive(ctx context.Context) ([]byte, error) {
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		s.mu.Lock()
		if s.finished {
			s.mu.Unlock()
			return nil, context.Canceled
		}
		var grant uint32
		if !s.started && !s.ended {
			s.started = true
			grant = inputWindow
			s.credits += grant
		}
		if len(s.queue) != 0 {
			value := s.queue[0]
			s.queue[0] = nil
			s.queue = s.queue[1:]
			if !s.ended {
				grant++
				s.credits++
			}
			s.mu.Unlock()
			if grant != 0 {
				if err := s.grant(ctx, grant); err != nil {
					return nil, err
				}
			}
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			return value, nil
		}
		ended := s.ended
		s.mu.Unlock()
		if ended {
			return nil, io.EOF
		}
		if grant != 0 {
			if err := s.grant(ctx, grant); err != nil {
				return nil, err
			}
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-s.notify:
		}
	}
}
