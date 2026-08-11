package ai

import (
	"context"
	"sync"
)

// localMediaSubmissionOrder preserves the order in which asynchronous media
// Jobs became visible. Each Job runner owns its ticket through that capability's
// serial Job boundary; the engine Host remains the execution owner shared with
// non-Job consumers.
type localMediaSubmissionOrder struct {
	mu     sync.Mutex
	active bool
	queue  []*localMediaSubmissionTicket
}

type localMediaSubmissionTicket struct {
	owner   *localMediaSubmissionOrder
	ready   chan struct{}
	granted bool
	done    bool
}

func (order *localMediaSubmissionOrder) reserve() *localMediaSubmissionTicket {
	ticket := &localMediaSubmissionTicket{owner: order, ready: make(chan struct{})}
	order.mu.Lock()
	if !order.active && len(order.queue) == 0 {
		order.active = true
		ticket.granted = true
		close(ticket.ready)
	} else {
		order.queue = append(order.queue, ticket)
	}
	order.mu.Unlock()
	return ticket
}

func (ticket *localMediaSubmissionTicket) wait(ctx context.Context) error {
	if ticket == nil || ticket.owner == nil {
		return context.Canceled
	}
	if ctx == nil {
		ctx = context.Background()
	}
	select {
	case <-ticket.ready:
		if err := ctx.Err(); err != nil {
			ticket.release()
			return err
		}
		return nil
	case <-ctx.Done():
		ticket.release()
		return ctx.Err()
	}
}

func (ticket *localMediaSubmissionTicket) release() {
	if ticket == nil || ticket.owner == nil {
		return
	}
	order := ticket.owner
	order.mu.Lock()
	defer order.mu.Unlock()
	if ticket.done {
		return
	}
	ticket.done = true
	if !ticket.granted {
		for index, queued := range order.queue {
			if queued != ticket {
				continue
			}
			copy(order.queue[index:], order.queue[index+1:])
			order.queue[len(order.queue)-1] = nil
			order.queue = order.queue[:len(order.queue)-1]
			return
		}
		return
	}
	order.active = false
	if len(order.queue) == 0 {
		return
	}
	next := order.queue[0]
	copy(order.queue, order.queue[1:])
	order.queue[len(order.queue)-1] = nil
	order.queue = order.queue[:len(order.queue)-1]
	order.active = true
	next.granted = true
	close(next.ready)
}
