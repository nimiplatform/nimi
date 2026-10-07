package nimillm

import (
	"archive/zip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
)

// This is the Runtime's portable archive metadata, never a provider response.
// File axes and physical calibration are independent. Unknown physical facts
// remain absent on an explicitly uncalibrated result.
type portableWorldArchiveMetadata struct {
	WorldID               string   `json:"worldId"`
	DisplayName           string   `json:"displayName"`
	Caption               string   `json:"caption,omitempty"`
	SplatCoordinateSystem string   `json:"splatCoordinateSystem"`
	CalibrationState      string   `json:"calibrationState,omitempty"`
	MetricScaleFactor     *float64 `json:"metricScaleFactor,omitempty"`
	GroundPlaneOffset     *float64 `json:"groundPlaneOffset,omitempty"`
	SplatResolution       string   `json:"splatResolution,omitempty"`
	SplatPath             string   `json:"splatPath"`
	ColliderPath          string   `json:"colliderPath,omitempty"`
	PanoramaPath          string   `json:"panoramaPath,omitempty"`
	PanoramaMimeType      string   `json:"panoramaMimeType,omitempty"`
	ThumbnailPath         string   `json:"thumbnailPath,omitempty"`
	ThumbnailMimeType     string   `json:"thumbnailMimeType,omitempty"`
}

type worldArchiveAsset struct {
	Name string
	Open func(context.Context) (io.ReadCloser, error)
}

// @nimi-authority: rule.nimi.sdks.feature-clients.r102
// Assets are copied directly to the ZIP stream. Closing the consumer also
// cancels its current asset request; download or ZIP failures reach custody as
// stream errors, so a partial archive cannot become a successful artifact.
func streamWorldArchive(ctx context.Context, metadata portableWorldArchiveMetadata, assets []worldArchiveAsset) (io.ReadCloser, error) {
	if metadata.WorldID == "" || (metadata.SplatCoordinateSystem != "opencv" && metadata.SplatCoordinateSystem != "spz-rub") || metadata.SplatPath != "world.spz" {
		return nil, fmt.Errorf("portable world spatial metadata is unavailable or invalid")
	}
	switch metadata.CalibrationState {
	case "uncalibrated":
		if metadata.MetricScaleFactor != nil || metadata.GroundPlaneOffset != nil {
			return nil, fmt.Errorf("uncalibrated world cannot claim metric scale or ground")
		}
	case "", "calibrated":
		if metadata.MetricScaleFactor == nil || metadata.GroundPlaneOffset == nil || *metadata.MetricScaleFactor <= 0 ||
			math.IsNaN(*metadata.MetricScaleFactor) || math.IsInf(*metadata.MetricScaleFactor, 0) || math.IsNaN(*metadata.GroundPlaneOffset) || math.IsInf(*metadata.GroundPlaneOffset, 0) {
			return nil, fmt.Errorf("calibrated world requires complete metric scale and ground")
		}
	default:
		return nil, fmt.Errorf("portable world calibration state is invalid")
	}
	names := map[string]bool{}
	for _, asset := range assets {
		if asset.Open == nil || names[asset.Name] || (asset.Name != "world.spz" && asset.Name != "collider.glb" && asset.Name != "panorama.image" && asset.Name != "thumbnail.image") {
			return nil, fmt.Errorf("portable world asset entry is invalid")
		}
		names[asset.Name] = true
	}
	if !names[metadata.SplatPath] || (metadata.ColliderPath != "" && (metadata.ColliderPath != "collider.glb" || !names[metadata.ColliderPath])) ||
		(metadata.PanoramaPath != "" && (metadata.PanoramaPath != "panorama.image" || !names[metadata.PanoramaPath])) ||
		(metadata.ThumbnailPath != "" && (metadata.ThumbnailPath != "thumbnail.image" || !names[metadata.ThumbnailPath])) {
		return nil, fmt.Errorf("portable world asset reference is unavailable")
	}
	raw, err := json.Marshal(metadata)
	if err != nil {
		return nil, fmt.Errorf("encode portable world metadata: %w", err)
	}
	ctx, cancel := context.WithCancel(ctx)
	reader, writer := io.Pipe()
	go func() {
		defer cancel()
		_ = writer.CloseWithError(writeWorldArchiveStream(ctx, writer, raw, assets))
	}()
	return &boundedMediaArtifactStream{ReadCloser: &worldArchiveReadCloser{PipeReader: reader, cancel: cancel}, remaining: maxStreamedMediaArtifactBytes + 1}, nil
}

type worldArchiveReadCloser struct {
	*io.PipeReader
	cancel context.CancelFunc
}

func (reader *worldArchiveReadCloser) Close() error {
	reader.cancel()
	return reader.PipeReader.Close()
}

func writeWorldArchiveStream(ctx context.Context, target io.Writer, metadata []byte, assets []worldArchiveAsset) error {
	writer := zip.NewWriter(target)
	entry, err := writer.CreateHeader(&zip.FileHeader{Name: "world.json", Method: zip.Store})
	if err != nil {
		return fmt.Errorf("create portable world metadata entry: %w", err)
	}
	if _, err = entry.Write(metadata); err != nil {
		return fmt.Errorf("write portable world metadata: %w", err)
	}
	for _, asset := range assets {
		if err := ctx.Err(); err != nil {
			return err
		}
		body, err := asset.Open(ctx)
		if err != nil {
			return fmt.Errorf("open portable world asset: %w", err)
		}
		if body == nil {
			return fmt.Errorf("portable world asset body is missing")
		}
		closeOnCancel := context.AfterFunc(ctx, func() { _ = body.Close() })
		entry, entryErr := writer.CreateHeader(&zip.FileHeader{Name: asset.Name, Method: zip.Store})
		var written int64
		if entryErr == nil {
			written, entryErr = io.Copy(entry, io.LimitReader(body, maxStreamedMediaArtifactBytes+1))
		}
		closeOnCancel()
		closeErr := body.Close()
		if entryErr != nil {
			return fmt.Errorf("write portable world asset: %w", entryErr)
		}
		if closeErr != nil {
			return fmt.Errorf("close portable world asset: %w", closeErr)
		}
		if written <= 0 || written > maxStreamedMediaArtifactBytes {
			return fmt.Errorf("portable world asset exceeds custody bounds or is empty")
		}
	}
	if err := writer.Close(); err != nil {
		return fmt.Errorf("finish portable world archive: %w", err)
	}
	return nil
}
