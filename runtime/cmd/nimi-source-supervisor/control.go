package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"sync"
	"time"
)

var errSourceRuntimeNotRunning = errors.New("source Runtime supervisor is not running")

type stopRequest struct {
	Action string `json:"action"`
	Force  bool   `json:"force"`
}

type stopResponse struct {
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
}

// @nimi-authority: rule.nimi.runtime.protected-session.r027
// The current-user endpoint only requests lifecycle changes from the owner.
// A stopped response is sent after the Runtime exits and the owner lock closes.
type supervisorControl struct {
	listener net.Listener
	requests chan bool
	done     chan struct{}
	accepted chan struct{}
	clients  sync.WaitGroup
	err      error
}

func newSupervisorControl(listener net.Listener) *supervisorControl {
	control := &supervisorControl{
		listener: listener,
		requests: make(chan bool, 1),
		done:     make(chan struct{}),
		accepted: make(chan struct{}),
	}
	go func() {
		defer close(control.accepted)
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			control.clients.Add(1)
			go control.handle(conn)
		}
	}()
	return control
}

func (control *supervisorControl) handle(conn net.Conn) {
	defer control.clients.Done()
	defer conn.Close()
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	var request stopRequest
	if err := json.NewDecoder(io.LimitReader(conn, 1024)).Decode(&request); err != nil || request.Action != "stop" {
		return
	}
	select {
	case control.requests <- request.Force:
	case <-control.done:
	}
	<-control.done
	response := stopResponse{Status: "stopped"}
	if control.err != nil {
		response = stopResponse{Status: "failed", Error: control.err.Error()}
	}
	_ = conn.SetWriteDeadline(time.Now().Add(3 * time.Second))
	_ = json.NewEncoder(conn).Encode(response)
}

func (control *supervisorControl) finish(err error) {
	control.err = errors.Join(err, control.listener.Close())
	close(control.done)
	<-control.accepted
	control.clients.Wait()
}

func stopSourceRuntime(args []string) error {
	flags := flag.NewFlagSet("nimi-source-supervisor stop", flag.ContinueOnError)
	timeout := flags.Duration("timeout", 10*time.Second, "shutdown timeout")
	force := flags.Bool("force", false, "force kill the owned Runtime process")
	flags.Bool("json", false, "output json")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 || *timeout <= 0 {
		return errors.New("stop requires a positive timeout and no positional arguments")
	}
	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	if err := requestSourceRuntimeStop(ctx, "", *force); err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]string{
		"status": "stopped", "topology": "source-local-development",
	})
}

func requestSourceRuntimeStop(ctx context.Context, lockPath string, force bool) error {
	conn, err := dialSourceRuntimeOwner(ctx, lockPath)
	if err != nil {
		return fmt.Errorf("connect to source Runtime supervisor: %w", err)
	}
	defer conn.Close()
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}
	if err := json.NewEncoder(conn).Encode(stopRequest{Action: "stop", Force: force}); err != nil {
		return fmt.Errorf("request source Runtime stop: %w", err)
	}
	var response stopResponse
	if err := json.NewDecoder(io.LimitReader(conn, 4096)).Decode(&response); err != nil {
		return fmt.Errorf("wait for source Runtime shutdown: %w", err)
	}
	if response.Status != "stopped" || response.Error != "" {
		return fmt.Errorf("source Runtime shutdown failed: %s", response.Error)
	}
	return nil
}
