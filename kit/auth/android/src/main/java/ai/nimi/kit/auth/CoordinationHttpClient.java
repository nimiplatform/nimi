package ai.nimi.kit.auth;

import java.util.concurrent.TimeUnit;
import okhttp3.ConnectionPool;
import okhttp3.CookieJar;
import okhttp3.EventListener;
import okhttp3.OkHttpClient;

/** Narrow Realm coordination transport. A new request must not inherit an
 * idle socket that a mobile network or loopback forwarder has already ended. */
final class CoordinationHttpClient {
    private CoordinationHttpClient() {}

    static OkHttpClient create(EventListener.Factory events) {
        return new OkHttpClient.Builder()
            // Zero retained idle connections; the positive duration is required
            // by OkHttp and does not retain a connection when the limit is zero.
            .connectionPool(new ConnectionPool(0, 5, TimeUnit.MINUTES))
            .cookieJar(CookieJar.NO_COOKIES)
            .followRedirects(false).followSslRedirects(false)
            .retryOnConnectionFailure(false).callTimeout(20, TimeUnit.SECONDS)
            .eventListenerFactory(events).build();
    }
}
