# HazCom training video — source

`../HazCom-Training.mp4` (English) and `../HazCom-Training-Espanol.mp4` (Spanish) are built from these files.

Build English: `python3 build_video.py all` · Spanish: `SCRIPT=script_es python3 build_video.py all`

- `script.py` / `script_es.py` — every slide, bullet and narration line, including the scenarios, in English and Spanish (voice `ef_dora`; OSHA is spelled "Ocha" in the Spanish narration so it's said the way Spanish speakers say it).
- `build_video.py` — renders slides with Chromium, narrates with Kokoro (voice `af_heart`), assembles with ffmpeg.
- `check_narration.py` — transcribes the narration with a small Whisper model to confirm key terms are pronounced right.
- `ghs/` — GHS pictograms from the MIT-licensed `@ghs-hazard-pictograms/assets` npm package.

Needs (not committed, large downloads): `pip install kokoro-onnx soundfile imageio-ffmpeg pillow sherpa-onnx`, plus
`kokoro-v1.0.int8.onnx` and `voices-v1.0.bin` from the kokoro-onnx GitHub release `model-files-v1.0`, and
`sherpa-onnx-whisper-tiny.en` and `sherpa-onnx-whisper-small` (for Spanish) from the sherpa-onnx `asr-models` release, all placed next to these scripts.
Paths to the fonts and logo point at `employee/` in this repo.
