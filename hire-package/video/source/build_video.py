"""Render the HazCom training video: slide frames (Chromium) + narration (Kokoro) -> MP4 (ffmpeg)."""
import hashlib, html, json, os, subprocess, sys, wave
import numpy as np
import soundfile as sf
import imageio_ffmpeg
import importlib
# Which script to build: SCRIPT=script (English, default) or SCRIPT=script_es (Spanish).
_mod = importlib.import_module(os.environ.get('SCRIPT', 'script'))
SLIDES = _mod.SLIDES
UI = {'do_this': '✓ DO THIS', 'wwyd': 'WHAT WOULD<br>YOU DO?', 'do_label': 'Do this:',
      'lbl_name': 'EXAMPLE FUEL GAS', 'lbl_maker': 'Made by: Example Gas Co. · 555-0100', 'lbl_signal': 'DANGER',
      'lbl_hazard': 'Extremely flammable gas.<br>Contains gas under pressure; may explode if heated.',
      'lbl_prec': 'Keep away from heat, sparks and open flames. Store in a well-ventilated place. Close valve after each use.',
      **getattr(_mod, 'UI', {})}

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, getattr(_mod, 'OUT_DIR', 'out')); os.makedirs(OUT, exist_ok=True)
FONTS = '/home/user/sotaweld-website/employee/fonts'
LOGO = '/home/user/sotaweld-website/employee/sota-logo.png'
CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
VOICE = os.environ.get('VOICE', getattr(_mod, 'VOICE', 'af_heart'))
LANG = getattr(_mod, 'LANG', 'en-us')
FPS = 30
LEAD_IN, GAP, TAIL = 0.6, 0.45, 0.9      # seconds: before a slide's first line, between lines, after a slide
SR = 24000

GOLD, INK, PAPER, CARD, DIM = '#E9A23B', '#EEF2F7', '#0A0C0F', '#12161C', '#8B95A3'

ICONS = {
    'book': '<rect x="45" y="30" width="110" height="140" rx="8"/><path d="M70 30v140M85 65h50M85 90h50M85 115h35"/>',
    'sds': '<path d="M55 25h65l30 30v120H55z"/><path d="M120 25v30h30"/><path d="M75 85h55M75 108h55M75 131h55M75 154h35"/>',
    'fume': '<path d="M40 170h120"/><path d="M100 170v-20"/><path d="M80 130c-20-20 20-30 0-50s20-30 0-50"/><path d="M110 130c-20-20 20-30 0-50s20-30 0-50"/><path d="M140 130c-20-20 20-30 0-50"/>',
    'cylinder': '<rect x="65" y="55" width="70" height="125" rx="30"/><path d="M85 55V38h30v17M92 38V25h16v13"/><path d="M65 95h70"/>',
    'eye': '<path d="M25 100c40-50 110-50 150 0-40 50-110 50-150 0z"/><circle cx="100" cy="100" r="22"/><path d="M100 20v18M45 38l12 13M155 38l-12 13M100 180v-18"/>',
    'flame': '<path d="M100 20c10 35 50 55 50 100a50 50 0 0 1-100 0c0-25 15-40 25-55 5 20 15 28 25 30-5-25-10-50 0-75z"/><path d="M100 175a22 22 0 0 1-22-22c0-15 12-25 22-40 10 15 22 25 22 40a22 22 0 0 1-22 22z"/>',
    'disc': '<circle cx="90" cy="110" r="65"/><circle cx="90" cy="110" r="14"/><path d="M150 60l30-25M160 80l35-5M145 45l10-30"/>',
    'can': '<rect x="60" y="70" width="80" height="110" rx="10"/><path d="M80 70V50h40v20M95 50V35h25"/><path d="M130 38h25M130 30l22-10M130 46l22 10"/><path d="M60 110h80"/>',
    'bolt': '<path d="M115 20L55 110h45l-15 70 60-95h-45z"/>',
    'alarm': '<rect x="55" y="35" width="90" height="140" rx="14"/><rect x="72" y="58" width="56" height="40" rx="4"/><circle cx="100" cy="140" r="14"/><path d="M30 60c-12 20-12 50 0 70M170 60c12 20 12 50 0 70"/>',
    'cross': '<rect x="35" y="35" width="130" height="130" rx="18"/><path d="M85 65h30v20h20v30h-20v20H85v-20H65V85h20z"/>',
}
PICTOS = ['flamme', 'rondflam', 'bottle', 'silhouette', 'skull', 'exclam', 'acid']
PICTO_FOCUS = {1: ['flamme'], 2: ['rondflam'], 3: ['bottle'], 4: ['silhouette'], 5: ['skull', 'exclam', 'acid']}
LABEL_FOCUS = {1: 'name', 2: 'signal', 3: 'hazard', 4: 'precaution', 5: 'all'}

