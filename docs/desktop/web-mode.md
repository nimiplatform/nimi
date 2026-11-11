<!-- nimi-docs: {"authority":["rule.nimi.platform.product-lifecycle.remote-runtime-management","rule.nimi.platform.product-lifecycle.p-web-005a"],"sources":["apps/web/README.md","sdks/typescript/runtime/remote.ts"]} -->

# Web Portal and Desktop Nimi Home

The official Nimi website and the installed Nimi Home desktop client serve distinct, complementary roles. The public web portal provides product overviews, release status, policy documentation, and Realm-backed account authentication. Nimi Home is the local execution environment, providing private local AI inference and supervised application hosting.

## The Browser Web Portal

- **Product & Ecosystem Showcase**: Discover platform features, read developer guides, and explore highlighted applications.
- **Account Authentication & Security**: Register, complete two-factor authentication, and manage security settings. Browser authentication interfaces directly with Realm identity services.
- **Installer Status**: Check current download availability and platform status.
- **Scope Note**: The website is an information and identity portal; it does not replace the desktop app for local inference or hardware-accelerated app hosting.

## Desktop Nimi Home

- **Private Local AI Inference**: Executes open-weights models through local Runtime, executing the selected local inference on-device. Cloud inference and online features have separate data flows.
- **App Hosting & Developer Debugging**: Supervised Electron hosts provide the current App with admitted SDK and Kit operations. Host and Runtime retain session credentials; the App receives bounded results and session status.
- **System Resource Management**: Inspect Runtime and local model status, and manage model downloads and storage.

## User Journey: Web Authentication Handover

1. **Initiate Login**: Click "Sign In" inside Desktop; the app launches your default browser to the official authentication page.
2. **Secure Verification**: Sign in using an authentication method offered by the browser page and complete any required two-factor verification.
3. **Authorization Handover**: Upon verification, the browser returns an authorization code via the local loopback callback configured for this session.
4. **Session Activation**: Desktop transfers the callback to the local Runtime, which validates the response, exchanges the code for credentials, and securely manages session tokens.

## Official Web Remote Management

With a Registry-qualified official_manager source and exact HTTPS callback configured, `/account/runtime` can manage the current account's primary Runtime over the same direct carrier. PC Home confirms that source on first use; website branding, a domain or caller parameter does not grant management permission.

The implemented subset covers actual service state, confirmed-source pause/resume, existing Apps' AIConfig and explicit Runtime stop. Closing the page ends only its client session. A stopped host must be started from the PC, and an accepted stop request is not confirmation of process exit. Unconfigured or non-HTTPS deployments can still show binding information but cannot perform management.

Third-party Web Apps use ordinary App sources and implemented consumption operations; being a browser client does not confer manager permission. The official site does not host a browser Home.

## Source Basis

- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`apps/web/src/site-router.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/web/src/site-router.tsx)
