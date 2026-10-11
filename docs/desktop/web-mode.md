# Web Portal and Desktop Nimi Home

The official Nimi website and the installed Nimi Home desktop client serve distinct, complementary roles. The public web portal provides product overviews, release status, policy documentation, and Realm-backed account authentication. Nimi Home is the local execution environment, providing private local AI inference and supervised application hosting.

## The Browser Web Portal

- **Product & Ecosystem Showcase**: Discover platform features, read developer guides, and explore highlighted applications.
- **Account Authentication & Security**: Register, complete two-factor authentication, and manage security settings. Browser authentication interfaces directly with Realm identity services.
- **Installer Status**: Check current download availability and platform status.
- **Scope Note**: The website is an information and identity portal; it does not replace the desktop app for local inference or hardware-accelerated app hosting.

## Desktop Nimi Home

- **Private Local AI Inference**: Executes open-weights models through local Runtime, keeping sensitive prompts and files entirely on-device.
- **App Hosting & Developer Debugging**: Supervised Electron hosts provide the current App with admitted SDK and Kit operations. Host and Runtime retain session credentials; the App receives bounded results and session status.
- **System Resource Management**: Centrally manage GPU/NPU utilization, local model caches, disk quotas, and multi-agent coordination.

## User Journey: Web Authentication Handover

1. **Initiate Login**: Click "Sign In" inside Desktop; the app launches your default browser to the official authentication page.
2. **Secure Verification**: Sign in using an authentication method offered by the browser page and complete any required two-factor verification.
3. **Authorization Handover**: Upon verification, the browser returns an authorization code via the local loopback callback configured for this session.
4. **Session Activation**: Desktop transfers the callback to the local Runtime, which validates the response, exchanges the code for credentials, and securely manages the session tokens.

## Source Basis

- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`apps/web/src/site-router.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/web/src/site-router.tsx)
