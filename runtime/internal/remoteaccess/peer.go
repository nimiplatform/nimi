package remoteaccess

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/pion/webrtc/v4"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

const channelLabel = "nimi-runtime-v1"
const channelProtocol = "nimi-runtime-protobuf-v1"
const chunkBytes = 16 << 10
const maxMessageBytes = 33 << 20 // Existing 32 MiB inline content plus envelope allowance.
const maxActiveCalls = 16

type PeerInfo struct {
	Scope              localappkernel.RemoteAccessScope
	ContextID          string
	AccountGeneration  uint64
	AccountInvalidated <-chan struct{}
	Registration       localappkernel.Registration
	Source             localappkernel.RemoteSource
	SessionID          protectedlocal.Identifier
	RuntimeInstanceID  protectedlocal.Identifier
	Deadline           time.Time
}

type Call struct {
	Method         string
	Payload        []byte
	RequestID      uint32
	TimeoutMS      uint32
	TraceID        string
	IdempotencyKey string
	// Input receives subsequent method messages; Payload is the first.
	Input func(context.Context) ([]byte, error)
}
type Dispatcher func(context.Context, *Peer, Call, func([]byte) error) (payload []byte, stream bool, err error)

type incomingCall struct {
	call         Call
	payload      []byte
	clientStream bool
}

// Peer carries an already-confirmed source. Its public protobuf frames cannot
// supply or replace the in-process identity or operation authorization.
type Peer struct {
	ctx         context.Context
	cancel      context.CancelFunc
	pc          *webrtc.PeerConnection
	dispatch    Dispatcher
	mu          sync.Mutex
	info        PeerInfo
	dc          *webrtc.DataChannel
	ready       bool
	closed      bool
	lastRequest uint32
	assembling  *incomingCall
	calls       map[uint32]context.CancelFunc
	inputs      map[uint32]*inputStream
	sendMu      sync.Mutex
	bufferLow   chan struct{}
	closeOnce   sync.Once
}

