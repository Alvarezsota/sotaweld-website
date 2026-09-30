"""Assemble the new hire package PDF.

Pages live in pages_*.html, each a <div data-key="..." class="page"> block.
ORDER decides the sequence; section numbers ({{#}}) and cross-references
({{ref:key}}) are filled in from it, so pages can be added or moved freely.
Official government forms are then merged in after their summary pages and
the employer fields pre-filled.
"""
import glob, os, re, subprocess, sys
import pymupdf

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
EMPLOYER = 'State of the Arc Welding & Services LLC'
ADDRESS = '10234 West 64th Street, Odessa, TX 79764'
EIN = '99-1328746'

ORDER = [
    'cover', 'offer', 'info', 'ua', 'fcra', 'bgauth', 'refs', 'dl', 'certs',
    'i9', 'tax', 'dd', 'deduct', 'wc', 'rules', 'injury', 'incident', 'ppe',
    'hazcom', 'ack',
]
# official forms: (after page key, file, pages to include (0-based), marker text)
INSERTS = [
    ('i9', 'i9.pdf', None, None),
    ('tax', 'fw4.pdf', None, None),
]

pages = {}
for f in sorted(glob.glob(f'{HERE}/pages_*.html')):
    for block in re.split(r'(?=<div data-key=")', open(f).read()):
        m = re.match(r'<div data-key="([a-z0-9]+)"', block)
        if m:
            assert m.group(1) not in pages, f'duplicate page {m.group(1)}'
            pages[m.group(1)] = block.strip()

missing = [k for k in ORDER if k not in pages]
unused = [k for k in pages if k not in ORDER]
assert not missing, f'missing pages: {missing}'
assert not unused, f'pages not in ORDER: {unused}'

num = {k: i for i, k in enumerate(ORDER)}  # cover = 0, so first section = 1
html = []
for k in ORDER:
    b = pages[k].replace('{{#}}', str(num[k]))
    html.append(b)
body = '\n\n'.join(html)
body = re.sub(r'\{\{ref:([a-z0-9]+)\}\}', lambda m: str(num[m.group(1)]), body)
assert '{{' not in body, re.findall(r'.{20}\{\{.{20}', body)
open(f'{HERE}/package.html', 'w').write(open(f'{HERE}/head.html').read() + body + '\n</body></html>\n')

subprocess.run([CHROME, '--headless', '--no-sandbox', '--disable-gpu', '--no-pdf-header-footer',
                f'--print-to-pdf={HERE}/base.pdf', f'file://{HERE}/package.html'],
               check=True, capture_output=True)

base = pymupdf.open(f'{HERE}/base.pdf')
# locate each keyed page's last PDF page by its footer label
def page_of(key):
    label = 'Cover' if key == 'cover' else f'Section {num[key]}'
    hits = [i for i, p in enumerate(base) if p.get_text().rstrip().endswith(label)]
    assert hits, f'page for {key} not found'
    return hits[-1]

html_pages = len(base)
for key, fname, sel, _ in sorted(INSERTS, key=lambda x: -num[x[0]]):
    src = pymupdf.open(f'{HERE}/{fname}')
    at = page_of(key) + 1
    if sel is None:
        base.insert_pdf(src, start_at=at)
    else:
        for n, pno in enumerate(sel):
            base.insert_pdf(src, from_page=pno, to_page=pno, start_at=at + n)

def fill(page, suffix_to_value):
    hit = 0
    for w in page.widgets():
        bare = w.field_name.split('.')[-1].split('[')[0]
        for name, val in suffix_to_value.items():
            if bare == name:
                w.field_value = val
                w.text_color = (0, 0, 0)
                if '\n' in val:
                    w.text_fontsize = 8
                w.update()
                hit += 1
    assert hit == len(suffix_to_value), (hit, suffix_to_value)

for p in base:
    t = p.get_text()
    if 'Employee’s Withholding Certificate' in t and 'Form' in t and 'W-4' in t:
        fill(p, {'f1_12': f'{EMPLOYER}\n{ADDRESS}', 'f1_14': EIN})
    if 'Employment Eligibility Verification' in t and 'Section 2. Employer Review' in t:
        fill(p, {'Employers Business or Org Name': EMPLOYER,
                 'Employers Business or Org Address': ADDRESS})

# The package is printed, so flatten the forms: filled values become part of the page.
base.bake()
base.save(f'{OUT}/SOTA-New-Hire-Package.pdf', garbage=3, deflate=True)
out = pymupdf.open(f'{OUT}/SOTA-New-Hire-Package.pdf')
print(f'{html_pages} package pages + official forms = {len(out)} pages, '
      f'{sum(1 for p in out for _ in p.widgets())} form fields')
for k in ORDER:
    print(f'  {num[k]:>2} {k}')
