package integration

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/oklog/ulid/v2"
)

type onebotReply struct {
	Status  string          `json:"status"`
	Retcode *int64          `json:"retcode"`
	Data    json.RawMessage `json:"data"`
	Echo    json.RawMessage `json:"echo"`
}
type onebotResponse struct {
	reply onebotReply
	err   error
}
type onebotPeer struct {
	bridge           *onebotBridge
	conn             *websocket.Conn
	role, generation string
	write            sync.Mutex
	mu               sync.Mutex
	pending          map[string]chan onebotResponse
	closed           bool
}
type onebotBridge struct {
	ctx                           context.Context
	cancel                        context.CancelFunc
	done                          chan struct{}
	target                        target
	secret                        string
	refs                          int // Service.mu
	server                        *http.Server
	listener                      net.Listener
	mu                            sync.Mutex
	roles                         map[string]*onebotPeer
	changed                       chan struct{}
	verified, stopping            bool
	name, implementation, version string
	feed                          *nativeFeed
	peers                         sync.WaitGroup
	failure                       error
}

// TCP admission precedes net/http's per-connection goroutine and header read.
type onebotListener struct {
	net.Listener
	ctx   context.Context
	slots chan struct{}
}
type onebotSocket struct {
	net.Conn
	release func()
	once    sync.Once
}

func (c *onebotSocket) Close() error { err := c.Conn.Close(); c.once.Do(c.release); return err }
func (l *onebotListener) Accept() (net.Conn, error) {
	select {
	case l.slots <- struct{}{}:
	case <-l.ctx.Done():
		return nil, net.ErrClosed
	}
	conn, err := l.Listener.Accept()
	if err != nil {
		<-l.slots
		return nil, err
	}
	return &onebotSocket{Conn: conn, release: func() { <-l.slots }}, nil
}

func (b *onebotBridge) notifyLocked() { close(b.changed); b.changed = make(chan struct{}) }
func (b *onebotBridge) fail(err error) {
	b.mu.Lock()
	if b.failure == nil {
		b.failure = err
	}
	b.notifyLocked()
	b.mu.Unlock()
	b.cancel()
}
func (b *onebotBridge) closePeers() {
	b.mu.Lock()
	b.stopping = true
	for _, p := range b.roles {
		if p != nil {
			p.conn.Close()
		}
	}
	b.notifyLocked()
	b.mu.Unlock()
}

