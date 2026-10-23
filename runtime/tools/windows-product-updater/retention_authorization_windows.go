//go:build windows

package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"path/filepath"
	"strings"
	"time"

	"github.com/Microsoft/go-winio"
	"github.com/nimiplatform/nimi/runtime/internal/productrelease"
	"golang.org/x/sys/windows"
)

const cleanupPipePrefix = `\\.\pipe\NimiProductCleanup-`

type cleanupAuthorization struct {
	JobPath     string `json:"jobPath"`
	RequestHash string `json:"requestHash"`
	CacheRoot   string `json:"cacheRoot"`
	UserSID     string `json:"-"`
}

type cleanupOutcome struct {
	raw []byte
	err error
}

func cleanupPipePeerPID(connection net.Conn, serverSide bool) (uint32, error) {
	handle, ok := connection.(interface{ Fd() uintptr })
	if !ok {
		return 0, fmt.Errorf("UPDATE_RETENTION_AUTHORIZATION_FAILED")
	}
	var pid uint32
	var err error
	if serverSide {
		err = windows.GetNamedPipeClientProcessId(windows.Handle(handle.Fd()), &pid)
	} else {
		err = windows.GetNamedPipeServerProcessId(windows.Handle(handle.Fd()), &pid)
	}
	if err != nil || pid == 0 {
		return 0, fmt.Errorf("UPDATE_RETENTION_AUTHORIZATION_FAILED")
	}
	return pid, nil
}

func verifyCleanupPipePeer(connection net.Conn, serverSide, elevatedPeer bool, userSID string, identity productrelease.Identity, root string) error {
	pid, err := cleanupPipePeerPID(connection, serverSide)
	if err != nil {
		return err
	}
	process, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(process)
	image, err := processPath(process)
	if err != nil || !strings.EqualFold(image, filepath.Join(root, "NimiProductUpdater.exe")) {
		return fmt.Errorf("UPDATE_RETENTION_AUTHORIZER_UNTRUSTED")
	}
	var token windows.Token
	if err := windows.OpenProcessToken(process, windows.TOKEN_QUERY, &token); err != nil {
		return err
	}
	defer token.Close()
	user, err := token.GetTokenUser()
	if err != nil || (userSID != "" && user.User.Sid.String() != userSID) || token.IsElevated() != elevatedPeer {
		return fmt.Errorf("UPDATE_RETENTION_AUTHORIZER_UNTRUSTED")
	}
	file, err := lockFile(image)
	if err != nil {
		return err
	}
	defer file.Close()
	digest, err := hashLocked(file)
	if err != nil || digest != identity.Files["NimiProductUpdater.exe"] {
		return fmt.Errorf("UPDATE_RETENTION_AUTHORIZER_UNTRUSTED")
	}
	return nil
}

// Only the ordinary helper that already authenticated Home/SID and captured
// the locked confirmed job can serve this one-shot authorization. Actual pipe
// peer PID/token/image binds elevation to that request; argv cannot mint it.
func startCleanupAuthorization(file, requestHash, userSID string, identity productrelease.Identity, root string) (string, <-chan cleanupOutcome, func(), error) {
	nonce := make([]byte, 32)
	if _, err := rand.Read(nonce); err != nil {
		return "", nil, nil, err
	}
	name := cleanupPipePrefix + hex.EncodeToString(nonce)
	listener, err := winio.ListenPipe(name, &winio.PipeConfig{
		SecurityDescriptor: "D:P(A;;GA;;;" + userSID + ")(A;;GA;;;SY)(A;;GA;;;BA)",
		InputBufferSize:    4096, OutputBufferSize: 4096,
	})
	if err != nil {
		return "", nil, nil, err
	}
	cache, err := fixedCache()
	if err != nil {
		_ = listener.Close()
		return "", nil, nil, err
	}
	outcome := make(chan cleanupOutcome, 1)
	go func() {
		for {
			connection, err := listener.Accept()
			if err != nil {
				return
			}
			// UAC may use another administrator's credentials. The original
			// user remains the authenticated ordinary helper's token owner.
			if err := verifyCleanupPipePeer(connection, true, true, "", identity, root); err != nil {
				_ = connection.Close()
				continue
			}
			_ = connection.SetDeadline(time.Now().Add(10 * time.Minute))
			if err := json.NewEncoder(connection).Encode(cleanupAuthorization{JobPath: file, RequestHash: requestHash, CacheRoot: cache}); err != nil {
				outcome <- cleanupOutcome{err: err}
				_ = connection.Close()
				return
			}
			raw, err := io.ReadAll(io.LimitReader(connection, 128*1024+1))
			if len(raw) > 128*1024 {
				err = fmt.Errorf("UPDATE_RETENTION_RESULT_UNAVAILABLE")
			}
			outcome <- cleanupOutcome{raw: raw, err: err}
			_ = connection.Close()
			return
		}
	}()
	return name, outcome, func() { _ = listener.Close() }, nil
}

func receiveCleanupAuthorization(pipe, requestHash string, identity productrelease.Identity, root string) (cleanupAuthorization, net.Conn, error) {
	empty := cleanupAuthorization{}
	if !strings.HasPrefix(pipe, cleanupPipePrefix) || len(strings.TrimPrefix(pipe, cleanupPipePrefix)) != 64 {
		return empty, nil, fmt.Errorf("UPDATE_RETENTION_AUTHORIZATION_FAILED")
	}
	if _, err := hex.DecodeString(strings.TrimPrefix(pipe, cleanupPipePrefix)); err != nil {
		return empty, nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	connection, err := winio.DialPipeContext(ctx, pipe)
	if err != nil {
		return empty, nil, err
	}
	fail := func(err error) (cleanupAuthorization, net.Conn, error) {
		_ = connection.Close()
		return empty, nil, err
	}
	if err := verifyCleanupPipePeer(connection, false, false, "", identity, root); err != nil {
		return fail(err)
	}
	pid, err := cleanupPipePeerPID(connection, false)
	if err != nil {
		return fail(err)
	}
	process, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return fail(err)
	}
	defer windows.CloseHandle(process)
	var token windows.Token
	if err := windows.OpenProcessToken(process, windows.TOKEN_QUERY, &token); err != nil {
		return fail(err)
	}
	defer token.Close()
	user, err := token.GetTokenUser()
	if err != nil {
		return fail(err)
	}
	_ = connection.SetReadDeadline(time.Now().Add(15 * time.Second))
	var authorization cleanupAuthorization
	decoder := json.NewDecoder(io.LimitReader(connection, 128*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&authorization); err != nil {
		return fail(err)
	}
	if authorization.RequestHash != requestHash || authorization.JobPath == "" || !filepath.IsAbs(authorization.CacheRoot) {
		return fail(fmt.Errorf("UPDATE_RETENTION_AUTHORIZATION_FAILED"))
	}
	_ = connection.SetDeadline(time.Time{})
	authorization.UserSID = user.User.Sid.String()
	return authorization, connection, nil
}
