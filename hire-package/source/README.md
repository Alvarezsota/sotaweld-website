# New hire package — source

`SOTA-New-Hire-Package.pdf` and `.docx` one folder up are built from these files.

- `head.html`, `pages_existing.html`, `pages_new.html` — the package pages. Each page is a
  `<div data-key="...">` block. Section numbers (`{{#}}`) and cross-references
  (`{{ref:key}}`) are filled in from `ORDER` in `render.py`.
- `i9.pdf`, `fw4.pdf` — official USCIS Form I-9 and IRS Form W-4. Replace these when a new
  edition comes out; `render.py` merges them in and pre-fills the employer name and address.
- `build.js` — the editable Word version (same sections, its own `ORDER` list).

Rebuild:

    python3 render.py                                # PDF (needs pymupdf + Chromium)
    npm install docx && node build.js ../SOTA-New-Hire-Package.docx
