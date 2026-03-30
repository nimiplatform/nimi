package localservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func (s *Service) updateTransferProgress(
	sessionID string,
	phase string,
	bytesReceived int64,
	bytesTotal int64,
	message string,
) {
	_ = s.mutateLocalTransfer(sessionID, false, func(summary *runtimev1.LocalTransferSessionSummary) {
		summary.Phase = phase
		summary.State = localTransferStateRunning
		summary.BytesReceived = maxInt64(bytesReceived, 0)
		if bytesTotal > 0 {
			summary.BytesTotal = maxInt64(bytesTotal, 0)
		}
		if strings.TrimSpace(message) != "" {
			summary.Message = message
		}
		if createdAt, err := time.Parse(time.RFC3339Nano, summary.GetCreatedAt()); err == nil {
			elapsed := time.Since(createdAt)
			if elapsed > 0 && summary.GetBytesReceived() > 0 {
				speed := int64(float64(summary.GetBytesReceived()) / elapsed.Seconds())
				summary.SpeedBytesPerSec = maxInt64(speed, 0)
				if summary.GetBytesTotal() > 0 && speed > 0 && summary.GetBytesReceived() < summary.GetBytesTotal() {
					summary.EtaSeconds = maxInt64((summary.GetBytesTotal()-summary.GetBytesReceived())/speed, 0)
				}
			}
		}
	})
}

func (s *Service) completeTransfer(
	sessionID string,
	phase string,
	message string,
	apply func(summary *runtimev1.LocalTransferSessionSummary),
) {
	_ = s.mutateLocalTransfer(sessionID, true, func(summary *runtimev1.LocalTransferSessionSummary) {
		summary.Phase = phase
		summary.State = localTransferStateCompleted
		summary.Message = message
		summary.ReasonCode = ""
		summary.Retryable = false
		if summary.GetBytesTotal() > 0 && summary.GetBytesReceived() < summary.GetBytesTotal() {
			summary.BytesReceived = summary.GetBytesTotal()
		}
		if apply != nil {
			apply(summary)
		}
	})
}

func (s *Service) failTransfer(sessionID string, message string, retryable bool) {
	_ = s.mutateLocalTransfer(sessionID, true, func(summary *runtimev1.LocalTransferSessionSummary) {
		if isTerminalTransferState(summary.GetState()) {
			return
		}
		summary.State = localTransferStateFailed
		summary.Message = message
		summary.ReasonCode = "LOCAL_TRANSFER_FAILED"
		summary.Retryable = retryable
	})
}

func (s *Service) cancelTransfer(sessionID string, message string) {
	_ = s.mutateLocalTransfer(sessionID, true, func(summary *runtimev1.LocalTransferSessionSummary) {
		summary.State = localTransferStateCancelled
		summary.Message = message
		summary.ReasonCode = "LOCAL_TRANSFER_CANCELLED"
		summary.Retryable = false
	})
}

func (s *Service) downloadToFileWithTransfer(
	ctx context.Context,
	sessionID string,
	phase string,
	body io.Reader,
	targetPath string,
	maxBodyBytes int64,
) (string, int64, error) {
	tempPath := targetPath + ".download"
	if err := os.RemoveAll(tempPath); err != nil {
		return "", 0, err
	}
	file, err := os.OpenFile(tempPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return "", 0, err
	}
	hasher := sha256.New()
	written, copyErr := s.copyReaderWithTransfer(ctx, sessionID, phase, io.MultiWriter(file, hasher), body, maxBodyBytes)
	closeErr := file.Close()
	if copyErr != nil {
		_ = os.Remove(tempPath)
		return "", written, copyErr
	}
	if closeErr != nil {
		_ = os.Remove(tempPath)
		return "", written, closeErr
	}
	if err := os.Rename(tempPath, targetPath); err != nil {
		_ = os.Remove(tempPath)
		return "", written, err
	}
	return hex.EncodeToString(hasher.Sum(nil)), written, nil
}

func (s *Service) copyReaderWithTransfer(
	ctx context.Context,
	sessionID string,
	phase string,
	dst io.Writer,
	src io.Reader,
	maxBodyBytes int64,
) (int64, error) {
	control := s.transferControl(sessionID)
	buffer := make([]byte, 128*1024)
	var written int64
	for {
		if control != nil {
			if err := control.wait(ctx); err != nil {
				return written, err
			}
		}
		n, readErr := src.Read(buffer)
		if n > 0 {
			if maxBodyBytes > 0 && written+int64(n) > maxBodyBytes {
				return written, fmt.Errorf("response body exceeds %d bytes", maxBodyBytes)
			}
			if _, err := dst.Write(buffer[:n]); err != nil {
				return written, err
			}
			written += int64(n)
			s.updateTransferProgress(sessionID, phase, written, 0, "")
		}
		if readErr == nil {
			continue
		}
		if readErr == io.EOF {
			return written, nil
		}
		return written, readErr
	}
}