// @nimi-authority: rule.nimi.runtime.integration.qq-onebot-protocol
// An explicit operation opens the configured endpoint. The external protocol
// end owns its reconnect configuration; no old action is resent by this bridge.
func (s *Service) acquireOnebot(ctx context.Context, t target, secret string) (*onebotBridge, func(), error) {
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	for {
		s.mu.Lock()
		if s.closed || s.quiesced.Load() || s.removing[t.Public.TargetRef] {
			s.mu.Unlock()
			return nil, nil, adapterError("INTEGRATION_SCOPE_ENDED")
		}
		if s.onebotBridges == nil {
			s.onebotBridges = map[string]*onebotBridge{}
		}
		b := s.onebotBridges[t.Public.TargetRef]
		if b != nil && b.ctx.Err() != nil {
			s.mu.Unlock()
			select {
			case <-b.done:
				continue
			case <-ctx.Done():
				return nil, nil, ctx.Err()
			case <-deadline.C:
				return nil, nil, adapterError("INTEGRATION_RECEIVER_DRAINING")
			}
		}
		if b != nil && (b.target.CredentialGeneration != t.CredentialGeneration || b.secret != secret) {
			s.mu.Unlock()
			return nil, nil, adapterError("INTEGRATION_ONEBOT_BUSY")
		}
		if b == nil {
			if len(s.onebotBridges) >= 8 {
				s.mu.Unlock()
				return nil, nil, adapterError("INTEGRATION_ONEBOT_LISTENER_LIMIT")
			}
			host, _, err := net.SplitHostPort(t.Config.OnebotV11.Listener)
			ip := net.ParseIP(host)
			if err != nil || ip == nil || !ip.IsLoopback() {
				s.mu.Unlock()
				return nil, nil, adapterError("INTEGRATION_ONEBOT_TRANSPORT_PROTECTION_REQUIRED")
			}
			listener, err := net.Listen("tcp", t.Config.OnebotV11.Listener)
			if err != nil {
				s.mu.Unlock()
				return nil, nil, adapterError("INTEGRATION_ONEBOT_LISTENER_BUSY")
			}
			owner, cancel := context.WithCancel(s.ctx)
			listener = &onebotListener{Listener: listener, ctx: owner, slots: make(chan struct{}, 8)}
			b = &onebotBridge{ctx: owner, cancel: cancel, done: make(chan struct{}), target: t, secret: secret, listener: listener, roles: map[string]*onebotPeer{}, changed: make(chan struct{})}
			b.server = &http.Server{Handler: http.HandlerFunc(b.serve), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 10 * time.Second, MaxHeaderBytes: 8192}
			s.onebotBridges[t.Public.TargetRef] = b
			s.workers.Add(1)
			go func() {
				defer s.workers.Done()
				stopDone := make(chan struct{})
				go func() { <-b.ctx.Done(); b.server.Close(); b.closePeers(); close(stopDone) }()
				err := b.server.Serve(listener)
				b.fail(err)
				<-stopDone
				b.peers.Wait()
				s.mu.Lock()
				if s.onebotBridges[t.Public.TargetRef] == b {
					delete(s.onebotBridges, t.Public.TargetRef)
				}
				s.mu.Unlock()
				close(b.done)
			}()
		}
		b.refs++
		s.mu.Unlock()
		var once sync.Once
		release := func() {
			once.Do(func() {
				s.mu.Lock()
				b.refs--
				if b.refs == 0 {
					b.cancel()
				}
				s.mu.Unlock()
			})
		}
		return b, release, nil
	}
}
func (b *onebotBridge) serve(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet || r.URL.Path != "/" || r.URL.RawQuery != "" || r.Header.Get("Origin") != "" {
		http.Error(w, "invalid endpoint", 400)
		return
	}
	authorization := r.Header.Get("Authorization")
	expected := "Bearer " + b.secret
	if b.secret == "" || len(authorization) != len(expected) || subtle.ConstantTimeCompare([]byte(authorization), []byte(expected)) != 1 {
		http.Error(w, "unauthorized", 401)
		return
	}
	role := r.Header.Get("X-Client-Role")
	if r.Header.Get("X-Self-ID") != b.target.Config.OnebotV11.SelfId || (role != "API" && role != "Event" && role != "Universal") {
		http.Error(w, "invalid identity or role", 403)
		return
	}
	b.mu.Lock()
	_, occupied := b.roles[role]
	_, universal := b.roles["Universal"]
	conflict := occupied || universal || (role == "Universal" && len(b.roles) > 0)
	if conflict || b.stopping || b.ctx.Err() != nil {
		b.mu.Unlock()
		http.Error(w, "endpoint unavailable", 409)
		return
	}
	b.roles[role] = nil
	b.peers.Add(1)
	b.mu.Unlock()
	defer b.peers.Done()
	upgrader := websocket.Upgrader{HandshakeTimeout: 5 * time.Second, ReadBufferSize: 4096, WriteBufferSize: 4096, CheckOrigin: func(*http.Request) bool { return true }}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		b.mu.Lock()
		delete(b.roles, role)
		b.notifyLocked()
		b.mu.Unlock()
		return
	}
	p := &onebotPeer{bridge: b, conn: conn, role: role, generation: ulid.Make().String(), pending: map[string]chan onebotResponse{}}
	b.mu.Lock()
	if b.stopping || b.ctx.Err() != nil {
		b.mu.Unlock()
		conn.Close()
		return
	}
	b.roles[role] = p
	b.notifyLocked()
	b.mu.Unlock()
	readDone := make(chan struct{})
	go func() { defer close(readDone); p.read() }()
	defer func() { conn.Close(); <-readDone }()
	if role != "Event" {
		verification, cancel := context.WithTimeout(b.ctx, 15*time.Second)
		defer cancel()
		login, _, err := p.call(verification, "get_login_info", map[string]any{}, nil)
		if err != nil {
			b.fail(err)
			return
		}
		var identity struct {
			ID   json.Number `json:"user_id"`
			Name string      `json:"nickname"`
		}
		if json.Unmarshal(login.Data, &identity) != nil || identity.ID.String() != b.target.Config.OnebotV11.SelfId || len(identity.Name) > 256 {
			b.fail(adapterError("INTEGRATION_ONEBOT_IDENTITY_INVALID"))
			return
		}
		version, _, err := p.call(verification, "get_version_info", map[string]any{}, nil)
		if err != nil {
			b.fail(err)
			return
		}
		var info struct {
			App      string `json:"app_name"`
			Version  string `json:"app_version"`
			Protocol string `json:"protocol_version"`
		}
		if json.Unmarshal(version.Data, &info) != nil || !validExternalIdentifier(info.App) || !validExternalIdentifier(info.Version) || info.Protocol != "v11" {
			b.fail(adapterError("INTEGRATION_ONEBOT_VERSION_INVALID"))
			return
		}
		if b.target.OnebotImplementation != "" && (b.target.OnebotImplementation != info.App || b.target.OnebotVersion != info.Version) {
			b.fail(adapterError("INTEGRATION_ONEBOT_IMPLEMENTATION_CHANGED"))
			return
		}
		b.mu.Lock()
		if b.ctx.Err() == nil {
			b.verified = true
			b.name = identity.Name
			b.implementation = info.App
			b.version = info.Version
			b.notifyLocked()
		}
		b.mu.Unlock()
	}
	select {
	case <-readDone:
	case <-b.ctx.Done():
	}
}
func (b *onebotBridge) wait(ctx context.Context, event bool) (*onebotPeer, error) {
	for {
		b.mu.Lock()
		p := b.roles["Universal"]
		if p == nil {
			p = b.roles["API"]
		}
		eventReady := b.roles["Universal"] != nil || b.roles["Event"] != nil
		ok := b.verified && p != nil && (!event || eventReady)
		changed, err := b.changed, b.failure
		b.mu.Unlock()
		if b.ctx.Err() != nil {
			if err != nil {
				return nil, err
			}
			return nil, adapterError("INTEGRATION_ONEBOT_DISCONNECTED")
		}
		if ok {
			return p, nil
		}
		select {
		case <-ctx.Done():
			return nil, adapterError("INTEGRATION_ONEBOT_CONNECTION_TIMEOUT")
		case <-b.ctx.Done():
		case <-changed:
		}
	}
}
func (p *onebotPeer) read() {
	defer func() {
		p.mu.Lock()
		p.closed = true
		for echo, ch := range p.pending {
			ch <- onebotResponse{err: adapterError("INTEGRATION_ONEBOT_DISCONNECTED")}
			delete(p.pending, echo)
		}
		p.mu.Unlock()
		p.bridge.fail(adapterError("INTEGRATION_ONEBOT_DISCONNECTED"))
	}()
	p.conn.SetReadLimit(1024 * 1024)
	for {
		kind, data, err := p.conn.ReadMessage()
		if err != nil {
			if errors.Is(err, websocket.ErrReadLimit) {
				p.bridge.fail(adapterError("INTEGRATION_ONEBOT_FRAME_BOUNDS"))
			}
			return
		}
		if kind != websocket.TextMessage || !json.Valid(data) {
			p.bridge.fail(adapterError("INTEGRATION_ONEBOT_FRAME_INVALID"))
			return
		}
		var envelope struct {
			PostType string          `json:"post_type"`
			Echo     json.RawMessage `json:"echo"`
		}
		if json.Unmarshal(data, &envelope) != nil {
			p.bridge.fail(adapterError("INTEGRATION_ONEBOT_FRAME_INVALID"))
			return
		}
		if envelope.PostType != "" {
			if p.role == "API" {
				p.bridge.fail(adapterError("INTEGRATION_ONEBOT_ROLE_INVALID"))
				return
			}
			p.bridge.mu.Lock()
			feed, verified := p.bridge.feed, p.bridge.verified
			p.bridge.mu.Unlock()
			if verified && feed != nil {
				if err := acceptOnebotMessage(p.bridge.ctx, feed, p.bridge.target.Config.OnebotV11.SelfId, data); err != nil {
					if errors.Is(err, context.Canceled) {
						continue
					}
					feed.fail(err)
					p.bridge.fail(err)
					return
				}
			}
			continue
		}
		if p.role == "Event" {
			p.bridge.fail(adapterError("INTEGRATION_ONEBOT_ROLE_INVALID"))
			return
		}
		var echo string
		if json.Unmarshal(envelope.Echo, &echo) != nil || echo == "" {
			continue
		}
		p.mu.Lock()
		ch, ok := p.pending[echo]
		if ok {
			delete(p.pending, echo)
		}
		p.mu.Unlock()
		if !ok {
			continue
		}
		var reply onebotReply
		if json.Unmarshal(data, &reply) != nil {
			ch <- onebotResponse{err: adapterError("INTEGRATION_ONEBOT_RESPONSE_INVALID")}
		} else {
			ch <- onebotResponse{reply: reply}
		}
	}
}
func (p *onebotPeer) call(ctx context.Context, action string, params any, admit func() error) (onebotReply, effectOutcome, error) {
	echo := p.generation + "_" + ulid.Make().String()
	ch := make(chan onebotResponse, 1)
	p.mu.Lock()
	if p.closed || len(p.pending) >= 32 {
		p.mu.Unlock()
		return onebotReply{}, notDispatched, adapterError("INTEGRATION_ONEBOT_ACTION_LIMIT")
	}
	p.pending[echo] = ch
	p.mu.Unlock()
	defer func() { p.mu.Lock(); delete(p.pending, echo); p.mu.Unlock() }()
	data, err := json.Marshal(map[string]any{"action": action, "params": params, "echo": echo})
	if err != nil || len(data) > 6*1024*1024 {
		return onebotReply{}, notDispatched, adapterError("INTEGRATION_ONEBOT_REQUEST_BOUNDS")
	}
	p.write.Lock()
	if ctx.Err() != nil || p.bridge.ctx.Err() != nil {
		p.write.Unlock()
		return onebotReply{}, notDispatched, adapterError("INTEGRATION_SCOPE_ENDED")
	}
	if admit != nil {
		if err = admit(); err != nil {
			p.write.Unlock()
			return onebotReply{}, notDispatched, err
		}
	}
	p.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	err = p.conn.WriteMessage(websocket.TextMessage, data)
	p.write.Unlock()
	if err != nil {
		return onebotReply{}, effectUnknown, adapterError("INTEGRATION_ONEBOT_WRITE_UNCONFIRMED")
	}
	select {
	case <-ctx.Done():
		return onebotReply{}, effectUnknown, adapterError("INTEGRATION_ONEBOT_RESPONSE_UNCONFIRMED")
	case result := <-ch:
		if result.err != nil {
			return onebotReply{}, effectUnknown, result.err
		}
		reply := result.reply
		if reply.Retcode != nil && reply.Status == "ok" && *reply.Retcode == 0 {
			return reply, providerConfirmed, nil
		}
		if reply.Retcode != nil && reply.Status == "failed" && *reply.Retcode != 0 {
			return reply, providerRejected, adapterError("INTEGRATION_ONEBOT_REQUEST_REJECTED")
		}
		return reply, effectUnknown, adapterError("INTEGRATION_ONEBOT_RESULT_UNCONFIRMED")
	}
}
