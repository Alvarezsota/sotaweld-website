"""The emailable JSA.

Same document as the portal's print view, but as a PDF with real form fields,
so a man Gilbert emails it to -- an EH2 safety rep, a hand from another
contractor, somebody who will never have a login here -- can type into it on a
phone, sign it and send it back.

Built with reportlab's AcroForm. Two pages: the sheet on one, the signatures on
the other, because a signature block that splits across a page break is the
first thing anybody argues about.
"""
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from reportlab.lib.colors import HexColor, black, white

W, H = letter
M = 36.0                     # half-inch margins all round
INK = HexColor('#111111')
RULE = HexColor('#999999')
HEAD = HexColor('#ECEFF3')
SOFT = HexColor('#555555')

PPE_MIN = [
    'Type II hard hat',
    'Safety glasses, ANSI Z87.1',
    'Safety-toed boots',
    'Gloves to suit the hazard',
    'Full-length pants',
    'Shirt covering the shoulders',
    'High-visibility vest or shirt',
]
PPE_EXTRA = [
    'FR clothing', 'Welding hood and leathers', 'Face shield', 'Goggles',
    'Hearing protection', 'Respirator (fit tested)', 'Arc flash PPE',
    'Chemical-resistant PPE', 'Fall harness and lanyard', 'Metatarsal guards',
    'Insulating boots or gloves', 'Personal gas monitor',
]
PERMITS = [
    ('Hot Work', 'Welding, burning, grinding, or any ignition source in a classified area'),
    ('Working at Heights', 'Anything needing active fall protection'),
    ('Energized Electrical Work', 'Work on energized equipment above 50V'),
    ('Excavation and Trenching', 'Trench over 5 ft, or known or suspected hazards'),
    ('Critical Lift', 'Over 100,000 lb, or 75% of the crane’s capacity, or two cranes'),
    ('Confined Space', 'Permit required confined space entry'),
    ('Silica Exposure Control Plan', 'Work that can put respirable silica in the air'),
]

c = canvas.Canvas('/home/user/sotaweld-website/employee/forms/SOTA-JSA-fillable.pdf',
                  pagesize=letter)
c.setTitle('Job Safety Analysis — State of the Arc Welding & Services LLC')
c.setAuthor('State of the Arc Welding & Services LLC')
c.setSubject('Daily Job Safety Analysis — fillable')
form = c.acroForm


def text(x, y, s, size=9, colour=INK, font='Helvetica'):
    c.setFillColor(colour)
    c.setFont(font, size)
    c.drawString(x, y, s)


def label(x, y, s, size=6.5):
    c.setFillColor(SOFT)
    c.setFont('Helvetica-Bold', size)
    c.drawString(x, y, s.upper())


def field(name, x, y, w, h, value='', size=9, lines=1, tip=''):
    form.textfield(
        name=name, tooltip=tip or name.replace('_', ' '),
        x=x, y=y, width=w, height=h, value=value,
        fontName='Helvetica', fontSize=size,
        borderWidth=0.6, borderColor=RULE, fillColor=white,
        textColor=INK, forceBorder=True,
        fieldFlags='multiline' if lines > 1 else '',
    )


def tick(name, x, y, size=11, tip=''):
    form.checkbox(
        name=name, tooltip=tip or name.replace('_', ' '),
        x=x, y=y, size=size,
        borderWidth=0.6, borderColor=RULE, fillColor=white,
        textColor=INK, forceBorder=True,
    )


def banner(sub):
    """The masthead. Same on both pages so either one stands on its own."""
    c.setFillColor(INK)
    c.setFont('Helvetica-Bold', 16)
    c.drawString(M, H - M - 10, 'Job Safety Analysis')
    c.setFillColor(SOFT)
    c.setFont('Helvetica', 7.5)
    c.drawString(M, H - M - 22,
                 'State of the Arc Welding & Services LLC  ·  Odessa, TX  ·  (432) 248-1455  ·  sotaweld.com')
    c.setFont('Helvetica-Bold', 7.5)
    c.drawRightString(W - M, H - M - 10, sub)
    c.setStrokeColor(INK)
    c.setLineWidth(1.4)
    c.line(M, H - M - 30, W - M, H - M - 30)
    return H - M - 30


