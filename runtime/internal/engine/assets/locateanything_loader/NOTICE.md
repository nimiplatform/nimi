# LocateAnything loader

Source: https://huggingface.co/nvidia/LocateAnything-3B
Revision: c32291ca5e996f5a7a485845b4f57a233936bba0

The ten upstream Python source files retain their original copyright and
license notices. Nimi modified `modeling_vit.py` on 2026-09-09 to pass
four-dimensional tensors to SDPA and omit the redundant all-true mask for
a single image. The other nine upstream Python source files are unmodified.
The upstream NVIDIA LICENSE is included alongside them. Some files also
carry Apache-2.0 or MIT notices; those notices do not relicense the complete
loader or its model weights.

The NVIDIA-licensed Work is limited to non-commercial research or evaluation.
Runtime custody and the Nimi adapter do not remove these terms or grant
commercial model-use rights. Model weights are acquired separately.

The package initializer is Nimi-authored glue under the repository's
Runtime Apache-2.0 license.
