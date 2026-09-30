# HazCom training video — source

`../HazCom-Training.mp4` is built from these files.

- `script.py` — every slide, bullet and narration line, including the scenarios. Edit this to change the video.
- `build_video.py` — renders slides with Chromium, narrates with Kokoro (voice `af_heart`), assembles with ffmpeg.
- `check_narration.py` — transcribes the narration with a small Whisper model to confirm key terms are pronounced right.
- `ghs/` — GHS pictograms from the MIT-licensed `@ghs-hazard-pictograms/assets` npm package.

Needs (not committed, large downloads): `pip install kokoro-onnx soundfile imageio-ffmpeg pillow sherpa-onnx`, plus
`kokoro-v1.0.int8.onnx` and `voices-v1.0.bin` from the kokoro-onnx GitHub release `model-files-v1.0`, and
`sherpa-onnx-whisper-tiny.en` from the sherpa-onnx `asr-models` release, all placed next to these scripts.
Paths to the fonts and logo point at `employee/` in this repo.
