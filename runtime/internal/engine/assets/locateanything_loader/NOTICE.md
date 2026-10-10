# LocateAnything loader

## Fixed upstream sources

- Hugging Face source bundle: [nvidia/LocateAnything-3B](https://huggingface.co/nvidia/LocateAnything-3B/tree/c32291ca5e996f5a7a485845b4f57a233936bba0), revision `c32291ca5e996f5a7a485845b4f57a233936bba0`.
- GitHub code release: [NVlabs/Eagle, Embodied/eaglevl/utils/locany](https://github.com/NVlabs/Eagle/tree/e21b6acde7aff187aa63bafd4cd4eca0c099e7c3/Embodied/eaglevl/utils/locany), commit `e21b6acde7aff187aa63bafd4cd4eca0c099e7c3`.

At that GitHub commit, the [Embodied README license section](https://github.com/NVlabs/Eagle/blob/e21b6acde7aff187aa63bafd4cd4eca0c099e7c3/Embodied/README.md#-license)
explicitly directs repository code to the root [Apache-2.0 LICENSE](https://github.com/NVlabs/Eagle/blob/e21b6acde7aff187aa63bafd4cd4eca0c099e7c3/LICENSE)
and LocateAnything models to [Embodied/LICENSE_MODEL](https://github.com/NVlabs/Eagle/blob/e21b6acde7aff187aa63bafd4cd4eca0c099e7c3/Embodied/LICENSE_MODEL).
The model license's non-commercial restriction must not be described as a
restriction on all loader code merely because code and weights share a model repository.

## Source identity and modifications

Eight files are byte-identical to both fixed upstream sources:
`configuration_locateanything.py`, `configuration_qwen2.py`,
`generate_utils.py`, `image_processing_locateanything.py`,
`mask_magi_utils.py`, `mask_sdpa_utils.py`, `modeling_locateanything.py`,
and `modeling_qwen2.py`.

`processing_locateanything.py` is byte-identical to the fixed Hugging Face
source. Its LMDB path handling differs from the fixed GitHub source; this is
an upstream channel difference, not a Nimi modification.

Nimi modified `modeling_vit.py` on 2026-09-09 to pass four-dimensional tensors
to SDPA and omit the redundant all-true mask for a single image. The fixed
GitHub and Hugging Face originals of this file are byte-identical. Nimi's
modification notice is retained in the file. The other nine upstream Python
files are unmodified relative to the fixed Hugging Face source bundle.

## Retained file notices and license texts

All original file notices remain intact:

| Files | Original notice |
| --- | --- |
| `configuration_locateanything.py` | OpenGVLab, 2023; MIT |
| `modeling_locateanything.py` | NVIDIA, 2025; MIT |
| `configuration_qwen2.py`, `modeling_qwen2.py`, `processing_locateanything.py` | Apache-2.0; original copyright notices retained |
| `generate_utils.py`, `image_processing_locateanything.py`, `mask_magi_utils.py`, `mask_sdpa_utils.py`, `modeling_vit.py` | NVIDIA, 2026; express-license/proprietary-rights notice retained |

`LICENSE.Apache-2.0` and `LICENSE.MIT` accompany those notices. `LICENSE`
is the unchanged NVIDIA license supplied with the fixed Hugging Face bundle.
That license and GitHub's `LICENSE_MODEL` have the same substantive terms
with formatting differences; section 3.3 limits its Work to non-commercial
research or evaluation.

The relationship between the Hugging Face bundle-level license, GitHub's
explicit Apache-2.0 code declaration and the retained NVIDIA file headers
still needs upstream clarification before claiming the entire embedded
loader is exclusively under an OSI-approved license. This notice preserves
the evidence from both channels; it does not delete or override an upstream
notice or assert that every loader file is non-commercial code.

## Runtime and model boundary

Runtime embeds these Python files and all accompanying license/notice files
in its executable and materializes them as a managed Driver bundle.
Model weights are acquired separately. The fixed Hugging Face
[model card](https://huggingface.co/nvidia/LocateAnything-3B/blob/c32291ca5e996f5a7a485845b4f57a233936bba0/README.md)
declares the NVIDIA non-commercial model license and identifies underlying
model terms. Runtime custody and the Nimi adapter do not grant additional
model-use or redistribution rights.

The package initializer is Nimi-authored glue under the Runtime Apache-2.0 license.