// @nimi-authority: rule.nimi.runtime.remote-access.direct-transport
func newPeer(ctx context.Context, negotiation context.Context, api *webrtc.API, info PeerInfo, offer string, stunURLs []string, dispatch Dispatcher) (*Peer, string, error) {
	if dispatch == nil || !accountservice.PrimaryRuntimeDeadlineLive(info.Deadline) || relayCandidate(offer) {
		return nil, "", errors.New("direct connection unavailable")
	}
	for _, target := range stunURLs {
		if !stunURL(target) {
			return nil, "", errors.New("only STUN candidate discovery is admitted")
		}
	}
	configuration := webrtc.Configuration{}
	if len(stunURLs) > 0 {
		configuration.ICEServers = []webrtc.ICEServer{{URLs: append([]string(nil), stunURLs...)}}
	}
	pc, err := api.NewPeerConnection(configuration)
	if err != nil {
		return nil, "", fmt.Errorf("create direct peer: %w", err)
	}
	peerCtx, cancel := context.WithCancel(ctx)
	p := &Peer{ctx: peerCtx, cancel: cancel, pc: pc, info: info, dispatch: dispatch, calls: make(map[uint32]context.CancelFunc), bufferLow: make(chan struct{}, 1)}
	if _, err = rand.Read(p.info.SessionID[:]); err != nil {
		p.Close()
		return nil, "", fmt.Errorf("create peer correlation: %w", err)
	}
	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		if state == webrtc.PeerConnectionStateFailed || state == webrtc.PeerConnectionStateDisconnected || state == webrtc.PeerConnectionStateClosed {
			go p.Close()
		}
	})
	pc.OnDataChannel(func(channel *webrtc.DataChannel) {
		if channel.Label() != channelLabel || channel.Protocol() != channelProtocol || !channel.Ordered() || channel.MaxRetransmits() != nil || channel.MaxPacketLifeTime() != nil {
			go p.Close()
			return
		}
		p.mu.Lock()
		if p.closed || p.dc != nil {
			p.mu.Unlock()
			go p.Close()
			return
		}
		p.dc = channel
		p.mu.Unlock()
		channel.SetBufferedAmountLowThreshold(256 << 10)
		channel.OnBufferedAmountLow(func() {
			select {
			case p.bufferLow <- struct{}{}:
			default:
			}
		})
		channel.OnOpen(func() {
			pair, pairErr := pc.SCTP().Transport().ICETransport().GetSelectedCandidatePair()
			if pairErr != nil || pair == nil || pair.Local.Typ == webrtc.ICECandidateTypeRelay || pair.Remote.Typ == webrtc.ICECandidateTypeRelay {
				go p.Close()
				return
			}
			p.mu.Lock()
			p.ready = !p.closed
			p.mu.Unlock()
		})
		channel.OnClose(func() { go p.Close() })
		channel.OnError(func(error) { go p.Close() })
		channel.OnMessage(func(message webrtc.DataChannelMessage) {
			if message.IsString || len(message.Data) > chunkBytes+8192 || !p.Live() {
				go p.Close()
				return
			}
			frame := &runtimev1.RemoteTransportFrame{}
			if proto.Unmarshal(message.Data, frame) != nil || len(frame.ProtoReflect().GetUnknown()) != 0 || p.receive(frame) != nil {
				go p.Close()
			}
		})
	})
	if err = pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: offer}); err != nil {
		p.Close()
		return nil, "", fmt.Errorf("read direct offer: %w", err)
	}
	answer, err := pc.CreateAnswer(nil)
	if err != nil {
		p.Close()
		return nil, "", fmt.Errorf("create direct answer: %w", err)
	}
	gathered := webrtc.GatheringCompletePromise(pc)
	if err = pc.SetLocalDescription(answer); err != nil {
		p.Close()
		return nil, "", fmt.Errorf("set direct answer: %w", err)
	}
	select {
	case <-gathered:
	case <-negotiation.Done():
		p.Close()
		return nil, "", negotiation.Err()
	case <-ctx.Done():
		p.Close()
		return nil, "", ctx.Err()
	case <-time.After(12 * time.Second):
		p.Close()
		return nil, "", errors.New("direct candidate discovery timed out")
	}
	local := pc.LocalDescription()
	if local == nil || len(local.SDP) > 32768 || relayCandidate(local.SDP) {
		p.Close()
		return nil, "", errors.New("direct answer unavailable")
	}
	go p.watchLifetime()
	return p, local.SDP, nil
}

func (p *Peer) Snapshot() (PeerInfo, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed || p.ctx.Err() != nil || !accountservice.PrimaryRuntimeDeadlineLive(p.info.Deadline) {
		return PeerInfo{}, false
	}
	select {
	case <-p.info.AccountInvalidated:
		return PeerInfo{}, false
	default:
	}
	return p.info, true
}
func (p *Peer) Live() bool            { _, live := p.Snapshot(); return live }
func (p *Peer) Done() <-chan struct{} { return p.ctx.Done() }

// @nimi-authority: rule.nimi.runtime.remote-access.source-admission
// Commit serializes a short owner publication with direct-peer closure. The callback
// must not reenter the peer or perform network IO; business ownership remains
// with the admitted operation's existing owner.
func (p *Peer) Commit(ctx context.Context, sessionID protectedlocal.Identifier, commit func() error) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if commit == nil || p.closed || p.ctx.Err() != nil || p.info.SessionID != sessionID || !accountservice.PrimaryRuntimeDeadlineLive(p.info.Deadline) {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	select {
	case <-p.info.AccountInvalidated:
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	default:
	}
	return commit()
}

