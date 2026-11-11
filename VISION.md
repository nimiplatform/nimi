# Nimi Vision

> **让 AI 真正属于你。** / **Make AI truly yours.**

Today's AI is often trapped inside isolated apps or distant cloud accounts—each tool locks away its own context, and users have little say over where models run or who holds their memory. Nimi is building a user-controlled AI foundation designed to connect PC, Web, mobile, embedded devices, and smart homes. Our goal is to let AI participate naturally in everyday life across the tools and screens you already use: helping with focused work and creation, carrying an authorized conversation from your desk to your phone, and eventually interacting with your physical space through explicit device contracts.

## What Works Today: Your PC as the Personal AI Hub

Today, Nimi centers execution on your PC Runtime, with Nimi Home (currently hosted by Desktop) serving as your local product entry point and management center. Instead of forcing every application or lightweight device to bundle its own heavy engine, the PC Runtime places both Local and Cloud models behind shared capability contracts. Apps focus on their tasks, while you decide how each capability runs:

- **Choose where models run:** Pick a Local route to execute directly on your PC host, or choose a Cloud route to send only the context a request requires to your selected provider. Standard network dependencies still apply when signing into accounts, coordinating sources, or fetching downloads and online resources.
- **Move across screens without running a second engine:** Native Desktop Apps connect through verified local Host sessions. Admitted Web and Android clients can also connect directly to your account-bound primary Runtime through the public SDK and Kit—without needing to run a Runtime on the browser or phone. (Today this relies on a direct connection without relay fallback, and Android has a local development entry; distributed App Link support needs separate validation.)
- **Share what you authorize, isolate what stays private:** Because connected surfaces work with the same PC host, you can pick up an ongoing LocalAgent Conversation on another screen with its available Cognition-managed memories in supported, authorized apps, or check on a creative task from your browser. At the same time, every App retains its own access boundary; connecting to the same Runtime does not automatically expose another App's private data or implies automatic replication across multiple Runtimes.

## Where We Are Going: Beyond the Desk

A personal AI foundation should not stop at the desktop. Looking ahead, we aim to extend Nimi across more mobile platforms, embedded interfaces, and smart-home devices. Some endpoints may simply sense the environment or offer a lightweight voice or screen interface, while others execute capabilities or trigger physical actions.

Bringing AI into additional devices and network environments requires clear boundaries. Broader network coverage, additional Runtime hosts, cross-host synchronization, compute federation, and new hardware carriers are future directions rather than capabilities shipped today. Before we promise support for any new endpoint, we will define its role, permissions, state owner, resource limits, and behavior when connections drop around concrete user tasks.

This foundation is built to support a wide spectrum of everyday experiences. Focused productivity tools, creative applications, and device workflows live alongside lifelike characters, persistent stories, and shared semantic worlds—enriching daily life together without any single category defining the entire platform.

## Lasting Commitments

- **User control:** You choose between supported Local and Cloud execution and keep meaningful control over your data, models, and access.
- **Explicit permission:** Source admission, identity verification, and Runtime operation checks apply consistently across carriers; adding a new device never invents a separate business permission bypass.
- **Clear data ownership:** Every layer has an explicit steward—Realm owns ecosystem identity and shared resources; Runtime owns execution and Conversation; Cognition owns per-Agent long-term Memory; Apps own their business workflows and private data; and Avatar owns presentation.
- **Open building blocks:** Runtime, SDK, Kit, and Proto provide public contracts and open-source implementations so Apps can build on stable interfaces rather than private internals.
- **Honest outcomes:** Unavailable capabilities and uncertain results stay visible. Connectivity and recovery paths never fabricate success or silently replay business work.

Explore the [developer guides](https://docs.nimi.ai/start/) for current artifact choices and platform-specific setup, or visit the [download page](https://nimi.ai/download) for current product availability.