def disp(s):
    return html.escape(s).replace('H2S', 'H₂S')

def visual_html(slide, step_i):
    v = slide['visual']
    if v == 'logo':
        return f'<img class="logo" src="file://{LOGO}">'
    if v.startswith('scenario:'):
        answering = any(st[0] for st in slide['steps'][:step_i + 1])
        icon = f'<svg viewBox="0 0 200 200" class="icon sm">{ICONS[v[9:]]}</svg>'
        if answering:
            return f'<div class="scn">{icon}<div class="dothis">{UI["do_this"]}</div></div>'
        return f'<div class="scn"><div class="q">?</div><div class="wwyd">{UI["wwyd"]}</div></div>'
    if v.startswith('icon:'):
        return f'<svg viewBox="0 0 200 200" class="icon">{ICONS[v[5:]]}</svg>'
    if v == 'pictos':
        focus = PICTO_FOCUS.get(step_i)
        cells = ''.join(
            f'<img src="file://{HERE}/ghs/{n}.svg" class="{"on" if (not focus or n in focus) else "off"}">' for n in PICTOS)
        return f'<div class="pictos">{cells}</div>'
    if v == 'label':
        f = LABEL_FOCUS.get(step_i)
        on = lambda k: 'on' if f in (None, 'all', k) else 'off'
        return f'''<div class="label">
          <div class="lp {on('name')}"><b>{UI["lbl_name"]}</b><br><small>{UI["lbl_maker"]}</small></div>
          <div class="lrow"><img src="file://{HERE}/ghs/flamme.svg" class="{on('hazard')}"><img src="file://{HERE}/ghs/bottle.svg" class="{on('hazard')}">
            <div class="sig {on('signal')}">{UI["lbl_signal"]}</div></div>
          <div class="lp {on('hazard')}">{UI["lbl_hazard"]}</div>
          <div class="lp {on('precaution')}"><small>{UI["lbl_prec"]}</small></div>
        </div>'''
    raise ValueError(v)