def headrow(x, y, w, h, title):
    c.setFillColor(HEAD)
    c.rect(x, y, w, h, stroke=0, fill=1)
    c.setStrokeColor(RULE)
    c.setLineWidth(0.6)
    c.rect(x, y, w, h, stroke=1, fill=0)
    c.setFillColor(SOFT)
    c.setFont('Helvetica-Bold', 6.5)
    c.drawString(x + 4, y + h / 2 - 2.4, title.upper())


def section(y, title):
    c.setFillColor(SOFT)
    c.setFont('Helvetica-Bold', 7)
    c.drawString(M, y, title.upper())
    c.setStrokeColor(RULE)
    c.setLineWidth(0.5)
    c.line(M, y - 3.5, W - M, y - 3.5)
    return y - 3.5


# =========================================================== page 1
y = banner('Fill in, sign, send back')
FW = W - 2 * M

# ---- the head of the sheet: two columns of boxes
y -= 16
rows = [
    [('Date', 'date', 1.0), ('Crew lead', 'crew_lead', 1.0)],
    [('Job', 'job', 1.0), ('Site / facility', 'site', 1.0)],
    [('Client / operator', 'client', 1.0), ('Hours (start to stop)', 'hours', 1.0)],
    [('Weather / heat index', 'weather', 1.0), ('Number in crew', 'crew_size', 1.0)],
]
for r in rows:
    x = M
    for title, name, frac in r:
        w = (FW / 2) * frac
        label(x, y - 7, title)
        field(name, x, y - 23, w - 10, 14)
        x += w
    y -= 29

label(M, y - 7, 'Scope of work — what this crew is doing today')
field('scope', M, y - 45, FW, 36, lines=3)
y -= 54

# ---- steps, hazards, controls
y = section(y, 'Steps, hazards and controls') - 4
colw = [26, FW * 0.26, FW * 0.33, 0]
colw[3] = FW - colw[0] - colw[1] - colw[2]
hh = 13
x = M
for title, w in zip(['#', 'Step', 'Hazard', 'How it is controlled'], colw):
    headrow(x, y - hh, w, hh, title)
    x += w
y -= hh

ROW_H = 26
for i in range(1, 9):
    x = M
    # the number is printed, not typed
    c.setStrokeColor(RULE)
    c.setLineWidth(0.6)
    c.rect(x, y - ROW_H, colw[0], ROW_H, stroke=1, fill=0)
    c.setFillColor(SOFT)
    c.setFont('Helvetica-Bold', 8)
    c.drawCentredString(x + colw[0] / 2, y - ROW_H / 2 - 3, str(i))
    x += colw[0]
    for key, w in zip(['step', 'haz', 'ctl'], colw[1:]):
        field(f'{key}_{i}', x, y - ROW_H, w, ROW_H, size=7.5, lines=3)
        x += w
    y -= ROW_H

# ---- PPE and permits, side by side
y = section(y - 12, 'PPE for this work') - 4
half = FW / 2 - 8
c.setFillColor(SOFT)
c.setFont('Helvetica-Oblique', 6.5)
c.drawString(M, y - 8, 'The first seven are required everywhere on site. Tick what else today’s work needs.')
y -= 16

