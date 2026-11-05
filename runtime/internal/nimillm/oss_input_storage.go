package nimillm

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/aliyun/alibabacloud-oss-go-sdk-v2/oss"
	"github.com/aliyun/alibabacloud-oss-go-sdk-v2/oss/credentials"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/ossmedia"
	"google.golang.org/grpc/codes"
)

type OSSInputClient struct {
	client *oss.Client
	config ossmedia.Config
	close  func()
}

type OSSInputCleanup struct {
	State                                string
	Deleted, Absent, Failed, Unconfirmed int
	ReasonCode                           runtimev1.ReasonCode
}

func (c *OSSInputClient) Cleanup(ctx context.Context, objects []OSSInputObject) OSSInputCleanup {
	result := OSSInputCleanup{ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}
	var states []string
	for _, object := range objects {
		attempt, cancel := context.WithTimeout(ctx, 5*time.Second)
		state, err := c.Delete(attempt, object)
		cancel()
		states = append(states, state)
		switch state {
		case "deleted":
			result.Deleted++
		case "absent":
			result.Absent++
		case "failed":
			result.Failed++
		default:
			result.Unconfirmed++
		}
		if err != nil {
			result.ReasonCode = runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
			if reason, ok := grpcerr.ExtractReasonCode(err); ok {
				result.ReasonCode = reason
			}
		}
	}
	result.State = OSSInputCleanupSummary(states)
	return result
}

// OSSInputObject identifies only a captured Job's upload, never a user filename
// or an arbitrary caller-supplied bucket/key. It is safe to reconstruct before IO.
type OSSInputObject struct {
	Key    string
	JobID  string
	SHA256 string
}

var ossJobIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
var ossDigestPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

func OSSObjectForInput(config ossmedia.Config, jobID string, index int, sha256 string) (OSSInputObject, error) {
	if !ossJobIDPattern.MatchString(jobID) || index < 0 || index > 50 || !ossDigestPattern.MatchString(sha256) {
		return OSSInputObject{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	return OSSInputObject{Key: config.KeyPrefix + "job-" + jobID + "/input-" + strconv.Itoa(index), JobID: jobID, SHA256: sha256}, nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.oss-input-storage
func NewOSSInputClient(ctx context.Context, captured *ossmedia.Credentials) (*OSSInputClient, error) {
	if captured == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MEDIA_STORAGE_NOT_CONFIGURED, grpcerr.ReasonOptions{Message: "This video input requires configured OSS media storage", ActionHint: "configure_oss_media_storage"})
	}
	origin := "https://" + captured.Config.Bucket + ".oss-" + captured.Config.Region + ".aliyuncs.com"
	httpClient, err := newSecuredHTTPClient(ctx, origin, false)
	if err != nil {
		return nil, mapOSSError(err)
	}
	httpClient.Timeout = 60 * time.Second
	httpClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return newOSSInputClient(captured, httpClient), nil
}

func newOSSInputClient(captured *ossmedia.Credentials, httpClient *http.Client) *OSSInputClient {
	// Do not inherit SDK logging, proxy or credentials from process environment.
	config := (&oss.Config{}).WithRegion(captured.Config.Region).WithEndpoint(captured.Config.Endpoint()).WithHttpClient(httpClient).WithRetryMaxAttempts(1).WithCredentialsProvider(credentials.NewStaticCredentialsProvider(captured.AccessKeyID, captured.AccessKeySecret, captured.SecurityToken))
	config.SignatureVersion = oss.Ptr(oss.SignatureVersionV4)
	config.LogLevel = oss.Ptr(oss.LogOff)
	return &OSSInputClient{client: oss.NewClient(config), config: captured.Config, close: httpClient.CloseIdleConnections}
}

func (c *OSSInputClient) Close() {
	if c != nil && c.close != nil {
		c.close()
	}
}

func (c *OSSInputClient) RequireUnversionedBucket(ctx context.Context) error {
	result, err := c.client.GetBucketVersioning(ctx, &oss.GetBucketVersioningRequest{Bucket: oss.Ptr(c.config.Bucket)})
	if err != nil {
		return mapOSSError(err)
	}
	if result == nil || oss.ToString(result.VersionStatus) != "" {
		return grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MEDIA_STORAGE_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{Message: "OSS media input requires a bucket with versioning never enabled", ActionHint: "configure_unversioned_oss_bucket"})
	}
	return nil
}

