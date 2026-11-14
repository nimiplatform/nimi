package ai.nimi.kit.auth;

import android.content.pm.PackageManager;
import android.content.pm.ApplicationInfo;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;
import android.content.pm.Signature;
import android.content.pm.verify.domain.DomainVerificationManager;
import android.content.pm.verify.domain.DomainVerificationUserState;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.net.URI;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.security.MessageDigest;
import java.util.Iterator;
import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import okhttp3.Callback;
import okhttp3.Call;
import okhttp3.Connection;
import okhttp3.EventListener;
import okhttp3.Handshake;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/** Platform facts and the SDK's narrow coordination transport. No account
 * credential storage, Runtime execution, device grants or browser cookie jar. */
@CapacitorPlugin(name = "NimiAppAccess")
public class NimiAppAccessPlugin extends Plugin {
    private final OkHttpClient http = CoordinationHttpClient.create(call -> {
            RequestTrace trace = call.request().tag(RequestTrace.class);
            return trace == null ? new EventListener() {} : trace;
        });
    private final ConcurrentHashMap<String, okhttp3.Call> requests = new ConcurrentHashMap<>();

    @PluginMethod
    public void verifySource(PluginCall call) {
        try {
            String kind = call.getString("kind", "");
            boolean development = "android-dev-scheme".equals(kind);
            String packageName = call.getString("packageName");
            String expectedCertificate = call.getString("certificateSha256");
            URI origin = new URI(call.getString("origin", ""));
            URI callback = new URI(call.getString("redirectUri", ""));
            boolean destinationMatches = development
                ? callback.getScheme() != null && callback.getScheme().matches("[a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*)+")
                    && origin.toString().equals(callback.getScheme() + ":/") && callback.getRawAuthority() == null
                    && callback.getRawPath() != null && callback.getRawPath().startsWith("/")
                    && !callback.getRawPath().startsWith("//")
                    && (getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0
                : "android-app-link".equals(kind) && "https".equals(origin.getScheme())
                    && origin.getHost() != null && sameOrigin(origin, callback);
            if (!getContext().getPackageName().equals(packageName) || expectedCertificate == null
                || !destinationMatches || callback.getRawUserInfo() != null
                || callback.getRawQuery() != null || callback.getRawFragment() != null) {
                call.reject("This installed application does not match the registered Android source.", "NIMI_MOBILE_SOURCE_MISMATCH"); return;
            }
            Signature[] signatures = getContext().getPackageManager()
                .getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo.getApkContentsSigners();
            if (signatures.length != 1) { call.reject("A single registered signing identity is required.", "NIMI_MOBILE_SOURCE_MISMATCH"); return; }
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray());
            StringBuilder fingerprint = new StringBuilder();
            for (byte value : digest) { if (fingerprint.length() > 0) fingerprint.append(':'); fingerprint.append(String.format(Locale.ROOT, "%02X", value)); }
            if (!fingerprint.toString().equals(expectedCertificate)) {
                call.reject("The installed signature does not match this registered source.", "NIMI_MOBILE_SOURCE_MISMATCH"); return;
            }
            Intent callbackIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(callback.toString()))
                .addCategory(Intent.CATEGORY_BROWSABLE).setPackage(packageName);
            if (getContext().getPackageManager().resolveActivity(callbackIntent, PackageManager.MATCH_DEFAULT_ONLY) == null) {
                call.reject("The installed application does not declare this sign-in callback.", "NIMI_MOBILE_SOURCE_MISMATCH"); return;
            }
            // @nimi-authority: rule.nimi.platform.remote-clients.android-development
            // The registered development carrier has no domain-verification claim.
            if (development) { call.resolve(); return; }
            DomainVerificationManager manager = getContext().getSystemService(DomainVerificationManager.class);
            DomainVerificationUserState state = manager.getDomainVerificationUserState(packageName);
            Integer status = state == null ? null : state.getHostToStateMap().get(origin.getHost());
            if (state == null || !state.isLinkHandlingAllowed() || status == null
                || status != DomainVerificationUserState.DOMAIN_STATE_VERIFIED) {
                call.reject("This application's Android sign-in link has not been verified on this device.", "NIMI_MOBILE_APP_LINK_UNVERIFIED"); return;
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("Cannot verify this installed Android source.", "NIMI_MOBILE_SOURCE_UNAVAILABLE");
        }
    }