col_x = [M, M + FW / 3, M + 2 * FW / 3]
rows_per = 7
allppe = [(p, True) for p in PPE_MIN] + [(p, False) for p in PPE_EXTRA]
for n, (name, fixed) in enumerate(allppe):
    cx = col_x[n // rows_per]
    cy = y - (n % rows_per) * 14
    tick(f'ppe_{n}', cx, cy - 10, size=9, tip=name)
    text(cx + 13, cy - 8, name + ('  (required)' if fixed else ''), size=7.5,
         colour=INK if not fixed else SOFT)
y -= rows_per * 14 + 6

y = section(y, 'High risk work permits — hand the permit in WITH this JSA') - 4
y -= 6
for n, (name, why) in enumerate(PERMITS):
    tick(f'permit_{n}', M, y - 10, size=9, tip=name)
    text(M + 13, y - 8, name, size=8, font='Helvetica-Bold')
    text(M + 13 + c.stringWidth(name, 'Helvetica-Bold', 8) + 6, y - 8, '— ' + why,
         size=7, colour=SOFT)
    y -= 13

c.setFillColor(SOFT)
c.setFont('Helvetica', 6.5)
c.drawString(M, M - 4,
             'Page 1 of 2  ·  Hand this in before work begins in the morning. '
             'If the scope changes or a new hazard turns up, stop work and revise it.')
c.showPage()

# =========================================================== page 2
y = banner('Signatures — page 2 of 2')

y = section(y - 16, 'If something goes wrong') - 4
for title, name in [('Muster point', 'muster'),
                    ('Nearest hospital', 'hospital'),
                    ('Site safety rep and his number', 'rep'),
                    ('Who calls 911, and from where', 'caller')]:
    y -= 10
    label(M, y, title)
    field(name, M, y - 17, FW, 15)
    y -= 22

y -= 8
tick('stop_work', M, y - 11, size=11, tip='Stop work authority briefed')
c.setFillColor(INK)
c.setFont('Helvetica', 7.5)
lines = [
    'Every man on this crew has been told he has STOP WORK AUTHORITY. If the scope changes or a new hazard',
    'shows up, work stops, this JSA is changed, and it is re-signed and re-approved by the crew and the site',
    'safety rep before anybody carries on.',
]
for n, ln in enumerate(lines):
    c.drawString(M + 17, y - 6 - n * 9.5, ln)
y -= 52

y = section(y, 'Signatures — everybody doing this work signs it') - 4
colw = [FW * 0.26, FW * 0.22, FW * 0.18, 0]
colw[3] = FW - sum(colw[:3])
hh = 13
x = M
for title, w in zip(['Printed name', 'Company', 'Title / craft', 'Signature'], colw):
    headrow(x, y - hh, w, hh, title)
    x += w
y -= hh

SIG_H = 24
for i in range(1, 13):
    x = M
    for key, w in zip(['sig_name', 'sig_co', 'sig_craft', 'sig_mark'], colw):
        field(f'{key}_{i}', x, y - SIG_H, w, SIG_H, size=8)
        x += w
    y -= SIG_H

y = section(y - 14, 'Reviewed and approved') - 4
x = M
for title, w in zip(['Site safety rep', 'Company', 'Date', 'Signature'], colw):
    headrow(x, y - hh, w, hh, title)
    x += w
y -= hh
x = M
for key, w in zip(['appr_name', 'appr_co', 'appr_date', 'appr_mark'], colw):
    field(key, x, y - 28, w, 28, size=8)
    x += w
y -= 28

c.setFillColor(SOFT)
c.setFont('Helvetica', 6.5)
foot = [
    'Filling out a JSA: understand the job scope, break the job into clear manageable steps, identify the potential hazards',
    'of each step, and specify how those hazards will be mitigated. A pre-written JSA may be used as a starting point, but it',
    'must be considered and made job specific for that day. Keep a copy on you while you work.',
]
for n, ln in enumerate(foot):
    c.drawString(M, y - 16 - n * 9, ln)

c.setFont('Helvetica', 6.5)
c.drawString(M, M - 4, 'Page 2 of 2  ·  State of the Arc Welding & Services LLC  ·  (432) 248-1455')
c.showPage()
c.save()
print('written')
