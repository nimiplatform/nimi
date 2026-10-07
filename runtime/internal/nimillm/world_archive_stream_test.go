package nimillm

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"reflect"
	"strings"
	"testing"
	"time"
)

func calibratedArchiveTestMetadata() portableWorldArchiveMetadata {
	scale, ground := 2.1, 1.7
	return portableWorldArchiveMetadata{WorldID: "world-test", SplatCoordinateSystem: "opencv", MetricScaleFactor: &scale, GroundPlaneOffset: &ground, SplatPath: "world.spz"}
}

func TestPortableWorldArchiveStreamsLargeAssetsAndPreservesMetadata(t *testing.T) {
	const length = 33 << 20
	metadata := calibratedArchiveTestMetadata()
	metadata.PanoramaPath = "panorama.image"
	stream, err := streamWorldArchive(context.Background(), metadata, []worldArchiveAsset{
		{Name: "world.spz", Open: func(context.Context) (io.ReadCloser, error) {
			return io.NopCloser(io.LimitReader(archiveZeroReader{}, length)), nil
		}},
		{Name: "panorama.image", Open: func(context.Context) (io.ReadCloser, error) {
			return io.NopCloser(strings.NewReader("exact-preview")), nil
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = stream.Close() }()
	data, err := io.ReadAll(stream)
	if err != nil {
		t.Fatal(err)
	}
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	if len(archive.File) != 3 || archive.File[1].Name != "world.spz" || archive.File[1].UncompressedSize64 != length {
		t.Fatalf("archive entries: %+v", archive.File)
	}
	metaBody, err := archive.File[0].Open()
	if err != nil {
		t.Fatal(err)
	}
	var decoded portableWorldArchiveMetadata
	err = json.NewDecoder(metaBody).Decode(&decoded)
	_ = metaBody.Close()
	if err != nil || !reflect.DeepEqual(decoded, metadata) {
		t.Fatalf("archive metadata changed: %+v %v", decoded, err)
	}
	body, err := archive.File[2].Open()
	if err != nil {
		t.Fatal(err)
	}
	preview, err := io.ReadAll(body)
	_ = body.Close()
	if err != nil || string(preview) != "exact-preview" {
		t.Fatalf("preview %q %v", preview, err)
	}
}

func TestPortableWorldArchiveRejectsUnknownSpatialFactsAndUnsafeEntriesBeforeDownload(t *testing.T) {
	opened := 0
	asset := worldArchiveAsset{Name: "world.spz", Open: func(context.Context) (io.ReadCloser, error) {
		opened++
		return io.NopCloser(strings.NewReader("asset")), nil
	}}
	metadata := calibratedArchiveTestMetadata()
	metadata.MetricScaleFactor = nil
	if _, err := streamWorldArchive(context.Background(), metadata, []worldArchiveAsset{asset}); err == nil {
		t.Fatal("unconfirmed scale accepted")
	}
	metadata = calibratedArchiveTestMetadata()
	metadata.GroundPlaneOffset = nil
	if _, err := streamWorldArchive(context.Background(), metadata, []worldArchiveAsset{asset}); err == nil {
		t.Fatal("unconfirmed ground silently replaced by zero")
	}
	metadata = calibratedArchiveTestMetadata()
	metadata.SplatCoordinateSystem = ""
	if _, err := streamWorldArchive(context.Background(), metadata, []worldArchiveAsset{asset}); err == nil {
		t.Fatal("unconfirmed frame accepted")
	}
	metadata = calibratedArchiveTestMetadata()
	for _, name := range []string{"../world.spz", "https://provider.example/world.spz", "world.json"} {
		bad := asset
		bad.Name = name
		if _, err := streamWorldArchive(context.Background(), metadata, []worldArchiveAsset{bad}); err == nil {
			t.Fatalf("unsafe entry %q accepted", name)
		}
	}
	if _, err := streamWorldArchive(context.Background(), metadata, []worldArchiveAsset{asset, asset}); err == nil {
		t.Fatal("duplicate asset accepted")
	}
	if opened != 0 {
		t.Fatal("download started before archive validation")
	}
}

func TestPortableWorldArchivePropagatesDownloadFailureAndCancelsClosedConsumers(t *testing.T) {
	stream, err := streamWorldArchive(context.Background(), calibratedArchiveTestMetadata(), []worldArchiveAsset{{Name: "world.spz", Open: func(context.Context) (io.ReadCloser, error) { return nil, errors.New("download failed") }}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = io.Copy(io.Discard, stream)
	_ = stream.Close()
	if err == nil || !strings.Contains(err.Error(), "download failed") {
		t.Fatalf("partial archive read: %v", err)
	}
	started := make(chan struct{})
	canceled := make(chan struct{})
	stream, err = streamWorldArchive(context.Background(), calibratedArchiveTestMetadata(), []worldArchiveAsset{{Name: "world.spz", Open: func(ctx context.Context) (io.ReadCloser, error) {
		close(started)
		<-ctx.Done()
		close(canceled)
		return nil, ctx.Err()
	}}})
	if err != nil {
		t.Fatal(err)
	}
	go func() { _, _ = io.Copy(io.Discard, stream) }()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("asset open did not begin")
	}
	_ = stream.Close()
	select {
	case <-canceled:
	case <-time.After(time.Second):
		t.Fatal("closed consumer did not cancel the asset request")
	}
}

type archiveZeroReader struct{}

func (archiveZeroReader) Read(data []byte) (int, error) { clear(data); return len(data), nil }

func TestPortableWorldArchiveUncalibratedVariantNeverFillsMissingMetricFacts(t *testing.T) {
	metadata := portableWorldArchiveMetadata{WorldID: "world-native", CalibrationState: "uncalibrated", SplatCoordinateSystem: "spz-rub", SplatPath: "world.spz"}
	assets := []worldArchiveAsset{{Name: "world.spz", Open: func(context.Context) (io.ReadCloser, error) {
		return io.NopCloser(strings.NewReader("original-native-bytes")), nil
	}}}
	body, err := streamWorldArchive(context.Background(), metadata, assets)
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(body)
	_ = body.Close()
	if err != nil {
		t.Fatal(err)
	}
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	entry, _ := archive.File[0].Open()
	var value map[string]any
	err = json.NewDecoder(entry).Decode(&value)
	_ = entry.Close()
	if err != nil || value["calibrationState"] != "uncalibrated" || value["metricScaleFactor"] != nil || value["groundPlaneOffset"] != nil {
		t.Fatalf("fabricated calibration: %v %v", value, err)
	}
	one := 1.0
	zero := 0.0
	metadata.MetricScaleFactor = &one
	if _, err := streamWorldArchive(context.Background(), metadata, assets); err == nil {
		t.Fatal("uncalibrated scale accepted")
	}
	metadata.MetricScaleFactor = nil
	metadata.GroundPlaneOffset = &zero
	if _, err := streamWorldArchive(context.Background(), metadata, assets); err == nil {
		t.Fatal("unknown ground replaced by zero")
	}
}
