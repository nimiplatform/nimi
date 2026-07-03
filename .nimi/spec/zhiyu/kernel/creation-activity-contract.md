# Zhiyu Creation Activity Contract

## Z-ACT-001 Partner Activities Use Conversation Path

Text organization, summary, drafting, and similar partner activities are
partner conversation activities. They must use Runtime Agent turn consumption,
not direct text generation helpers.

## Z-ACT-002 Image Creation Removed

Image studio, image prompt tool, image provider/model control, and app-local
image generation are removed from Zhiyu v1.

## Z-ACT-003 Image Artifact Display Exception

If Runtime local agent generates an image during conversation, Zhiyu may
display the Runtime-owned conversation artifact projection. This exception does
not admit image generation as a Zhiyu capability.