CSS = f'''
@font-face {{ font-family: Disp; src: url(file://{FONTS}/ArchivoBlack.ttf); }}
@font-face {{ font-family: Body; src: url(file://{FONTS}/Inter-Regular.ttf); }}
@font-face {{ font-family: Body; font-weight: 600; src: url(file://{FONTS}/Inter-SemiBold.ttf); }}
* {{ box-sizing: border-box; margin: 0; }}
html, body {{ width: 1920px; height: 1080px; background: {PAPER}; color: {INK}; font-family: Body, sans-serif; overflow: hidden; }}
.top {{ position: absolute; left: 90px; right: 90px; top: 50px; display: flex; justify-content: space-between; align-items: center; font-size: 26px; color: {DIM}; }}
.top img {{ height: 64px; vertical-align: middle; margin-right: 18px; }}
.top .k {{ color: {GOLD}; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; font-size: 24px; }}
.left {{ position: absolute; left: 90px; top: 165px; width: 1040px; }}
h1 {{ font-family: Disp; font-size: 64px; line-height: 1.08; font-weight: normal; }}
.rule {{ width: 120px; height: 8px; background: {GOLD}; margin: 34px 0 40px; }}
ul {{ list-style: none; padding: 0; }}
li {{ font-size: 35px; line-height: 1.28; margin-bottom: 22px; padding-left: 46px; position: relative; color: {DIM}; }}
li::before {{ content: ""; position: absolute; left: 0; top: 17px; width: 18px; height: 18px; background: #3a4350; border-radius: 3px; }}
li.cur {{ color: {INK}; font-weight: 600; }}
li.cur::before {{ background: {GOLD}; }}
.panel {{ position: absolute; right: 90px; top: 175px; width: 640px; height: 760px; background: {CARD}; border-radius: 22px; display: flex; align-items: center; justify-content: center; }}
.icon {{ width: 400px; height: 400px; fill: none; stroke: {GOLD}; stroke-width: 7; stroke-linecap: round; stroke-linejoin: round; }}
.logo {{ width: 470px; }}
.pictos {{ display: grid; grid-template-columns: repeat(2, 230px); gap: 20px 60px; justify-content: center; }}
.pictos img {{ width: 230px; height: 150px; object-fit: contain; transition: none; }}
.pictos img:nth-child(7) {{ grid-column: 1 / span 2; justify-self: center; }}
.off {{ opacity: .22; }}
.label {{ width: 540px; background: #fff; color: #111; border-radius: 10px; padding: 26px 30px; font-size: 26px; line-height: 1.3; }}
.label .lp {{ margin-bottom: 16px; }}
.lrow {{ display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }}
.lrow img {{ width: 112px; height: 112px; }}
.sig {{ font-family: Disp; font-size: 40px; color: #c00; margin-left: 6px; }}
.sit {{ background: {CARD}; border-left: 8px solid {GOLD}; border-radius: 10px; padding: 26px 32px; font-size: 34px; line-height: 1.35; font-style: italic; margin-bottom: 26px; }}
.dolabel {{ color: {GOLD}; font-weight: 600; font-size: 28px; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 14px; }}
ul.sc li {{ font-size: 31px; margin-bottom: 16px; }}
ul.sc li::before {{ top: 14px; }}
.scn {{ display: flex; flex-direction: column; align-items: center; }}
.q {{ font-family: Disp; font-size: 330px; line-height: 1; color: {GOLD}; }}
.wwyd {{ font-family: Disp; font-size: 54px; text-align: center; line-height: 1.1; margin-top: 10px; }}
.icon.sm {{ width: 300px; height: 300px; }}
.dothis {{ margin-top: 40px; font-family: Disp; font-size: 50px; color: #7fd19d; }}
.bar {{ position: absolute; left: 0; bottom: 0; height: 10px; background: {GOLD}; }}
.center {{ position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }}
.center .logo {{ width: 420px; margin-bottom: 40px; }}
.center .k {{ color: {GOLD}; font-weight: 600; letter-spacing: 3px; text-transform: uppercase; font-size: 30px; margin-bottom: 22px; }}
.center h1 {{ position: static; width: 1400px; font-size: 76px; }}
'''

def slide_html(si, slide, step_i):
    bullets = [st[0] for st in slide['steps'][:step_i + 1] if st[0]]
    progress = (si + (step_i + 1) / len(slide['steps'])) / len(SLIDES) * 100
    bar = f'<div class="bar" style="width:{progress:.2f}%"></div>'
    if slide['key'] == 'intro':
        body = f'''<div class="center"><img class="logo" src="file://{LOGO}"><div class="k">{disp(slide['kicker'])}</div><h1>{disp(slide['title'])}</h1></div>'''
    else:
        cur = len(bullets) - 1 if slide['steps'][step_i][0] else -1
        situation = f'<div class="sit">{disp(slide["situation"])}</div>' if slide.get('situation') else ''
        dolabel = f'<div class="dolabel">{UI["do_label"]}</div>' if situation and bullets else ''
        lis = ''.join(f'<li class="{"cur" if i == cur else ""}">{disp(b)}</li>' for i, b in enumerate(bullets))
        body = f'''<div class="top"><span><img src="file://{LOGO}">State of the Arc Welding &amp; Services</span><span class="k">{disp(slide['kicker'])}</span></div>
          <div class="left"><h1>{disp(slide['title'])}</h1><div class="rule"></div>{situation}{dolabel}<ul class="{'sc' if situation else ''}">{lis}</ul></div>
          <div class="panel">{visual_html(slide, step_i)}</div>'''
    return f'<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body>{body}{bar}</body></html>'

