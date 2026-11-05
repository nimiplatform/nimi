package nimillm

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/ossmedia"
)

type ossFixtureTransport func(*http.Request) (*http.Response, error)

func (f ossFixtureTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestOSSInputUsesPrivateSignedObjectsAndExactOwnerCleanup(t *testing.T) {
	credential := &ossmedia.Credentials{Config: ossmedia.Config{Region: "cn-beijing", Bucket: "nimi-test-bucket", KeyPrefix: "nimi-input/"}, AccessKeyID: "oss-key-id", AccessKeySecret: "oss-key-secret"}
	object, err := OSSObjectForInput(credential.Config, "task-123", 2, strings.Repeat("a", 64))
	if err != nil {
		t.Fatal(err)
	}
	var methods []string
	metadata := http.Header{}
	client := newOSSInputClient(credential, &http.Client{Transport: ossFixtureTransport(func(r *http.Request) (*http.Response, error) {
		methods = append(methods, r.Method)
		if r.URL.Scheme != "https" || r.URL.Host != "nimi-test-bucket.oss-cn-beijing.aliyuncs.com" {
			t.Error("unexpected storage endpoint", r.URL.Host)
		}
		if !strings.HasPrefix(r.Header.Get("Authorization"), "OSS4-HMAC-SHA256 ") || strings.Contains(r.Header.Get("Authorization"), "Bearer") {
			t.Error("incorrect credential channel")
		}
		response := &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader("")), Request: r}
		if r.URL.RawQuery == "versioning" {
			response.Body = io.NopCloser(strings.NewReader(`<VersioningConfiguration/>`))
			return response, nil
		}
		if r.URL.Path != "/"+object.Key {
			t.Error("wrong object key", r.URL.Path)
		}
		switch r.Method {
		case http.MethodPut:
			body, _ := io.ReadAll(r.Body)
			if string(body) != "owned audio" {
				t.Error("changed input")
			}
			if r.Header.Get("X-Oss-Object-Acl") != "private" || r.Header.Get("X-Oss-Forbid-Overwrite") != "true" {
				t.Error("unsafe upload policy")
			}
			metadata.Set("X-Oss-Meta-Nimi-Input-Job", r.Header.Get("X-Oss-Meta-Nimi-Input-Job"))
			metadata.Set("X-Oss-Meta-Nimi-Input-Sha256", r.Header.Get("X-Oss-Meta-Nimi-Input-Sha256"))
		case http.MethodHead:
			response.Header = metadata.Clone()
		case http.MethodDelete:
			response.StatusCode = 204
		default:
			t.Error("unexpected storage operation", r.Method)
		}
		return response, nil
	})})
	defer client.Close()
	if err := client.RequireUnversionedBucket(context.Background()); err != nil {
		t.Fatal(err)
	}
	signed, err := client.Upload(context.Background(), object, []byte("owned audio"), "audio/wav")
	if err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(signed)
	if err != nil {
		t.Fatal(err)
	}
	if u.Host != "nimi-test-bucket.oss-cn-beijing.aliyuncs.com" || u.Path != "/"+object.Key || u.Query().Get("x-oss-expires") != "172800" || strings.Contains(signed, "oss-key-secret") {
		t.Fatal("incorrect signed object scope")
	}
	if state, err := client.Delete(context.Background(), object); err != nil || state != "deleted" {
		t.Fatal(state, err)
	}
	before := len(methods)
	metadata.Set("X-Oss-Meta-Nimi-Input-Job", "foreign-task")
	if state, err := client.Delete(context.Background(), object); err == nil || state != "unconfirmed" {
		t.Fatal("foreign object deletion was admitted")
	}
	if len(methods) != before+1 || methods[len(methods)-1] != http.MethodHead {
		t.Fatal("foreign object received DELETE")
	}
}

func TestOSSVersionedBucketAndProviderErrorsFailWithoutSecretDiagnostics(t *testing.T) {
	credential := &ossmedia.Credentials{Config: ossmedia.Config{Region: "cn-beijing", Bucket: "nimi-test-bucket", KeyPrefix: "nimi-input/"}, AccessKeyID: "oss-key-id", AccessKeySecret: "secret-never-in-errors"}
	for _, state := range []string{"Enabled", "Suspended"} {
		calls := 0
		client := newOSSInputClient(credential, &http.Client{Transport: ossFixtureTransport(func(r *http.Request) (*http.Response, error) {
			calls++
			return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`<VersioningConfiguration><Status>` + state + `</Status></VersioningConfiguration>`)), Request: r}, nil
		})})
		if err := client.RequireUnversionedBucket(context.Background()); err == nil {
			t.Fatal("versioned bucket admitted", state)
		}
		if calls != 1 {
			t.Fatal("unexpected retry", calls)
		}
	}
	calls := 0
	client := newOSSInputClient(credential, &http.Client{Transport: ossFixtureTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: http.StatusForbidden, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`<Error><Code>AccessDenied</Code><Message>secret-never-in-errors</Message><RequestId>test-request</RequestId></Error>`)), Request: r}, nil
	})})
	err := client.RequireUnversionedBucket(context.Background())
	if err == nil || strings.Contains(err.Error(), "secret-never-in-errors") || strings.Contains(err.Error(), "oss-key-id") {
		t.Fatal("raw OSS diagnostics escaped")
	}
	if calls != 1 {
		t.Fatal("OSS authorization failure was retried")
	}
}