    @PluginMethod
    public void request(PluginCall call) {
        if (getBridge().getConfig().isLoggingEnabled()) {
            call.reject("Disable native bridge payload logging before Nimi sign-in.", "NIMI_MOBILE_LOGGING_UNSAFE"); return;
        }
        try {
            String id = call.getString("id", "");
            URI url = new URI(call.getString("url", ""));
            URI realm = new URI(getConfig().getString("realmBaseUrl", ""));
            String clientId = getConfig().getString("clientId", "");
            String method = call.getString("method", "GET");
            boolean sourceRead = method.equals("GET") && url.getPath().equals("/api/auth/runtime-clients/" + clientId);
            boolean contextRead = method.equals("GET") && (url.getPath().equals("/api/runtime-access/context")
                || url.getPath().matches("/api/runtime-access/connections/[A-Za-z0-9-]+"));
            boolean contextWrite = method.equals("POST") && (url.getPath().equals("/api/runtime-access/token")
                || url.getPath().equals("/api/runtime-access/context/end") || url.getPath().equals("/api/runtime-access/connections"));
            boolean localHttp = "http".equals(realm.getScheme()) && ("localhost".equals(realm.getHost()) || "127.0.0.1".equals(realm.getHost()));
            if (id.isEmpty() || clientId.isEmpty() || (!"https".equals(realm.getScheme()) && !localHttp)
                || !sameOrigin(url, realm) || url.getRawUserInfo() != null || url.getRawFragment() != null
                || url.getRawQuery() != null || !(sourceRead || contextRead || contextWrite)) {
                call.reject("Only the configured Realm coordination endpoints are available.", "NIMI_MOBILE_REQUEST_INVALID"); return;
            }
            Request.Builder builder = new Request.Builder().url(url.toString());
            if ((getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
                String endpoint = sourceRead ? "source" : url.getPath().endsWith("/token") ? "token"
                    : url.getPath().endsWith("/context/end") ? "context-end"
                    : url.getPath().endsWith("/context") ? "context"
                    : contextWrite ? "connection-create" : "connection-read";
                builder.tag(RequestTrace.class, new RequestTrace(method, endpoint));
            }
            JSObject headers = call.getObject("headers", new JSObject());
            for (Iterator<String> keys = headers.keys(); keys.hasNext();) {
                String key = keys.next(), normalized = key.toLowerCase(Locale.ROOT);
                if (!normalized.equals("authorization") && !normalized.equals("content-type") && !normalized.equals("accept")) {
                    call.reject("Unsupported coordination header.", "NIMI_MOBILE_REQUEST_INVALID"); return;
                }
                builder.header(key, headers.getString(key));
            }
            if (contextWrite) builder.post(RequestBody.create(call.getString("body", ""), MediaType.get("application/json")));
            okhttp3.Call request = http.newCall(builder.build());
            if (requests.putIfAbsent(id, request) != null) { call.reject("Request id is already active.", "NIMI_MOBILE_REQUEST_INVALID"); return; }
            request.enqueue(new Callback() {
                public void onFailure(okhttp3.Call failed, IOException error) {
                    requests.remove(id, failed);
                    RequestTrace trace = failed.request().tag(RequestTrace.class);
                    if (trace != null) trace.failed(error, failed.isCanceled());
                    call.reject(failed.isCanceled() ? "Request canceled." : "Realm connection failed.", failed.isCanceled() ? "NIMI_MOBILE_REQUEST_CANCELLED" : "NIMI_MOBILE_NETWORK_UNAVAILABLE");
                }
                public void onResponse(okhttp3.Call completed, Response response) {
                    try (response) {
                        JSObject result = new JSObject(), responseHeaders = new JSObject();
                        for (String name : response.headers().names()) if (!name.equalsIgnoreCase("set-cookie")) responseHeaders.put(name, response.header(name));
                        result.put("status", response.code()); result.put("headers", responseHeaders);
                        result.put("body", response.body() == null ? "" : response.body().string());
                        call.resolve(result);
                    } catch (IOException error) {
                        RequestTrace trace = completed.request().tag(RequestTrace.class);
                        if (trace != null) trace.failed(error, completed.isCanceled());
                        call.reject("Realm response could not be read.", "NIMI_MOBILE_NETWORK_UNAVAILABLE");
                    }
                    finally { requests.remove(id, completed); }
                }
            });
        } catch (Exception error) { call.reject("Invalid Realm coordination request.", "NIMI_MOBILE_REQUEST_INVALID"); }
    }

    @PluginMethod
    public void cancelRequest(PluginCall call) {
        okhttp3.Call pending = requests.get(call.getString("id", ""));
        if (pending != null) pending.cancel();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() { for (okhttp3.Call pending : requests.values()) pending.cancel(); requests.clear(); }

    /** Debug-only finite transport facts. Never log URLs, headers, payloads,
     * exception messages or stack traces: coordination carries credentials. */
    private static final class RequestTrace extends EventListener {
        private final String method, endpoint;
        private final long started = System.nanoTime();
        private volatile String phase = "queued";
        private volatile boolean dialing, acquired;

        RequestTrace(String method, String endpoint) { this.method = method; this.endpoint = endpoint; }
        @Override public void dnsStart(Call call, String domainName) { phase = "dns"; }
        @Override public void connectStart(Call call, InetSocketAddress address, Proxy proxy) { dialing = true; phase = "connect"; }
        @Override public void secureConnectStart(Call call) { phase = "tls"; }
        @Override public void secureConnectEnd(Call call, Handshake handshake) { phase = "tls-complete"; }
        @Override public void connectionAcquired(Call call, Connection connection) { acquired = true; phase = "connection-acquired"; }
        @Override public void requestHeadersStart(Call call) { phase = "request-headers"; }
        @Override public void requestHeadersEnd(Call call, Request request) { phase = "request-headers-sent"; }
        @Override public void requestBodyStart(Call call) { phase = "request-body"; }
        @Override public void requestBodyEnd(Call call, long count) { phase = "request-body-sent"; }
        @Override public void responseHeadersStart(Call call) { phase = "response-headers"; }
        @Override public void responseHeadersEnd(Call call, Response response) { phase = "response-headers-received"; }
        @Override public void responseBodyStart(Call call) { phase = "response-body"; }
        @Override public void responseBodyEnd(Call call, long count) { phase = "response-body-complete"; }

        void failed(IOException error, boolean canceled) {
            Throwable cause = error;
            for (int depth = 0; depth < 8 && cause.getCause() != null && cause.getCause() != cause; depth++) cause = cause.getCause();
            Log.w("NimiAppAccess", "coordination failure endpoint=" + endpoint + " method=" + method
                + " phase=" + phase + " exception=" + error.getClass().getSimpleName()
                + " cause=" + cause.getClass().getSimpleName() + " newConnectionAttempted=" + dialing + " connectionAcquired=" + acquired
                + " canceled=" + canceled + " elapsedMs=" + TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started));
        }
    }

    private static boolean sameOrigin(URI a, URI b) {
        return a.getScheme() != null && a.getScheme().equals(b.getScheme()) && a.getHost() != null
            && a.getHost().equals(b.getHost()) && a.getPort() == b.getPort();
    }
}
