"""Transcribe each narration clip and show it next to the script line, flagging key terms."""
import hashlib, os, re, sys
sys.path.insert(0, '/home/user/tts')
import importlib
_mod = importlib.import_module(os.environ.get('SCRIPT', 'script'))
SLIDES = _mod.SLIDES
ES = getattr(_mod, 'LANG', 'en-us') == 'es'
import soundfile as sf, sherpa_onnx
m = 'small' if ES else 'tiny.en'
d = f'/home/user/tts/sherpa-onnx-whisper-{m}'
rec = sherpa_onnx.OfflineRecognizer.from_whisper(encoder=f'{d}/{m}-encoder.int8.onnx', decoder=f'{d}/{m}-decoder.int8.onnx',
                                                 tokens=f'{d}/{m}-tokens.txt', language='es' if ES else 'en', task='transcribe', num_threads=2)
VOICE = getattr(_mod, 'VOICE', 'af_heart')
OUT = '/home/user/tts/' + getattr(_mod, 'OUT_DIR', 'out')
TERMS = ['hoja de datos', 'dióxido', 'h dos s', 'fosgeno', 'hexavalente', 'manganeso', 'acetileno', 'nueve uno uno', 'protección personal', 'ácido sulfhídrico', 'osha', 'sds', 's d s', 'co2', 'c o two', 'h2s', 'h two s', 'phosgene', 'hexavalent', 'manganese', 'ppe', 'p p e', 'acetylene', 'tig', 't i g', 'nine one one', '911']
limit = int(next((a for a in sys.argv[1:] if a.isdigit()), 10**9))
n = 0
for s in SLIDES:
    for step in s['steps']:
        text = step[1]
        wav = f"{OUT}/tts_{hashlib.md5(f'{VOICE}|{text}'.encode()).hexdigest()[:16]}.wav"
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
