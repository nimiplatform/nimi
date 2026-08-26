package realmrealtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/net/websocket"
)

var (
	errSocketClosed   = errors.New("Realm realtime socket is closed")
	errSocketProtocol = errors.New("Realm realtime socket protocol failure")
	errSocketAuth     = errors.New("Realm realtime authentication rejected")
)

type socketEvent struct {
	name    string
	payload json.RawMessage
}

type socketIOClient struct {
	conn      *websocket.Conn
	writeMu   sync.Mutex
	ackMu     sync.Mutex
	acks      map[uint64]chan json.RawMessage
	nextAckID atomic.Uint64
	events    chan socketEvent
	errors    chan error
	closeOnce sync.Once
	closed    chan struct{}
}

// @nimi-authority: rule.nimi.runtime.realm-realtime.r001
func dialSocketIO(ctx context.Context, origin string, accessToken string) (*socketIOClient, error) {
	target, websocketOrigin, err := socketIOWebsocketURL(origin)
	if err != nil {
		return nil, err
	}
	config, err := websocket.NewConfig(target, websocketOrigin)
	if err != nil {
		return nil, fmt.Errorf("build Realm realtime websocket config: %w", err)
	}
	conn, err := websocket.DialConfig(config)
	if err != nil {
		return nil, fmt.Errorf("connect Realm realtime websocket: %w", err)
	}
	conn.PayloadType = websocket.TextFrame
	_ = conn.SetDeadline(time.Now().Add(10 * time.Second))
	if err := socketIOHandshake(conn, accessToken); err != nil {
		_ = conn.Close()
		return nil, err
	}
	_ = conn.SetDeadline(time.Time{})
	client := &socketIOClient{
		conn:   conn,
		acks:   make(map[uint64]chan json.RawMessage),
		events: make(chan socketEvent, 256),
		errors: make(chan error, 1),
		closed: make(chan struct{}),
	}
	go client.readLoop()
	go func() {
		select {
		case <-ctx.Done():
			client.Close()
		case <-client.closed:
		}
	}()
	return client, nil
}

func socketIOWebsocketURL(origin string) (string, string, error) {
	parsed, err := url.Parse(strings.TrimRight(strings.TrimSpace(origin), "/"))
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", "", fmt.Errorf("Realm realtime origin is invalid")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", "", fmt.Errorf("Realm realtime origin authority is invalid")
	}
	originURL := &url.URL{Scheme: parsed.Scheme, Host: parsed.Host}
	if parsed.Scheme == "https" {
		parsed.Scheme = "wss"
	} else {
		parsed.Scheme = "ws"
	}
	parsed.Path = "/socket.io/"
	parsed.RawPath = ""
	query := parsed.Query()
	query.Set("EIO", "4")
	query.Set("transport", "websocket")
	parsed.RawQuery = query.Encode()
	return parsed.String(), originURL.String(), nil
}

func socketIOHandshake(conn *websocket.Conn, accessToken string) error {
	var opening string
	if err := websocket.Message.Receive(conn, &opening); err != nil {
		return fmt.Errorf("read Realm realtime opening frame: %w", err)
	}
	if !strings.HasPrefix(opening, "0{") {
		return errSocketProtocol
	}
	auth, err := json.Marshal(map[string]string{"token": strings.TrimSpace(accessToken)})
	if err != nil {
		return errSocketProtocol
	}
	if err := websocket.Message.Send(conn, "40"+string(auth)); err != nil {
		return fmt.Errorf("send Realm realtime connect frame: %w", err)
	}
	for {
		var frame string
		if err := websocket.Message.Receive(conn, &frame); err != nil {
			return fmt.Errorf("read Realm realtime connect acknowledgement: %w", err)
		}
		switch {
		case frame == "2":
			if err := websocket.Message.Send(conn, "3"); err != nil {
				return fmt.Errorf("reply Realm realtime handshake ping: %w", err)
			}
		case strings.HasPrefix(frame, "40"):
			return nil
		case strings.HasPrefix(frame, "44"):
			return errSocketAuth
		}
	}
}

