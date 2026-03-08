package workerproxy

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"strings"
	"sync"

	"github.com/nimiplatform/nimi/runtime/internal/workeripc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// ConnPool manages reusable gRPC client connections to worker sockets.
type ConnPool struct {
	logger *slog.Logger

	mu    sync.Mutex
	conns map[string]*grpc.ClientConn
}

func NewConnPool(logger *slog.Logger) *ConnPool {
	return &ConnPool{
		logger: logger,
		conns:  make(map[string]*grpc.ClientConn),
	}
}

func (p *ConnPool) Conn(role string) (*grpc.ClientConn, error) {
	normalized := normalizeRole(role)
	if normalized == "" {
		return nil, fmt.Errorf("unsupported worker role %q", role)
	}
	role = normalized

	p.mu.Lock()
	defer p.mu.Unlock()

	if conn, ok := p.conns[role]; ok {
		return conn, nil
	}

	socketPath, err := workeripc.SocketPath(role)
	if err != nil {
		return nil, err
	}
	dialer := net.Dialer{}
	conn, err := grpc.NewClient(
		"passthrough:///nimi-runtime-worker-"+role,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
			return dialer.DialContext(ctx, "unix", socketPath)
		}),
	)
	if err != nil {
		return nil, fmt.Errorf("dial worker role=%s socket=%s: %w", role, socketPath, err)
	}
	p.conns[role] = conn
	if p.logger != nil {
		p.logger.Info("worker proxy connected", "role", role, "socket", socketPath)
	}
	return conn, nil
}

func (p *ConnPool) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	var firstErr error
	for role, conn := range p.conns {
		if err := conn.Close(); err != nil && firstErr == nil {
			firstErr = fmt.Errorf("close worker conn role=%s: %w", role, err)
		}
		delete(p.conns, role)
	}
	return firstErr
}

func normalizeRole(role string) string {
	switch strings.TrimSpace(strings.ToLower(role)) {
	case "ai":
		return "ai"
	case "model":
		return "model"
	case "workflow":
		return "workflow"
	case "script":
		return "script"
	case "local":
		return "local"
	default:
		return ""
	}
}