func (p *Peer) Ready() bool { p.mu.Lock(); ready := p.ready; p.mu.Unlock(); return ready && p.Live() }
func (p *Peer) renew(deadline time.Time) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.closed && accountservice.PrimaryRuntimeDeadlineLive(p.info.Deadline) {
		p.info.Deadline = deadline
	}
}
func (p *Peer) watchLifetime() {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-p.ctx.Done():
			p.Close()
			return
		case <-p.info.AccountInvalidated:
			p.Close()
			return
		case <-ticker.C:
			if !p.Live() {
				p.Close()
				return
			}
		}
	}
}
// @nimi-authority: rule.nimi.runtime.remote-access.connection-lifetime
func (p *Peer) Close() {
	p.closeOnce.Do(func() {
		p.mu.Lock()
		p.closed = true
		p.ready = false
		p.assembling = nil
		for _, cancel := range p.calls {
			cancel()
		}
		p.calls = make(map[uint32]context.CancelFunc)
		for _, input := range p.inputs {
			input.finish()
		}
		p.inputs = nil
		p.mu.Unlock()
		p.cancel()
		_ = p.pc.Close()
	})
}

func (p *Peer) receive(frame *runtimev1.RemoteTransportFrame) error {
	if frame.RequestId == 0 || len(frame.Payload) > chunkBytes || frame.GrpcCode != 0 || frame.ErrorInfo != nil || frame.Message != "" || frame.InputCredits != 0 {
		return errors.New("invalid direct frame")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return errors.New("peer closed")
	}
	if frame.Kind == runtimev1.RemoteTransportFrameKind_REMOTE_TRANSPORT_FRAME_KIND_CANCEL {
		if frame.RequestId > p.lastRequest || !frame.ChunkEnd || frame.Method != "" || len(frame.Payload) != 0 || frame.TimeoutMs != 0 || frame.TraceId != "" || frame.IdempotencyKey != "" {
			return errors.New("invalid cancellation")
		}
		if p.assembling != nil && p.assembling.call.RequestID == frame.RequestId {
			p.assembling = nil
		}
		if cancel := p.calls[frame.RequestId]; cancel != nil {
			cancel()
		}
		if input := p.inputs[frame.RequestId]; input != nil {
			input.finish()
			delete(p.inputs, frame.RequestId)
		}
		return nil
	}
	if frame.Kind == runtimev1.RemoteTransportFrameKind_REMOTE_TRANSPORT_FRAME_KIND_CLIENT_STREAM_DATA || frame.Kind == runtimev1.RemoteTransportFrameKind_REMOTE_TRANSPORT_FRAME_KIND_CLIENT_STREAM_END {
		if frame.Method != "" || frame.TimeoutMs != 0 || frame.TraceId != "" || frame.IdempotencyKey != "" {
			return errors.New("invalid upload control")
		}
		input := p.inputs[frame.RequestId]
		if input == nil {
			return errors.New("unknown upload input")
		}
		if frame.Kind == runtimev1.RemoteTransportFrameKind_REMOTE_TRANSPORT_FRAME_KIND_CLIENT_STREAM_DATA {
			return input.accept(frame.Payload, frame.ChunkEnd)
		}
		if !frame.ChunkEnd || len(frame.Payload) != 0 {
			return errors.New("invalid upload end")
		}
		finished, err := input.end()
		if finished {
			delete(p.inputs, frame.RequestId)
		}
		return err
	}
	clientStream := frame.Kind == runtimev1.RemoteTransportFrameKind_REMOTE_TRANSPORT_FRAME_KIND_CLIENT_STREAM_OPEN
	if !clientStream && frame.Kind != runtimev1.RemoteTransportFrameKind_REMOTE_TRANSPORT_FRAME_KIND_REQUEST {
		return errors.New("client frame kind unavailable")
	}
	slots := len(p.calls)
	for id := range p.inputs {
		if _, active := p.calls[id]; !active {
			slots++
		}
	}
	if p.assembling == nil {
		if frame.RequestId <= p.lastRequest || frame.Method == "" || len(frame.Method) > 256 || len(frame.TraceId) > 128 || len(frame.IdempotencyKey) > 128 || slots >= maxActiveCalls || frame.TimeoutMs > 0x7fffffff {
			return errors.New("invalid or repeated direct request")
		}
		p.lastRequest = frame.RequestId
		p.assembling = &incomingCall{clientStream: clientStream, call: Call{Method: frame.Method, RequestID: frame.RequestId, TimeoutMS: frame.TimeoutMs, TraceID: frame.TraceId, IdempotencyKey: frame.IdempotencyKey}}
	} else if p.assembling.clientStream != clientStream || p.assembling.call.RequestID != frame.RequestId || frame.Method != "" || frame.TraceId != "" || frame.TimeoutMs != 0 || frame.IdempotencyKey != "" {
		return errors.New("non-contiguous request fragments")
	}
	limit := maxMessageBytes
	if clientStream {
		limit = maxInputMessageBytes
	}
	if len(p.assembling.payload)+len(frame.Payload) > limit {
		return errors.New("direct request too large")
	}
	p.assembling.payload = append(p.assembling.payload, frame.Payload...)
	if !frame.ChunkEnd {
		return nil
	}
	call := p.assembling.call
	call.Payload = p.assembling.payload
	p.assembling = nil
	ctx, cancel := context.WithCancel(p.ctx)
	if call.TimeoutMS != 0 {
		cancel()
		ctx, cancel = context.WithTimeout(p.ctx, time.Duration(call.TimeoutMS)*time.Millisecond)
	}
	if clientStream {
		input := newInputStream(func(ctx context.Context, credits uint32) error {
			return p.sendInputCredit(ctx, call.RequestID, credits)
		})
		if p.inputs == nil {
			p.inputs = make(map[uint32]*inputStream)
		}
		p.inputs[call.RequestID] = input
		call.Input = input.receive
	}
	p.calls[call.RequestID] = cancel
	go p.execute(ctx, cancel, call)
	return nil
}