func (c *socketIOClient) EmitAck(ctx context.Context, eventName string, payload any) (json.RawMessage, error) {
	if c == nil {
		return nil, errSocketClosed
	}
	id := c.nextAckID.Add(1)
	body, err := json.Marshal([]any{eventName, payload})
	if err != nil {
		return nil, fmt.Errorf("encode Realm realtime operation: %w", err)
	}
	ack := make(chan json.RawMessage, 1)
	c.ackMu.Lock()
	c.acks[id] = ack
	c.ackMu.Unlock()
	defer func() {
		c.ackMu.Lock()
		delete(c.acks, id)
		c.ackMu.Unlock()
	}()
	if err := c.send("42" + strconv.FormatUint(id, 10) + string(body)); err != nil {
		return nil, err
	}
	select {
	case response := <-ack:
		return response, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-c.closed:
		return nil, errSocketClosed
	}
}

func (c *socketIOClient) Events() <-chan socketEvent { return c.events }
func (c *socketIOClient) Errors() <-chan error       { return c.errors }

func (c *socketIOClient) Close() {
	if c == nil {
		return
	}
	c.closeOnce.Do(func() {
		close(c.closed)
		_ = c.conn.Close()
	})
}

func (c *socketIOClient) send(frame string) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	select {
	case <-c.closed:
		return errSocketClosed
	default:
	}
	if err := websocket.Message.Send(c.conn, frame); err != nil {
		return fmt.Errorf("send Realm realtime frame: %w", err)
	}
	return nil
}

func (c *socketIOClient) readLoop() {
	defer close(c.events)
	for {
		var frame string
		if err := websocket.Message.Receive(c.conn, &frame); err != nil {
			select {
			case <-c.closed:
			default:
				select {
				case c.errors <- fmt.Errorf("read Realm realtime frame: %w", err):
				default:
				}
			}
			c.Close()
			return
		}
		switch {
		case frame == "2":
			if err := c.send("3"); err != nil {
				c.reportError(err)
				c.Close()
				return
			}
		case strings.HasPrefix(frame, "42"):
			event, err := decodeSocketEvent(frame[2:])
			if err != nil {
				c.reportError(err)
				c.Close()
				return
			}
			select {
			case c.events <- event:
			default:
				c.reportError(fmt.Errorf("Realm realtime event buffer exhausted"))
				c.Close()
				return
			}
		case strings.HasPrefix(frame, "43"):
			id, payload, err := decodeSocketAck(frame[2:])
			if err != nil {
				c.reportError(err)
				c.Close()
				return
			}
			c.ackMu.Lock()
			ack := c.acks[id]
			c.ackMu.Unlock()
			if ack != nil {
				select {
				case ack <- payload:
				default:
				}
			}
		case strings.HasPrefix(frame, "41") || strings.HasPrefix(frame, "44"):
			c.reportError(errSocketClosed)
			c.Close()
			return
		}
	}
}

func (c *socketIOClient) reportError(err error) {
	select {
	case c.errors <- err:
	default:
	}
}

func decodeSocketEvent(value string) (socketEvent, error) {
	var tuple []json.RawMessage
	if err := json.Unmarshal([]byte(value), &tuple); err != nil || len(tuple) != 2 {
		return socketEvent{}, errSocketProtocol
	}
	var name string
	if err := json.Unmarshal(tuple[0], &name); err != nil || strings.TrimSpace(name) == "" {
		return socketEvent{}, errSocketProtocol
	}
	return socketEvent{name: name, payload: append(json.RawMessage(nil), tuple[1]...)}, nil
}

func decodeSocketAck(value string) (uint64, json.RawMessage, error) {
	index := strings.IndexByte(value, '[')
	if index <= 0 {
		return 0, nil, errSocketProtocol
	}
	id, err := strconv.ParseUint(value[:index], 10, 64)
	if err != nil || id == 0 {
		return 0, nil, errSocketProtocol
	}
	var tuple []json.RawMessage
	if err := json.Unmarshal([]byte(value[index:]), &tuple); err != nil || len(tuple) != 1 {
		return 0, nil, errSocketProtocol
	}
	return id, append(json.RawMessage(nil), tuple[0]...), nil
}
