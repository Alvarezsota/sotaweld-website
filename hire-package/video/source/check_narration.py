"""Transcribe each narration clip and show it next to the script line, flagging key terms."""
import hashlib, os, re, sys
sys.path.insert(0, '/home/user/tts')
from script import SLIDES
import soundfile as sf, sherpa_onnx
d = '/home/user/tts/sherpa-onnx-whisper-tiny.en'
rec = sherpa_onnx.OfflineRecognizer.from_whisper(encoder=f'{d}/tiny.en-encoder.int8.onnx', decoder=f'{d}/tiny.en-decoder.int8.onnx',
                                                 tokens=f'{d}/tiny.en-tokens.txt', language='en', task='transcribe', num_threads=2)
VOICE = 'af_heart'
TERMS = ['osha', 'sds', 's d s', 'co2', 'c o two', 'h2s', 'h two s', 'phosgene', 'hexavalent', 'manganese', 'ppe', 'p p e', 'acetylene', 'tig', 't i g', 'nine one one', '911']
limit = int(next((a for a in sys.argv[1:] if a.isdigit()), 10**9))
n = 0
for s in SLIDES:
    for step in s['steps']:
        text = step[1]
        wav = f"/home/user/tts/out/tts_{hashlib.md5(f'{VOICE}|{text}'.encode()).hexdigest()[:16]}.wav"
        if not os.path.exists(wav) or n >= limit:
            continue
        n += 1
        a, sr = sf.read(wav, dtype='float32')
        st = rec.create_stream(); st.accept_waveform(sr, a); rec.decode_stream(st)
        heard = st.result.text.strip()
        low = text.lower()
        if any(t in low for t in TERMS) or '-v' in sys.argv:
            print(f'[{s["key"]}] SCRIPT: {text}\n{" " * (len(s["key"]) + 3)}HEARD:  {heard}\n')
print(n, 'clips checked')