func (p *Peer) execute(ctx context.Context, cancel context.CancelFunc, call Call) {
	defer func() {
		cancel()
		p.mu.Lock()
		defer p.mu.Unlock()
		delete(p.calls, call.RequestID)
		if input := p.inputs[call.RequestID]; input != nil && input.finish() {
			delete(p.inputs, call.RequestID)
		}
	}()
	if !p.Live() {
		return
	}
	payload, stream, err := p.dispatch(ctx, p, call, func(payload []byte) error {
		return p.sendPayload(ctx, runtimev1.RemoteTransportFrameKind_REMOTE_TRANSPORT_FRAME_KIND_STREAM_DATA, call.RequestID, payload)
	})
	if err != nil {
		p.sendError(call.RequestID, err)
		return
	}
	if stream {
		p.sendMu.Lock()
		_ = p.sendFrame(ctx, &runtimev1.RemoteTransportFrame{Kind: runtimev1.RemoteTransportFrameKind_REMOTE_TRANSPORT_FRAME_KIND_STREAM_END, RequestId: call.RequestID, ChunkEnd: true})
		p.sendMu.Unlock()
	} else {
		if err := p.sendPayload(ctx, runtimev1.RemoteTransportFrameKind_REMOTE_TRANSPORT_FRAME_KIND_RESPONSE, call.RequestID, payload); err != nil {
			p.sendError(call.RequestID, err)
		}
	}
}

func (p *Peer) sendInputCredit(ctx context.Context, id, credits uint32) error {
	p.sendMu.Lock()
	defer p.sendMu.Unlock()
	return p.sendFrame(ctx, &runtimev1.RemoteTransportFrame{Kind: runtimev1.RemoteTransportFrameKind_REMOTE_TRANSPORT_FRAME_KIND_CLIENT_STREAM_CREDIT, RequestId: id, ChunkEnd: true, InputCredits: credits})
}

