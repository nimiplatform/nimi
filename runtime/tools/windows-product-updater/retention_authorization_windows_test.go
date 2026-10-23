//go:build windows

package main

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Microsoft/go-winio"
	"github.com/nimiplatform/nimi/runtime/internal/productrelease"
	"golang.org/x/sys/windows"
)

func TestRetentionAuthorizationPeerChild(t *testing.T) {
	pipe := os.Getenv("NIMI_RETENTION_PEER_TEST_PIPE")
	if pipe == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	connection, err := winio.DialPipeContext(ctx, pipe)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	_, _ = io.Copy(io.Discard, connection)
}

func TestRetentionAuthenticatesActualHelperImageTokenAndPID(t *testing.T) {
	root := t.TempDir()
	source, err := os.ReadFile(os.Args[0])
	if err != nil {
		t.Fatal(err)
	}
	childPath := filepath.Join(root, "NimiProductUpdater.exe")
	if err := os.WriteFile(childPath, source, 0700); err != nil {
		t.Fatal(err)
	}
	digest, err := productrelease.FileSHA256(childPath)
	if err != nil {
		t.Fatal(err)
	}
	identity := productrelease.Identity{Files: map[string]string{"NimiProductUpdater.exe": digest}}
	name := cleanupPipePrefix + strings.Repeat("d", 56) + time.Now().Format("15040500")
	listener, err := winio.ListenPipe(name, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	child := exec.Command(childPath, "-test.run=^TestRetentionAuthorizationPeerChild$")
	child.Env = append(os.Environ(), "NIMI_RETENTION_PEER_TEST_PIPE="+name)
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	defer child.Wait()
	connection, err := listener.Accept()
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	token, err := windows.OpenCurrentProcessToken()
	if err != nil {
		t.Fatal(err)
	}
	defer token.Close()
	user, err := token.GetTokenUser()
	if err != nil {
		t.Fatal(err)
	}
	if pid, err := cleanupPipePeerPID(connection, true); err != nil || pid != uint32(child.Process.Pid) {
		t.Fatalf("unexpected child %d %v", pid, err)
	}
	if err := verifyCleanupPipePeer(connection, true, token.IsElevated(), user.User.Sid.String(), identity, root); err != nil {
		t.Fatal(err)
	}
	if err := verifyCleanupPipePeer(connection, true, token.IsElevated(), "S-1-0-0", identity, root); err == nil {
		t.Fatal("wrong user accepted")
	}
	if err := verifyCleanupPipePeer(connection, true, !token.IsElevated(), "", identity, root); err == nil {
		t.Fatal("wrong elevation accepted")
	}
	identity.Files["NimiProductUpdater.exe"] = strings.Repeat("0", 64)
	if err := verifyCleanupPipePeer(connection, true, token.IsElevated(), "", identity, root); err == nil {
		t.Fatal("wrong executable bytes accepted")
	}
}

func TestCleanupAuthorizationUsesActualWindowsPipePeerAndRejectsForgedServer(t *testing.T) {
	name := cleanupPipePrefix + strings.Repeat("a", 32) + strings.Repeat("0", 24) + time.Now().Format("15040500")
	listener, err := winio.ListenPipe(name, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	accepted := make(chan net.Conn, 1)
	go func() {
		connection, err := listener.Accept()
		if err == nil {
			accepted <- connection
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	client, err := winio.DialPipeContext(ctx, name)
	if err != nil {
		t.Fatal(err)
	}
	server := <-accepted
	if pid, err := cleanupPipePeerPID(client, false); err != nil || pid != uint32(os.Getpid()) {
		t.Fatalf("server pid %d: %v", pid, err)
	}
	if pid, err := cleanupPipePeerPID(server, true); err != nil || pid != uint32(os.Getpid()) {
		t.Fatalf("client pid %d: %v", pid, err)
	}
	_ = client.Close()
	_ = server.Close()
	done := make(chan struct{})
	go func() {
		defer close(done)
		connection, err := listener.Accept()
		if err != nil {
			return
		}
		defer connection.Close()
		_ = connection.SetDeadline(time.Now().Add(5 * time.Second))
		_ = json.NewEncoder(connection).Encode(cleanupAuthorization{JobPath: "forged/job.json", RequestHash: strings.Repeat("b", 64)})
	}()
	proof, authorization, err := receiveCleanupAuthorization(name, strings.Repeat("b", 64), productrelease.Identity{}, t.TempDir())
	if authorization != nil {
		_ = authorization.Close()
	}
	if err == nil || proof.JobPath != "" {
		t.Fatalf("forged server minted authorization: %q %v", proof.JobPath, err)
	}
	<-done
}
