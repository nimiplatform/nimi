package ai.nimi.kit.auth;

import static org.junit.Assert.*;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.*;
import org.junit.Test;

public class CoordinationHttpClientTest {
    private static OkHttpClient client() { return CoordinationHttpClient.create(call -> new okhttp3.EventListener() {}); }
    private static String get(OkHttpClient client, Server server) throws IOException {
        try (Response response = client.newCall(new Request.Builder().url(server.url()).build()).execute()) {
            return response.body().string();
        }
    }
    private static void close(OkHttpClient client) { client.connectionPool().evictAll(); client.dispatcher().executorService().shutdownNow(); }

    @Test public void reusedSocketEofFailsOldPolicyAndFreshConnectionSucceeds() throws Exception {
        // The first response keeps HTTP/1.1 alive. A later request on that same
        // connection ends before any response headers, matching the device EOF.
        try (Server server = new Server(Mode.DROP_REUSED)) {
            OkHttpClient old = new OkHttpClient.Builder().retryOnConnectionFailure(false).build();
            try {
                assertEquals("ok", get(old, server));
                IOException failure = assertThrows(IOException.class, () -> get(old, server));
                assertTrue(failure.getCause() instanceof EOFException);
                assertEquals(1, server.connections.get()); assertEquals(2, server.received.size());
            } finally { close(old); }
        }
        try (Server server = new Server(Mode.DROP_REUSED)) {
            OkHttpClient current = client();
            try {
                assertEquals("ok", get(current, server));
                assertEquals("ok", get(current, server));
                assertEquals(2, server.connections.get()); assertEquals(2, server.received.size());
            } finally { close(current); }
        }
    }

    @Test public void postIsDeliveredOnceAndFailureIsNeverReplayed() throws Exception {
        try (Server server = new Server(Mode.DROP_ALL)) {
            OkHttpClient current = client();
            try {
                Request request = new Request.Builder().url(server.url())
                    .post(RequestBody.create("once", MediaType.get("application/json"))).build();
                assertThrows(IOException.class, () -> current.newCall(request).execute());
                assertEquals(1, server.connections.get()); assertEquals(1, server.received.size());
                assertEquals("POST", server.received.get(0).method); assertEquals("once", server.received.get(0).body);
            } finally { close(current); }
        }
    }

    @Test public void cancellationEndsWaitingRequestWithoutReplay() throws Exception {
        try (Server server = new Server(Mode.STALL)) {
            OkHttpClient current = client(); ExecutorService executor = Executors.newSingleThreadExecutor();
            try {
                Call call = current.newCall(new Request.Builder().url(server.url()).build());
                Future<Boolean> result = executor.submit(() -> { try (Response ignored = call.execute()) { return false; } catch (IOException expected) { return call.isCanceled(); } });
                assertTrue(server.started.await(2, TimeUnit.SECONDS)); call.cancel();
                assertTrue(result.get(2, TimeUnit.SECONDS)); assertEquals(1, server.received.size());
            } finally { executor.shutdownNow(); close(current); }
        }
    }

    @Test public void cookiesAndRedirectsRemainDisabled() throws Exception {
        OkHttpClient current = client();
        try {
            try (Server server = new Server(Mode.COOKIE)) {
                assertEquals("ok", get(current, server)); assertEquals("ok", get(current, server));
                assertTrue(server.received.stream().allMatch(request -> request.cookie.isEmpty()));
            }
            try (Server server = new Server(Mode.REDIRECT);
                 Response response = current.newCall(new Request.Builder().url(server.url()).build()).execute()) {
                assertEquals(302, response.code()); assertEquals(1, server.received.size());
            }
        } finally { close(current); }
    }

    private enum Mode { DROP_REUSED, DROP_ALL, STALL, COOKIE, REDIRECT }
    private record Received(String method, String body, String cookie) {}

    /** A real loopback HTTP socket fixture; no native HTTP or OkHttp methods are mocked. */
    private static final class Server implements AutoCloseable {
        final ServerSocket listener = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"));
        final AtomicInteger connections = new AtomicInteger();
        final List<Received> received = new CopyOnWriteArrayList<>();
        final List<Socket> sockets = new CopyOnWriteArrayList<>();
        final CountDownLatch started = new CountDownLatch(1), stopped = new CountDownLatch(1);
        final ExecutorService workers = Executors.newCachedThreadPool();
        final Mode mode;
        Server(Mode mode) throws IOException {
            this.mode = mode;
            workers.submit(() -> { while (!listener.isClosed()) try {
                Socket socket = listener.accept(); connections.incrementAndGet(); sockets.add(socket);
                workers.submit(() -> serve(socket));
            } catch (IOException expectedOnClose) { if (!listener.isClosed()) throw new UncheckedIOException(expectedOnClose); } });
        }
        String url() { return "http://127.0.0.1:" + listener.getLocalPort() + "/coordination"; }
        void serve(Socket socket) {
            try (socket; BufferedReader input = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.US_ASCII))) {
                for (int number = 1; ; number++) {
                    String request = input.readLine(); if (request == null) return;
                    int length = 0; String cookie = "", header;
                    while ((header = input.readLine()) != null && !header.isEmpty()) {
                        if (header.toLowerCase(Locale.ROOT).startsWith("content-length:")) length = Integer.parseInt(header.substring(15).trim());
                        if (header.toLowerCase(Locale.ROOT).startsWith("cookie:")) cookie = header.substring(7).trim();
                    }
                    char[] body = new char[length]; int offset = 0;
                    while (offset < length) { int count = input.read(body, offset, length - offset); if (count < 0) return; offset += count; }
                    received.add(new Received(request.split(" ")[0], new String(body), cookie)); started.countDown();
                    if (mode == Mode.DROP_ALL || (mode == Mode.DROP_REUSED && number > 1)) return;
                    if (mode == Mode.STALL) { stopped.await(); return; }
                    String response = mode == Mode.REDIRECT ? "HTTP/1.1 302 Found\r\nContent-Length: 0\r\nLocation: " + url() + "/again\r\n\r\n"
                        : "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n" + (mode == Mode.COOKIE ? "Set-Cookie: fixture=one\r\n" : "") + "\r\nok";
                    socket.getOutputStream().write(response.getBytes(StandardCharsets.US_ASCII)); socket.getOutputStream().flush();
                }
            } catch (IOException | InterruptedException expectedOnClose) { }
        }
        @Override public void close() throws IOException {
            listener.close(); stopped.countDown();
            for (Socket socket : sockets) socket.close();
            workers.shutdownNow();
        }
    }
}
