//go:build windows

package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/Microsoft/go-winio"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"golang.org/x/sys/windows"
)

const (
	http2FrameSettings      = 0x4
	http2ConnectionStreamID = 0
	maxHTTP2FramePayload    = 16 * 1024
)

var http2ClientPrefaceAndSettings = []byte(
	"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n" +
		"\x00\x00\x00" + // zero-length payload
		"\x04" + // SETTINGS
		"\x00" + // no flags
		"\x00\x00\x00\x00", // connection stream
)

type probeResult struct {
	Status           string `json:"status"`
	Pipe             string `json:"pipe"`
	ServerVerified   bool   `json:"serverVerified"`
	ServerProcessID  uint32 `json:"serverProcessId"`
	ServerTrustSetID string `json:"serverTrustSetId"`
	ServerSettings   bool   `json:"serverSettings"`
	ClientElevated   bool   `json:"clientElevated"`
}

func main() {
	pipeName := flag.String("pipe", "", "fixed local Windows protected pipe")
	timeout := flag.Duration("timeout", 10*time.Second, "bounded probe timeout")
	flag.Parse()
	if !strings.HasPrefix(*pipeName, `\\.\pipe\`) || *timeout <= 0 {
		fail(fmt.Errorf("a fixed local pipe and positive timeout are required"))
	}
	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	access := uint32((windows.FILE_GENERIC_READ | windows.FILE_GENERIC_WRITE) &^ windows.FILE_APPEND_DATA)
	connection, err := winio.DialPipeAccess(ctx, *pipeName, access)
	if err != nil {
		fail(fmt.Errorf("connect protected pipe: %w", err))
	}
	defer connection.Close()
	handleProvider, ok := connection.(interface{ Fd() uintptr })
	if !ok || handleProvider.Fd() == 0 {
		fail(fmt.Errorf("connected pipe does not expose its exact native handle"))
	}
	verifier, err := protectedlocal.NewWindowsNativeExecutableTrustVerifier()
	if err != nil {
		fail(fmt.Errorf("create Runtime native verifier: %w", err))
	}
	server, err := protectedlocal.VerifyWindowsProductionPipeServer(ctx, handleProvider.Fd(), verifier)
	if err != nil {
		if code, present := protectedlocal.WindowsPrincipalStartupExitCode(err); present {
			fail(fmt.Errorf("verify Runtime native server: windows_principal:%d", code))
		}
		if code, present := protectedlocal.WindowsProcessTrustStartupExitCode(err); present {
			fail(fmt.Errorf("verify Runtime native server: windows_process_trust:%d", code))
		}
		fail(fmt.Errorf("verify Runtime native server: %w", err))
	}
	serverTuple := server.ProcessTuple()
	if err := connection.SetDeadline(time.Now().Add(*timeout)); err != nil {
		fail(fmt.Errorf("set protected pipe deadline: %w", err))
	}
	if _, err := connection.Write(http2ClientPrefaceAndSettings); err != nil {
		fail(fmt.Errorf("write HTTP/2 client preface: %w", err))
	}
	serverSettings := false
	for frames := 0; frames < 8; frames++ {
		header := make([]byte, 9)
		if _, err := io.ReadFull(connection, header); err != nil {
			fail(fmt.Errorf("read verified Runtime HTTP/2 frame: %w", err))
		}
		length := int(header[0])<<16 | int(header[1])<<8 | int(header[2])
		streamID := binary.BigEndian.Uint32(header[5:9]) & 0x7fffffff
		if length < 0 || length > maxHTTP2FramePayload {
			fail(fmt.Errorf("Runtime returned an invalid HTTP/2 frame length"))
		}
		if length > 0 {
			payload := make([]byte, length)
			if _, err := io.ReadFull(connection, payload); err != nil {
				fail(fmt.Errorf("read verified Runtime HTTP/2 payload: %w", err))
			}
		}
		if header[3] == http2FrameSettings && streamID == http2ConnectionStreamID {
			serverSettings = true
			break
		}
	}
	if !serverSettings {
		fail(fmt.Errorf("verified Runtime did not return HTTP/2 SETTINGS"))
	}
	if err := json.NewEncoder(os.Stdout).Encode(probeResult{
		Status:           "connected",
		Pipe:             *pipeName,
		ServerVerified:   true,
		ServerProcessID:  serverTuple.PID,
		ServerTrustSetID: serverTuple.ExecutableTrustSetID,
		ServerSettings:   true,
		ClientElevated:   windows.GetCurrentProcessToken().IsElevated(),
	}); err != nil {
		fail(fmt.Errorf("encode probe result: %w", err))
	}
}

func fail(err error) {
	_, _ = fmt.Fprintf(os.Stderr, "windows protected peer probe failed: %v\n", err)
	os.Exit(1)
}