func (p *Peer) sendError(id uint32, err error) {
	frame := remoteErrorFrame(id, err)
	p.sendMu.Lock()
	sendErr := p.sendFrame(p.ctx, frame)
	p.sendMu.Unlock()
	if sendErr != nil {
		go p.Close()
	}
}

// @nimi-authority: rule.nimi.runtime.remote-access.direct-transport
func remoteErrorFrame(id uint32, err error) *runtimev1.RemoteTransportFrame {
	state := status.Convert(err)
	frame := &runtimev1.RemoteTransportFrame{Kind: runtimev1.RemoteTransportFrameKind_REMOTE_TRANSPORT_FRAME_KIND_ERROR, RequestId: id, GrpcCode: uint32(state.Code()), Message: state.Message(), ChunkEnd: true}
	if frame.GrpcCode == uint32(codes.OK) {
		frame.GrpcCode = uint32(codes.Unknown)
	}
	// grpcerr attaches google.rpc.ErrorInfo. The direct wire uses Runtime's
	// typed ErrorInfo projection; it is not the gRPC detail message itself.
	if reason, ok := grpcerr.ExtractReasonCode(err); ok {
		metadata, _ := grpcerr.ExtractReasonMetadata(err)
		message, explicit := grpcerr.ExtractPublicMessage(err)
		if !explicit {
			message = reason.String()
		}
		frame.ErrorInfo = &runtimev1.ErrorInfo{ReasonCode: reason, ActionHint: metadata["action_hint"], Message: message}
		frame.Message = message
	}
	return frame
}

func (p *Peer) sendPayload(ctx context.Context, kind runtimev1.RemoteTransportFrameKind, id uint32, payload []byte) error {
	if len(payload) > maxMessageBytes {
		return status.Error(codes.ResourceExhausted, "direct response too large")
	}
	p.sendMu.Lock()
	defer p.sendMu.Unlock()
	for offset := 0; ; {
		end := min(offset+chunkBytes, len(payload))
		if err := p.sendFrame(ctx, &runtimev1.RemoteTransportFrame{Kind: kind, RequestId: id, Payload: payload[offset:end], ChunkEnd: end == len(payload)}); err != nil {
			return err
		}
		if end == len(payload) {
			return nil
		}
		offset = end
	}
}
func (p *Peer) sendFrame(ctx context.Context, frame *runtimev1.RemoteTransportFrame) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !p.Live() {
		return context.Canceled
	}
	p.mu.Lock()
	channel := p.dc
	p.mu.Unlock()
	if channel == nil || channel.ReadyState() != webrtc.DataChannelStateOpen {
		return errors.New("direct channel unavailable")
	}
	for channel.BufferedAmount() > 1<<20 {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-p.ctx.Done():
			return p.ctx.Err()
		case <-p.bufferLow:
		}
	}
	data, err := proto.Marshal(frame)
	if err != nil || len(data) > chunkBytes+8192 {
		return errors.New("invalid direct response frame")
	}
	return channel.Send(data)
}

func relayCandidate(sdp string) bool {
	for _, line := range strings.Split(sdp, "\n") {
		if strings.HasPrefix(line, "a=candidate:") {
			parts := strings.Fields(line)
			for i := 0; i+1 < len(parts); i++ {
				if parts[i] == "typ" && parts[i+1] == "relay" {
					return true
				}
			}
		}
	}
	return false
}
func stunURL(value string) bool {
	var host string
	if strings.HasPrefix(value, "stun:") {
		host = strings.TrimPrefix(value, "stun:")
	} else if strings.HasPrefix(value, "stuns:") {
		host = strings.TrimPrefix(value, "stuns:")
	} else {
		return false
	}
	if strings.ContainsAny(host, "/?#") {
		return false
	}
	parsed, err := url.Parse("https://" + host)
	return err == nil && parsed.Hostname() != "" && parsed.User == nil && parsed.Port() != "0"
}