def render_frames():
    frames = []
    for si, s in enumerate(SLIDES):
        for st in range(len(s['steps'])):
            name = f'{si:02d}_{st:02d}'
            h = os.path.join(OUT, name + '.html'); png = os.path.join(OUT, name + '.png')
            open(h, 'w').write(slide_html(si, s, st))
            subprocess.run([CHROME, '--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
                            '--window-size=1920,1080', f'--screenshot={png}', f'file://{h}'], check=True, capture_output=True)
            frames.append(png)
    return frames

def narrate():
    from kokoro_onnx import Kokoro
    k = Kokoro(os.path.join(HERE, 'kokoro-v1.0.int8.onnx'), os.path.join(HERE, 'voices-v1.0.bin'))
    clips = []
    for si, s in enumerate(SLIDES):
        for st, step in enumerate(s['steps']):
            text = step[1]
            wav = os.path.join(OUT, 'tts_' + hashlib.md5(f'{VOICE}|{text}'.encode()).hexdigest()[:16] + '.wav')
            if not os.path.exists(wav):
                a, sr = k.create(text, voice=VOICE, speed=1.0, lang=LANG)
                assert sr == SR
                sf.write(wav, a, sr)
            clips.append(wav)
        print('narrated', s['key'], flush=True)
    return clips

def assemble(frames, clips, dest):
    # Timeline: each step shows its frame while its line plays. Durations snap to whole frames
    # so the picture and the single audio track stay in sync.
    audio, concat, t = [], [], 0.0
    steps = [(si, st) for si, s in enumerate(SLIDES) for st in range(len(s['steps']))]
    for (si, st), png, wav in zip(steps, frames, clips):
        a, _ = sf.read(wav, dtype='float32')
        pre = LEAD_IN if st == 0 else 0.0
        post = TAIL if st == len(SLIDES[si]['steps']) - 1 else GAP
        step = SLIDES[si]['steps'][st]
        if len(step) > 2:
            post += step[2]
        dur = round((pre + len(a) / SR + post) * FPS) / FPS
        seg = np.zeros(int(round(dur * SR)), dtype='float32')
        seg[int(pre * SR):int(pre * SR) + len(a)] = a[: len(seg) - int(pre * SR)]
        audio.append(seg)
        concat.append(f"file '{png}'\nduration {dur:.6f}")
        t += dur
    concat.append(f"file '{frames[-1]}'")
    full = np.concatenate(audio)
    peak = np.abs(full).max(); full = full / peak * 0.89 if peak > 0 else full
    sf.write(os.path.join(OUT, 'narration.wav'), full, SR)
    open(os.path.join(OUT, 'frames.txt'), 'w').write('ffconcat version 1.0\n' + '\n'.join(concat) + '\n')
    # Audio: normalized to standard phone/TV loudness, 48 kHz stereo.
    subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', os.path.join(OUT, 'frames.txt'),
                    '-i', os.path.join(OUT, 'narration.wav'),
                    '-vf', f'fps={FPS},format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-tune', 'stillimage',
                    '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-ar', '48000', '-ac', '2', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', dest], check=True)
    return t

if __name__ == '__main__':
    only = sys.argv[1] if len(sys.argv) > 1 else 'all'
    frames = render_frames()
    if only == 'frames':
        print(len(frames), 'frames'); sys.exit()
    clips = narrate()
    dest = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, getattr(_mod, 'OUTPUT', 'HazCom-Training.mp4'))
    t = assemble(frames, clips, dest)
    print(f'{dest}: {t/60:.1f} min, {len(frames)} steps')