func (c *OSSInputClient) Upload(ctx context.Context, object OSSInputObject, body []byte, mimeType string) (string, error) {
	result, err := c.client.PutObject(ctx, &oss.PutObjectRequest{
		Bucket: oss.Ptr(c.config.Bucket), Key: oss.Ptr(object.Key), Body: bytes.NewReader(body), ContentType: oss.Ptr(mimeType), ContentLength: oss.Ptr(int64(len(body))),
		ForbidOverwrite: oss.Ptr("true"), Acl: oss.ObjectACLPrivate,
		Metadata: map[string]string{"nimi-input-job": object.JobID, "nimi-input-sha256": object.SHA256},
	})
	if err != nil {
		return "", mapOSSError(err)
	}
	if result == nil || oss.ToString(result.VersionId) != "" {
		return "", grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MEDIA_STORAGE_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{Message: "OSS bucket versioning changed during upload", ActionHint: "configure_unversioned_oss_bucket"})
	}
	url, err := c.client.Presign(ctx, &oss.GetObjectRequest{Bucket: oss.Ptr(c.config.Bucket), Key: oss.Ptr(object.Key)}, func(options *oss.PresignOptions) { options.Expires = 48 * time.Hour })
	if err != nil {
		return "", mapOSSError(err)
	}
	if url == nil || url.Method != http.MethodGet {
		return "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return url.URL, nil
}

// Delete first checks exact ownership on the storage boundary, including when
// the upload response was interrupted. A collision is never an authorization to
// delete the already existing object. No list or prefix-delete API is used.
func (c *OSSInputClient) Delete(ctx context.Context, object OSSInputObject) (string, error) {
	head, err := c.client.HeadObject(ctx, &oss.HeadObjectRequest{Bucket: oss.Ptr(c.config.Bucket), Key: oss.Ptr(object.Key)})
	if err != nil {
		var serviceError *oss.ServiceError
		if errors.As(err, &serviceError) && serviceError.StatusCode == http.StatusNotFound {
			return "absent", nil
		}
		return "failed", mapOSSError(err)
	}
	if head == nil || head.Metadata["nimi-input-job"] != object.JobID || head.Metadata["nimi-input-sha256"] != object.SHA256 {
		return "unconfirmed", grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MEDIA_STORAGE_CLEANUP_UNCONFIRMED, grpcerr.ReasonOptions{Message: "OSS object ownership does not match this task", ActionHint: "inspect_oss_media_cleanup"})
	}
	result, err := c.client.DeleteObject(ctx, &oss.DeleteObjectRequest{Bucket: oss.Ptr(c.config.Bucket), Key: oss.Ptr(object.Key), VersionId: head.VersionId})
	if err != nil {
		return "failed", mapOSSError(err)
	}
	if result == nil || result.DeleteMarker {
		return "unconfirmed", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_MEDIA_STORAGE_CLEANUP_UNCONFIRMED)
	}
	return "deleted", nil
}

func mapOSSError(err error) error {
	var serviceError *oss.ServiceError
	if errors.As(err, &serviceError) {
		if serviceError.StatusCode == 401 || serviceError.StatusCode == 403 {
			return grpcerr.WithReasonCodeOptions(codes.Unauthenticated, runtimev1.ReasonCode_AI_MEDIA_STORAGE_AUTH_FAILED, grpcerr.ReasonOptions{Message: "OSS media storage authorization failed", ActionHint: "update_oss_media_storage_credentials"})
		}
		if serviceError.StatusCode == 409 {
			return grpcerr.WithReasonCodeOptions(codes.AlreadyExists, runtimev1.ReasonCode_AI_MEDIA_STORAGE_CLEANUP_UNCONFIRMED, grpcerr.ReasonOptions{Message: "OSS input object already exists; upload was not repeated", ActionHint: "inspect_oss_media_cleanup"})
		}
	}
	// SDK error strings can contain signed URLs and native request details.
	// Preserve no such strings in the caller-facing error or Job audit.
	return grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_MEDIA_STORAGE_UNAVAILABLE, grpcerr.ReasonOptions{Message: "OSS media storage request failed", ActionHint: "check_oss_media_storage"})
}

func OSSInputCleanupSummary(states []string) string {
	for _, state := range states {
		if state == "failed" {
			return "failed"
		}
	}
	for _, state := range states {
		if state != "deleted" && state != "absent" {
			return "unconfirmed"
		}
	}
	if len(states) == 0 {
		return "not_required"
	}
	return "deleted"
}

// Avoid storing or logging presigned URLs: they are transient provider inputs.
func (o OSSInputObject) String() string {
	return fmt.Sprintf("OSS input for task %s", strings.TrimSpace(o.JobID))
}
