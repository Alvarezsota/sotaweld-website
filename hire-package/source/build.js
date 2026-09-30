const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
  AlignmentType, WidthType, BorderStyle, ShadingType, LevelFormat, PageBreak,
  Header, Footer, PageNumber, TabStopType,
} = require('docx');

const CO = 'State of the Arc Welding & Services LLC';
const ADDR = '10234 West 64th Street, Odessa, TX 79764';
const PHONE = '(432) 248-1455';
const EMAIL = 'g.alvarez@sotaweld.com';
const GOLD = 'B8860B', DARK = '1F1F1F', GREY = '666666';
const W = 10080; // content width (letter, 0.75in margins)

const logo = fs.readFileSync(require('path').join(__dirname, 'sota-logo.png'));

const t = (text, o = {}) => new TextRun({ text, font: 'Arial', size: 21, ...o });
const p = (runs, o = {}) => new Paragraph({ spacing: { after: 120 }, ...o, children: Array.isArray(runs) ? runs : [t(runs)] });
const bold = (s) => t(s, { bold: true });
const title = (s, sub) => [
  new Paragraph({ spacing: { after: 60 }, children: [t(s, { bold: true, size: 32, color: DARK })] }),
  new Paragraph({
    spacing: { after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: GOLD, space: 4 } },
    children: [t(sub || '', { size: 19, color: GREY, italics: true })],
  }),
];
const h2 = (s) => new Paragraph({ spacing: { before: 200, after: 100 }, children: [t(s, { bold: true, size: 24, color: GOLD })] });
const bullet = (runs) => new Paragraph({ numbering: { reference: 'b', level: 0 }, spacing: { after: 60 }, children: Array.isArray(runs) ? runs : [t(runs)] });
const box = (runs) => new Paragraph({ numbering: { reference: 'box', level: 0 }, spacing: { after: 80 }, children: Array.isArray(runs) ? runs : [t(runs)] });
const brk = () => new Paragraph({ children: [new PageBreak()] });

const line = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };

// A row of labelled blanks: [[label, widthDxa], ...]
function fields(rows) {
  return new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: rows[0].map(([, w]) => w),
    borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
    rows: rows.map((r) => new TableRow({
      children: r.map(([label, w]) => new TableCell({
        width: { size: w, type: WidthType.DXA },
        borders: { top: none, left: none, right: none, bottom: line },
        margins: { top: 60, bottom: 20, left: 60, right: 120 },
        children: [
          new Paragraph({ spacing: { before: 280, after: 0 }, children: [t(' ')] }),
          new Paragraph({ spacing: { after: 0 }, children: [t(label, { size: 15, color: GREY })] }),
        ],
      })),
    })),
  });
}
// every row must sum to W; build helpers so it always does
const row = (...labels) => { const w = Math.floor(W / labels.length); return labels.map((l, i) => [l, i === labels.length - 1 ? W - w * (labels.length - 1) : w]); };
const rowW = (...pairs) => pairs; // explicit widths
const sig = () => fields([rowW(['Employee / Applicant Signature', 5040], ['Printed Name', 3240], ['Date', 1800])]);
const spacer = (after = 120) => new Paragraph({ spacing: { after }, children: [] });

// Section numbers come from this order, so pages can be added or moved freely.
const ORDER = ['offer', 'info', 'ua', 'fcra', 'bgauth', 'refs', 'dl', 'certs', 'i9', 'tax', 'dd', 'deduct', 'wc', 'rules', 'injury', 'incident', 'ppe', 'hazcom', 'ack'];
const SEC = Object.fromEntries(ORDER.map((k, i) => [k, i + 1]));

// Shaded note callout
function note(runs, fill = 'FFF6DD') {
  return new Table({
    width: { size: W, type: WidthType.DXA }, columnWidths: [W],
    rows: [new TableRow({ children: [new TableCell({
      width: { size: W, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill, color: 'auto' },
      borders: { top: none, bottom: none, right: none, left: { style: BorderStyle.SINGLE, size: 24, color: GOLD } },
      margins: { top: 120, bottom: 120, left: 200, right: 200 },
      children: (Array.isArray(runs[0]) ? runs : [runs]).map((r) => new Paragraph({ spacing: { after: 60 }, children: r })),
    })] })],
  });
}

// ---------- Cover ----------
const cover = [
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 600, after: 200 },
    children: [new ImageRun({ type: 'png', data: logo, transformation: { width: 220, height: 167 } })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [t('NEW HIRE PACKAGE', { bold: true, size: 48, color: DARK })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 }, children: [t(CO, { size: 24, color: GOLD, bold: true })] }),
  fields([row('Employee Name'), rowW(['Position', 5040], ['Start Date', 5040]), rowW(['Hiring Manager', 5040], ['Date Package Given', 5040])]),
  spacer(300),
  h2('What to bring on your first day'),
  box([bold('This package, '), t('filled out and signed on every signature line')]),
  box([bold('Identity & work-authorization documents '), t(`for the federal Form I-9 (see Section ${SEC.i9} for the list you can pick from)`)]),
  box([bold('Valid driver’s license '), t('(required if the job involves driving a company vehicle or trailer)')]),
  box([bold('Names and phone numbers of 3 references '), t(`and your last two employers (Section ${SEC.refs})`)]),
  box([bold('Safety cards and welding certifications '), t(`— OSHA, H2S, SafeLand, TWIC, weld certs (Section ${SEC.certs})`)]),
  box([bold('Social Security number '), t('for payroll and your W-4')]),
  box([bold('Voided check or bank direct-deposit letter '), t(`if you want direct deposit (Section ${SEC.dd})`)]),
  spacer(),
  note([t('Welcome aboard. ', { bold: true }), t('Any offer of employment is conditional on a negative drug screen and a satisfactory background check. Questions about anything in this package: '), t(`${PHONE} · ${EMAIL}`, { bold: true })]),
  brk(),
];

// ---------- 1. Employee info ----------
const info = [
  ...title(`${SEC.info}. Employee Information`, 'Keep this current — tell the office if anything changes.'),
  h2('Personal'),
  fields([
    rowW(['Legal First Name', 3600], ['Middle', 2160], ['Last Name', 4320]),
    rowW(['Street Address', 6480], ['Apt / Unit', 3600]),
    rowW(['City', 4320], ['State', 2160], ['ZIP', 3600]),
    rowW(['Cell Phone', 3360], ['Email', 6720]),
    rowW(['Date of Birth', 3360], ['Social Security Number', 3360], ['Preferred Name', 3360]),
  ]),
  h2('Emergency Contact'),
  fields([
    rowW(['Name', 4320], ['Relationship', 2400], ['Phone', 3360]),
    rowW(['Second Contact Name', 4320], ['Relationship', 2400], ['Phone', 3360]),
  ]),
  h2('Position (office use)'),
  fields([
    rowW(['Job Title', 4320], ['Pay Rate', 2400], ['Hourly / Salary', 3360]),
    rowW(['Welding Certifications Held', 6720], ['Shirt / Boot Size', 3360]),
  ]),
  h2('Direct Deposit'),
  p([t('Want your pay deposited straight to your bank? Fill out the '), bold(`Direct Deposit Authorization in Section ${SEC.dd}`), t('.')], { spacing: { after: 0 } }),
  sig(),
  brk(),
];

// ---------- 2. Drug test consent ----------
const ua = [
  ...title(`${SEC.ua}. Drug & Alcohol Testing (UA) Consent`, 'Pre-employment urinalysis and ongoing testing.'),
  p([t('Welding and field work is safety-sensitive. '), t(CO), t(' is a drug-free workplace. As a condition of employment I will take a pre-employment urine drug screen, and I understand I may also be tested:')]),
  bullet('Randomly, while employed'),
  bullet('After any accident or incident on the job or on a customer site'),
  bullet('When a supervisor has reasonable suspicion of impairment'),
  bullet('When a customer, pipeline operator, or site owner requires it (including DOT-regulated programs, if applicable)'),
  p([t('I understand that:')], { spacing: { before: 120, after: 80 } }),
  bullet('Testing will be done by a certified collection site and laboratory, and a non-negative result will be reviewed by a Medical Review Officer, who will give me a chance to explain any prescriptions.'),
  bullet('A positive result, an adulterated or substituted sample, or refusing to test can mean the job offer is withdrawn or my employment is terminated.'),
  bullet('Results are kept confidential and separate from my personnel file, and shared only with people who need them or as the law requires.'),
  p([bold('Current prescription medications '), t('(optional — you may give this to the MRO instead):')], { spacing: { before: 160, after: 0 } }),
  fields([row(''), row('')]),
  spacer(200),
  p([t('I consent to drug and alcohol testing as described above and authorize the collection site, laboratory and Medical Review Officer to release the results to '), t(CO), t('.')]),
  sig(),
  spacer(),
  h2('Office use'),
  fields([rowW(['Collection Site', 4320], ['Date Collected', 2880], ['Result (Neg / Non-Neg)', 2880])]),
  brk(),
];

// ---------- 3. FCRA disclosure (must stand alone) ----------
const fcraDisclosure = [
  ...title(`${SEC.fcra}. Background Check Disclosure`, 'Required by the federal Fair Credit Reporting Act. Please read — no signature on this page.'),
  p([t(CO), t(' (the “Company”) may obtain a '), bold('consumer report'), t(' and/or '), bold('investigative consumer report'), t(' about you from a consumer reporting agency for employment purposes. This may happen before you are hired and, if you are hired, at any time during your employment.')]),
  p('These reports may include information about your character, general reputation, personal characteristics and mode of living, and may include: criminal history, identity and Social Security number verification, prior employment verification, education and certification verification, and motor vehicle / driving records.'),
  p('An investigative consumer report may involve personal interviews with sources such as former employers and references. You have the right to ask, in writing, for a complete and accurate disclosure of the nature and scope of any investigative consumer report.'),
  p([t('Background screening company used by the Company:')], { spacing: { before: 200, after: 0 } }),
  fields([rowW(['Screening Company Name', 5040], ['Phone', 2520], ['Website', 2520]), row('Mailing Address')]),
  spacer(200),
  p([t('You are entitled to a copy of '), bold('“A Summary of Your Rights Under the Fair Credit Reporting Act,”'), t(' which is attached to this package. A criminal record does not automatically disqualify you; the Company considers the nature of the offense, how long ago it was, and whether it relates to the job.')]),
  brk(),
];

// ---------- 4. Background authorization ----------
const bgAuth = [
  ...title(`${SEC.bgauth}. Background Check Authorization`, 'Sign to allow the Company to run the background check described on the previous page.'),
  p([t('I have read the Background Check Disclosure and the Summary of Rights under the FCRA. I authorize '), t(CO), t(' and its consumer reporting agency to obtain consumer reports and investigative consumer reports about me for employment purposes. This authorization stays valid during my employment unless I revoke it in writing.')]),
  p('I authorize courts, law enforcement agencies, past employers, schools, certification bodies and state motor-vehicle departments to release information about me to the Company’s consumer reporting agency. A copy of this form is as valid as the original.'),
  h2('Information needed to run the check'),
  fields([
    rowW(['Full Legal Name', 5040], ['Other Names Used (maiden, alias)', 5040]),
    rowW(['Date of Birth', 3360], ['Social Security Number', 3360], ['Driver’s License # / State', 3360]),
    row('Current Address'),
    row('Previous Addresses in the Last 7 Years'),
  ]),
  spacer(200),
  p([t('☐  Check here if you would like a free copy of any consumer report the Company obtains about you.', { size: 19 })]),
  sig(),
  brk(),
];

// ---------- 5. Work history & references ----------
const employer = (n) => [
  p([bold(`Employer ${n}${n === 1 ? ' — most recent' : ''}`)], { spacing: { before: 160, after: 0 } }),
  fields([
    rowW(['Company Name', 4200], ['Supervisor / Foreman', 3240], ['Phone', 2640]),
    rowW(['Job Title / Craft', 3240], ['Dates (from – to)', 2400], ['Reason for Leaving', 4440]),
  ]),
  p([t('May we contact this employer?   ☐ Yes   ☐ No')], { spacing: { before: 100, after: 0 } }),
  fields([row('If No, why? (required \u2014 e.g. still working there)')]),
];
const refRows = [1, 2, 3].map((n) => rowW([`Reference ${n} — Name`, 3000], ['Relationship', 2040], ['Company', 2040], ['Phone', 2040], ['Yrs Known', 960]));
const refs = [
  ...title(`${SEC.refs}. Work History & References`, 'We will call these people, so please give numbers that work.'),
  h2('Last two employers'),
  ...employer(1),
  ...employer(2),
  h2('References'),
  p('List 3 people who know your work — at least one former supervisor or foreman (relationship: foreman, coworker, customer…). No relatives.', { spacing: { after: 0 } }),
  fields(refRows),
  p([t('I authorize '), t(CO), t(' to contact the employers and references listed above (except any I marked “No”) about my work history, skills, safety record and whether they would rehire me. I release them and the Company from liability for any information given in good faith.')], { spacing: { before: 200, after: 0 } }),
  sig(),
  h2('Office use — call log'),
  (() => {
    const cw = [1440, 1920, 1200, 5520];
    const c = (txt, w, head) => new TableCell({ width: { size: w, type: WidthType.DXA }, margins: { top: 50, bottom: 50, left: 120, right: 120 },
      shading: head ? { type: ShadingType.CLEAR, fill: '333333', color: 'auto' } : undefined,
      children: [new Paragraph({ spacing: { after: 0 }, children: [t(txt, { size: 18, ...(head ? { bold: true, color: 'FFFFFF' } : {}) })] })] });
    const hdr = ['Who', 'Called By / Date', 'Rehire?', 'Notes'];
    const who = ['Employer 1', 'Employer 2', 'Reference 1', 'Reference 2', 'Reference 3'];
    return new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: cw,
      rows: [new TableRow({ tableHeader: true, children: hdr.map((h, i) => c(h, cw[i], true)) }),
        ...who.map((w) => new TableRow({ children: [c(w, cw[0]), c('', cw[1]), c('☐ Y ☐ N', cw[2]), c('', cw[3])] }))] });
  })(),
  brk(),
];

// ---------- 6. Driver's license / MVR ----------
const dl = [
  ...title(`${SEC.dl}. Driver’s License & Driving Record`, 'For employees who drive company trucks, trailers or equipment to shop or field jobs.'),
  p('Attach a clear copy of the front and back of your license, or the office will copy it on your first day.'),
  fields([
    rowW(['License Number', 3360], ['State', 1680], ['Class (C / A / B / CDL)', 2520], ['Expiration Date', 2520]),
    rowW(['Endorsements / Restrictions', 5040], ['Medical Card Exp. (CDL only)', 5040]),
  ]),
  h2('Driving history'),
  p('In the past 3 years, have you had any moving violations, at-fault accidents, or a suspended or revoked license?   ☐ No   ☐ Yes — explain:'),
  fields([row(''), row('')]),
  spacer(200),
  p([t('I authorize '), t(CO), t(' to obtain my motor vehicle record (MVR) now and periodically while I am employed, for insurance and safety purposes. I will tell my supervisor '), bold('within 24 hours'), t(' if my license is suspended, revoked or expires, or if I receive a moving violation. I will not drive a company vehicle without a valid license.')]),
  sig(),
  spacer(),
  h2('Office use'),
  fields([rowW(['DL Copy on File (Y/N)', 3360], ['MVR Ordered (date)', 3360], ['Approved to Drive (Y/N)', 3360])]),
  brk(),
];

// ---------- 6. I-9 / work authorization ----------
const i9 = [
  ...title(`${SEC.i9}. Proof of Identity & Work Authorization (Form I-9)`, 'Every new employee in the U.S. completes a federal Form I-9 — citizens and non-citizens alike.'),
  bullet([bold('Section 1'), t(' of the I-9 is filled out by you, no later than your first day of work.')]),
  bullet([bold('Section 2'), t(' is completed by the office within 3 business days of your start date, after we look at your original documents in person.')]),
  bullet('Bring ORIGINAL, unexpired documents — photocopies and pictures on a phone cannot be accepted.'),
  bullet([bold('You choose '), t('which documents to show from the lists below. Bring either '), bold('one item from List A'), t(', OR '), bold('one from List B and one from List C'), t('.')]),
  spacer(80),
  (() => {
    const cw = [3360, 3360, 3360];
    const cell = (kids, fill) => new TableCell({
      width: { size: 3360, type: WidthType.DXA },
      shading: fill ? { type: ShadingType.CLEAR, fill, color: 'auto' } : undefined,
      margins: { top: 100, bottom: 100, left: 140, right: 140 },
      children: kids,
    });
    const head = (s, sub) => cell([
      new Paragraph({ spacing: { after: 20 }, children: [t(s, { bold: true, color: 'FFFFFF' })] }),
      new Paragraph({ spacing: { after: 0 }, children: [t(sub, { size: 16, color: 'FFFFFF' })] }),
    ], '333333');
    const list = (items) => cell(items.map((s) => new Paragraph({ numbering: { reference: 'b', level: 0 }, spacing: { after: 60 }, children: [t(s, { size: 18 })] })));
    return new Table({
      width: { size: W, type: WidthType.DXA }, columnWidths: cw,
      rows: [
        new TableRow({ tableHeader: true, children: [head('LIST A', 'Proves identity AND work authorization'), head('LIST B', 'Proves identity'), head('LIST C', 'Proves work authorization')] }),
        new TableRow({ children: [
          list(['U.S. Passport or Passport Card', 'Permanent Resident Card (Green Card)', 'Employment Authorization Document (Form I-766)', 'Foreign passport with Form I-94 or I-551 stamp', 'Other List A documents shown on the I-9 instructions']),
          list(['Driver’s license or state ID card with photo', 'School ID with photo', 'Voter registration card', 'U.S. military card or draft record', 'Native American tribal document']),
          list(['Social Security card (without work restrictions)', 'U.S. birth certificate (original or certified copy)', 'Certification of Birth Abroad (FS-545 / DS-1350)', 'U.S. Citizen ID Card (I-197)', 'Native American tribal document']),
        ] }),
      ],
    });
  })(),
  spacer(160),
  p([bold('Most common combo: '), t('Texas driver’s license (List B) + Social Security card or birth certificate (List C). A U.S. passport by itself also covers everything (List A).')]),
  p([bold('Citizenship / immigration status: '), t('you will state your status yourself in Section 1 of the I-9 (U.S. citizen, noncitizen national, lawful permanent resident, or noncitizen authorized to work).')]),
  note([t('Print the official Form I-9 from '), bold('uscis.gov/i-9'), t(' and attach it after this page. Page 1 is the form, page 2 is the full list of acceptable documents, Supplement A is only used if someone helps you fill out Section 1 or translates it for you, and Supplement B is for the office if your work authorization later needs to be re-checked.')]),
  brk(),
];

// ---------- 7. Tax forms ----------
const tax = [
  ...title(`${SEC.tax}. Tax Forms`, 'Payroll setup.'),
  bullet([bold('Form W-4 (Federal Withholding) — required. '), t('Tells us how much federal income tax to withhold from each paycheck. Print the official IRS Form W-4 (irs.gov/w4) and attach it after this page. Fill out and sign page 1 and turn it in; the other pages are IRS instructions and worksheets to keep.')]),
  bullet([bold('Texas state withholding — none. '), t('Texas has no state income tax, so there is no state withholding form.')]),
  bullet([bold('Form W-2 — you receive this from us. '), t('Every January, the Company mails you a W-2 showing what you earned and what was withheld the year before. Please keep your mailing address current so it reaches you.')]),
  spacer(),
  note([t('Office reminder: ', { bold: true }), t('report every new hire to the Texas Attorney General’s Employer New Hire Reporting program within 20 days of the start date (employer.oag.texas.gov). Most payroll services, including QuickBooks Payroll, file this for you.')]),
  brk(),
];

// ---------- 8. Direct deposit ----------
const acct = (heading, extra) => [
  p([bold(heading), t(extra, { color: GREY, size: 18 })], { spacing: { before: 160, after: 0 } }),
  fields([
    rowW(['Bank / Credit Union Name', 5760], ['Account type:  ☐ Checking   ☐ Savings', 4320]),
    rowW(['Routing Number (9 digits)', 4320], ['Account Number', 5760]),
  ]),
];
const dd = [
  ...title(`${SEC.dd}. Direct Deposit Authorization`, 'Optional. Get paid straight to your bank account on payday.'),
  p([bold('This is a:  '), t('☐ New set-up     ☐ Change to my accounts     ☐ Stop direct deposit (pay me by check)')]),
  fields([rowW(['Employee Name', 5040], ['Last 4 of SSN', 2520], ['Phone', 2520])]),
  ...acct('Account 1 — Primary ', '(gets the rest of your net pay)'),
  ...acct('Account 2 — Split ', '(optional, e.g. savings)'),
  p('Deposit to Account 2 each payday:   $ ____________   or   ________ % of net pay', { spacing: { before: 160, after: 160 } }),
  note([t('Attach a VOIDED CHECK or a direct-deposit letter from your bank. ', { bold: true }), t('A deposit slip is not accepted — its numbers can differ.')]),
  p('I authorize State of the Arc Welding & Services LLC and its bank or payroll provider to deposit my pay into the account(s) above and, if a deposit is made in error, to reverse or correct that entry. This authorization stays in effect until I give the Company written notice to change or cancel it, allowing reasonable time (usually one to two pay periods) to act on it. Until the first direct deposit goes through, I may be paid by check. If an account is closed or the numbers are wrong, I will tell the office right away.', { spacing: { before: 160, after: 0 } }),
  fields([rowW(['Employee Signature', 5040], ['Printed Name', 3240], ['Date', 1800])]),
  h2('Office use'),
  fields([row('Entered in Payroll By', 'Date Entered', 'First Pay Date on Deposit')]),
  brk(),
];

// Bordered table with a dark header row. widths must sum to W.
function grid(headers, widths, rows, { size = 18, minH = 360 } = {}) {
  const cell = (txt, w, head) => new TableCell({
    width: { size: w, type: WidthType.DXA },
    margins: { top: 50, bottom: 50, left: 110, right: 110 },
    shading: head ? { type: ShadingType.CLEAR, fill: '333333', color: 'auto' } : undefined,
    children: [new Paragraph({ spacing: { after: 0 }, children: Array.isArray(txt) ? txt : [t(txt, { size, ...(head ? { bold: true, color: 'FFFFFF' } : {}) })] })],
  });
  return new Table({
    width: { size: W, type: WidthType.DXA }, columnWidths: widths,
    rows: [
      ...(headers ? [new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, widths[i], true)) })] : []),
      ...rows.map((r) => new TableRow({ height: { value: minH, rule: 'atLeast' }, children: r.map((c, i) => cell(c, widths[i], false)) })),
    ],
  });
}
const sigAs = (label) => fields([rowW([label, 5040], ['Printed Name', 3240], ['Date', 1800])]);

// ---------- Offer letter ----------
const offer = [
  ...title(`${SEC.offer}. Offer of Employment`, 'Office fills this in. The new hire signs at the bottom to accept.'),
  fields([rowW(['Date', 3000], ['To (Name)', 7080])]),
  p(`We are pleased to offer you a job with ${CO}. The details are below.`, { spacing: { before: 160, after: 0 } }),
  fields([rowW(['Position / Job Title', 3780], ['Reports To', 3780], ['Start Date', 2520])]),
  p('Work location:   ☐ Shop (Odessa)   ☐ Field / customer sites   ☐ Both', { spacing: { before: 200, after: 80 } }),
  p('Status:   ☐ Full-time   ☐ Part-time   ☐ Temporary', { spacing: { after: 80 } }),
  p('Pay:   $ ____________   per   ☐ hour   ☐ year', { spacing: { after: 80 } }),
  p('Paid:   ☐ Weekly   ☐ Every two weeks      Payday: ______________', { spacing: { after: 80 } }),
  p('Overtime: hourly employees are paid 1½ times their regular rate for hours worked over 40 in a workweek.', { spacing: { after: 0 } }),
  fields([row('Regular Schedule (days / hours)', 'Per Diem / Travel Pay (if any)', 'Benefits (if any)')]),
  h2('This offer depends on'),
  bullet(`A negative pre-employment drug screen (Section ${SEC.ua})`),
  bullet(`A satisfactory background check and reference checks (Sections ${SEC.bgauth}–${SEC.refs})`),
  bullet(`Completing Form I-9 and showing work-authorization documents within 3 business days of your start date (Section ${SEC.i9})`),
  bullet(`A valid driver’s license and acceptable driving record, if the job includes driving (Section ${SEC.dl})`),
  bullet('Passing a weld test, if required for the position'),
  p([t('Employment with the Company is '), bold('at will'), t(': you or the Company may end it at any time, with or without cause or notice. This letter is not a contract for any set length of employment. Please sign and return it by ______________.')], { spacing: { before: 120, after: 120 } }),
  p('Sincerely,', { spacing: { after: 0 } }),
  fields([rowW([`Gilbert Alvarez — ${CO}`, 5040], ['Title', 3240], ['Date', 1800])]),
  h2('Acceptance'),
  p('I accept this offer on the terms above.', { spacing: { after: 0 } }),
  sigAs('Signature'),
  brk(),
];

// ---------- Safety cards & certifications ----------
const cards = ['OSHA 10-Hour', 'OSHA 30-Hour', 'H2S Clear / H2S Awareness', 'SafeLand / PEC Basic Orientation', 'TWIC', 'First Aid / CPR',
  'Forklift / Telehandler', 'Rigging / Signal Person', 'Confined Space', 'Fall Protection', 'Pipeline Operator Qualification (OQ)', 'Other:'];
const certs = [
  ...title(`${SEC.certs}. Safety Cards & Welding Certifications`, 'Bring your cards and certs. The office will copy them. Many customer sites won’t let you through the gate without current cards.'),
  h2('Safety training cards'),
  grid(['Card', 'Card / ID #', 'Issued', 'Expires', 'Copy (office)'], [3480, 2640, 1320, 1320, 1320], cards.map((c) => [c, '', '', '', '☐']), { minH: 320 }),
  h2('Welding certifications'),
  grid(['Code (AWS D1.1, ASME IX, API 1104…)', 'Process (SMAW, GTAW…)', 'Position', 'Material / Thickness or Pipe Range', 'Test Date', 'Issued By'],
    [2040, 1560, 1080, 2280, 1320, 1800], [1, 2, 3, 4].map(() => ['', '', '', '', '', ''])),
  p([t('Keep your certs active: under AWS and ASME rules a welder qualification lapses if you go more than 6 months without welding in that process.', { size: 17, color: GREY, italics: true })], { spacing: { before: 80 } }),
  h2('Office use — weld test at State of the Arc'),
  fields([row('Test Date', 'Process / Position', 'Result: ☐ Pass  ☐ Fail', 'Tested By')]),
  sigAs('Employee Signature — the cards and certs listed are mine and current'),
  brk(),
];

// ---------- Payroll deductions ----------
const deduct = [
  ...title(`${SEC.deduct}. Payroll Deduction Authorization`, 'Texas law lets an employer take money out of a paycheck only with the employee’s written permission for a lawful purpose.'),
  p([t(`I authorize ${CO} to deduct from my pay `), bold('only'), t(' for the items I have initialed below.')]),
  grid(['Your Initials', 'Deduction', 'Amount'], [1200, 5160, 3720], [
    ['', 'Company tools or equipment issued to me that I lose, or don’t return when my job or employment ends', 'Replacement cost of the item, as listed on my tool / PPE issue record'],
    ['', 'PPE I lose or damage on purpose (normal wear and tear is replaced free)', 'Replacement cost of the item'],
    ['', 'Extra uniforms or FR clothing I choose to buy beyond what the Company issues', 'Price agreed in writing before purchase'],
    ['', 'Pay advances or loans from the Company', 'Amount advanced, on the written repayment schedule'],
    ['', 'Personal purchases on a company fuel card or account', 'Actual amount charged'],
    ['', 'Other: ______________________________', ''],
  ]),
  h2('How deductions work'),
  bullet('Before any deduction, the office will tell me in writing what it is for and how much.'),
  bullet('A deduction will never lower my pay for the week below the federal minimum wage for the hours I worked, or reduce overtime pay I’ve earned.'),
  bullet('If a large amount is owed, it can be spread over several paychecks, agreed in writing.'),
  bullet('Authorized deductions may be taken from my final paycheck, under the same limits.'),
  bullet('I can cancel this authorization for future deductions by telling the office in writing. Money I already owe, such as an advance I received, will still be repaid as agreed.'),
  bullet('If I disagree with a deduction, I can raise it with the office. I may also contact the Texas Workforce Commission.'),
  sigAs('Employee Signature'),
  brk(),
];

// ---------- Workers' comp notice ----------
const wc = [
  ...title(`${SEC.wc}. Workers’ Compensation Notice`, 'Texas employers must tell every new employee, at hire, whether they carry workers’ compensation insurance.'),
  p([bold('Office checks one box and fills in the details:')]),
  p([bold('☐  The Company HAS workers’ compensation insurance')], { spacing: { before: 120, after: 0 } }),
  fields([rowW(['Insurance Carrier', 4080], ['Policy Number', 3000], ['Coverage Dates', 3000])]),
  bullet('If you are hurt on the job, workers’ comp can pay for your medical care and part of your lost wages, no matter who was at fault.'),
  bullet([bold('Report any work injury to the Company within 30 days'), t(` (Company policy: the same shift — see Section ${SEC.injury}). File a claim with the Texas Division of Workers’ Compensation within 1 year of the injury.`)]),
  bullet([t('You may keep your common-law right to sue the Company instead of being covered by workers’ comp. To do that, you must notify the Company '), bold('in writing within 5 days'), t(' of starting work.')]),
  p([bold('☐  The Company does NOT have workers’ compensation insurance')], { spacing: { before: 200, after: 60 } }),
  bullet('This means workers’ compensation benefits are not available to you.'),
  bullet('You keep your right to sue the Company if you are hurt on the job because of the Company’s negligence.'),
  bullet('Occupational injury benefit plan:   ☐ The Company provides one (details attached)   ☐ None'),
  h2('Free help'),
  p([t('Texas Department of Insurance, Division of Workers’ Compensation: '), bold('1-800-252-7031')], { spacing: { after: 40 } }),
  p([t('Office of Injured Employee Counsel (free help for injured workers): '), bold('1-866-393-6432')]),
  p('The official state workers’ compensation notice is posted at: ______________________________'),
  sigAs('Employee Signature — I received this notice'),
  spacer(),
  note([t('Office: ', { bold: true }), t('check with your carrier or the TDI-DWC website that this notice matches the current required wording and posters. Non-subscribers must also file DWC Form-005 with the state every year.')]),
  brk(),
];

// ---------- Shop rules ----------
const rules = [
  ...title(`${SEC.rules}. Shop Rules`, 'The short version. Your supervisor will go over anything specific to a job site.'),
  h2('Attendance & hours'),
  bullet('Be on time and ready to work at the start of your shift.'),
  bullet([t('Late or absent? '), bold('Call'), t(' your supervisor — don’t just text — at least 1 hour before your start time.')]),
  bullet('Missing 2 scheduled days in a row without calling is treated as quitting.'),
  bullet('Record all your hours accurately, the same day. No working off the clock, and never record time for someone else.'),
  bullet('Get overtime approved ahead of time. Overtime you work is always paid.'),
  h2('Safety'),
  bullet(`Wear your PPE at all times in the shop and in the field (Section ${SEC.ppe}).`),
  bullet('Follow hot work permits, fire watch and lockout/tagout rules on every job.'),
  bullet('Never weld or cut on a drum, tank or line that held anything flammable until it has been cleaned and tested.'),
  bullet('Follow every customer’s site rules and orientation.'),
  bullet('Stop and report anything unsafe. You won’t be punished for it.'),
  bullet('No phone use while welding, grinding, cutting, running equipment or driving.'),
  h2('Company vehicles & fuel cards'),
  bullet('Drive only with a valid license and Company approval. No personal use unless approved, and no passengers who aren’t on Company business.'),
  bullet('Seat belts on. No handheld phone while driving. Report any accident or ticket right away.'),
  bullet([bold('No smoking or vaping in Company vehicles'), t(' — ever. Keep Company vehicles clean at all times, inside and out.')]),
  bullet('Fuel cards are for Company vehicles and equipment only.'),
  h2('Tools & property'),
  bullet('Company tools stay Company property. Sign them out and return them at the end of the job, and when you leave the Company.'),
  bullet('Don’t take material, scrap or equipment without permission. Report broken or damaged tools and equipment.'),
  h2('Conduct'),
  bullet(`No drugs, alcohol or working impaired (Section ${SEC.ua}).`),
  bullet([bold('No weapons allowed anywhere'), t(' — in the shop, Company vehicles, on Company property or on customer sites.')]),
  bullet('No harassment, threats or fighting. Treat coworkers and customers with respect.'),
  bullet('Smoke only in designated areas, away from gas cylinders and anything flammable — never in Company vehicles.'),
  p('Breaking these rules can lead to discipline, up to and including termination. These rules don’t change the at-will relationship.', { spacing: { before: 160, after: 0 } }),
  sigAs('Employee Signature — I read and will follow these rules'),
  brk(),
];

// ---------- Injury reporting ----------
const step = (n, runs) => p([bold(`${n}.  `), ...runs], { spacing: { after: 100 } });
const injury = [
  ...title(`${SEC.injury}. Injury Reporting`, 'Report every injury — even small ones — the same shift.'),
  step(1, [bold('Emergency? Call 911 first.'), t(' Then call your supervisor.')]),
  step(2, [bold('Tell your supervisor right away and before the end of your shift.'), t(' This includes cuts, burns, arc flash / “welder’s flash,” metal in the eye, strains and near misses.')]),
  step(3, [bold('Get care.'), t(' Use the first aid kit and eyewash for minor injuries. For anything more, the Company will direct you to the clinic listed below.')]),
  step(4, [bold('Fill out the Injury & Incident Report'), t(` (Section ${SEC.incident}) with your supervisor within 24 hours.`)]),
  step(5, [bold('Post-accident drug and alcohol test'), t(` may be required (Section ${SEC.ua}).`)]),
  h2('Who to call'),
  grid(['Contact', 'Name / Location', 'Phone'], [3600, 4080, 2400], [
    ['Your supervisor', '', ''], ['Office — Gilbert Alvarez', CO, PHONE], ['Clinic for work injuries', '', ''],
    ['Nearest emergency room', '', ''], ['Workers’ comp claim line (if covered)', '', ''], ['Poison Control', 'National hotline', '1-800-222-1222'],
  ]),
  h2('Why same-shift reporting matters'),
  p('Texas law gives you 30 days to report a work injury, but late reports make it harder to get treatment covered and to fix the hazard. That’s why Company policy is the same shift.'),
  note([t('No retaliation. ', { bold: true }), t('The Company will not punish you for reporting an injury, filing a workers’ compensation claim or raising a safety concern. Texas law and federal OSHA protect these rights.')]),
  sigAs('Employee Signature — I understand how to report an injury'),
  p([t('Office: report to OSHA any work-related death within 8 hours, and any in-patient hospitalization, amputation or loss of an eye within 24 hours.', { size: 17, color: GREY, italics: true })], { spacing: { before: 100 } }),
  brk(),
];

// ---------- Incident report form ----------
const incident = [
  ...title(`${SEC.incident}. Injury & Incident Report`, 'Blank form — make copies. Fill out with your supervisor within 24 hours of any injury, illness, near miss or vehicle/property damage.'),
  fields([
    rowW(['Employee Name', 4080], ['Job Title', 3000], ['Supervisor', 3000]),
    rowW(['Date & Time of Incident', 2520], ['Date & Time Reported', 2520], ['Location (shop, or customer site name)', 5040]),
  ]),
  p('Type:   ☐ Injury   ☐ Illness   ☐ Near miss   ☐ Vehicle / property damage', { spacing: { before: 200, after: 60 } }),
  p('Injury:   ☐ Burn   ☐ Cut   ☐ Eye / foreign body   ☐ Arc flash   ☐ Strain / sprain   ☐ Fall   ☐ Struck by', { spacing: { after: 60 } }),
  p('               ☐ Other: ____________________________', { spacing: { after: 0 } }),
  fields([
    row('Body Part(s) Affected', 'Task Being Done', 'Tools / Equipment Involved'),
    row('What happened? (step by step)'), row(' '), row(' '),
    row('PPE Being Worn', 'What could prevent this next time?'),
    row('Witness 1 — Name / Phone', 'Witness 2 — Name / Phone'),
  ]),
  p('Treatment:   ☐ First aid only   ☐ Clinic   ☐ Emergency room   ☐ Refused treatment', { spacing: { before: 200, after: 60 } }),
  p('Post-accident drug / alcohol test done:   ☐ Yes   ☐ No', { spacing: { after: 0 } }),
  fields([rowW(['Employee Signature', 3600], ['Date', 1440], ['Supervisor Signature', 3600], ['Date', 1440])]),
  h2('Office use'),
  grid(null, [5520, 4560], [
    ['Reported to workers’ comp carrier (date / claim #)', ''],
    ['DWC Form-001 to carrier — required if more than 1 day of lost time; due within 8 days', ''],
    ['OSHA recordable? / Reported to OSHA if serious (date)', ''],
    ['Corrective action taken / by whom', ''],
  ]),
  brk(),
];

// ---------- PPE ----------
const ppeItems = ['Welding helmet / hood with lenses', 'Safety glasses (clear, and shade 5 for torch work)', 'Grinding face shield', 'Welding gloves',
  'Work gloves (cut-resistant)', 'FR jacket / sleeves / FR coveralls', 'Hearing protection', 'Hard hat', 'Hi-vis vest',
  'Respirator — type: __________ (fit test required)', 'Other:', 'Other:'];
const ppe = [
  ...title(`${SEC.ppe}. PPE Issue & Acknowledgement`, 'Personal protective equipment the Company issues to you. The office fills in the table; you initial each item you receive.'),
  grid(['Item', 'Size', 'Qty', 'Date Issued', 'Your Initials', 'Returned'], [4080, 960, 720, 1440, 1440, 1440], ppeItems.map((i) => [i, '', '', '', '', '']), { minH: 320 }),
  h2('What you need to know'),
  bullet('The Company provides required PPE at no cost to you, and replaces it free when it wears out.'),
  bullet([bold('You provide'), t(' safety-toe work boots (ASTM F2413). Wear cotton or wool under your welding gear — synthetic clothing can melt onto your skin.')]),
  bullet('Inspect your PPE before each use. Turn in damaged PPE for a replacement.'),
  bullet(`Lost PPE, or PPE damaged on purpose, may be charged to you only if you signed the Payroll Deduction Authorization (Section ${SEC.deduct}).`),
  bullet([bold('Respirators: '), t('before you wear a tight-fitting respirator you need a medical evaluation and a fit test, and must be clean-shaven where it seals to your face.')]),
  bullet('Return all issued PPE when you leave the Company.'),
  sigAs('Employee Signature — I received the PPE above and will wear and care for it'),
  fields([row('Respirator medical evaluation date (if required)', 'Fit test date / respirator make, model, size')]),
  brk(),
];

// ---------- HazCom ----------
const topics = [
  [bold('Written hazard communication program'), t(' and where the Safety Data Sheets (SDS) are kept: ______________________')],
  [bold('Labels and SDS: '), t('how to read container labels, pictograms, signal words and safety data sheets')],
  [bold('Welding fumes: '), t('manganese; hexavalent chromium from stainless; zinc from galvanized (metal fume fever). Use ventilation and fume extraction, and keep your head out of the plume.')],
  [bold('Gases and cylinders: '), t('argon, CO₂ and mixes can displace air in tight spaces; oxygen, acetylene and propane. Chain and cap cylinders, store them properly, check for leaks.')],
  [bold('Arc radiation: '), t('UV burns and arc eye; use welding screens to protect others')],
  [bold('Fire and hot work: '), t('clear combustibles within 35 feet, fire watch, extinguishers, customer hot-work permits')],
  [bold('Grinding and cutting: '), t('wheels rated for the grinder’s RPM, guards in place, sparks. CNC fiber laser: interlocks and guards — never bypass.')],
  [bold('Solvents, paints and cleaners: '), t('never use chlorinated degreasers near welding — the arc can turn the vapor into toxic phosgene gas')],
  [bold('Electrical shock: '), t('dry gloves, good insulation, inspect leads and cables')],
  [bold('H2S awareness'), t(' for oilfield sites (if applicable)')],
  [bold('Emergencies: '), t('spotting a leak or release, eyewash and first aid locations, evacuation meeting point: ______________________')],
];
const hazcom = [
  ...title(`${SEC.hazcom}. Hazard Communication & Welding Safety Training`, 'Required by OSHA before you work with hazardous chemicals. The trainer checks each topic covered.'),
  grid(['✓', 'Topic'], [720, 9360], topics.map((r) => ['☐', r.map((run) => run)]), { minH: 300 }),
  fields([rowW(['Trainer Name', 3600], ['Training Date', 1920], ['Length', 1680], ['Trainer Signature', 2880])]),
  p('I received this training, had the chance to ask questions, and know where to find the Safety Data Sheets. I will be retrained when a new hazard is brought into my work area.', { spacing: { before: 200, after: 0 } }),
  sigAs('Employee Signature'),
  brk(),
];

// ---------- Acknowledgement ----------
const ack = [
  ...title(`${SEC.ack}. Acknowledgement & Checklist`, 'Final signature page.'),
  p('By signing below, I confirm that:'),
  bullet('Everything I provided in this package is true and complete. False or missing information may result in the offer being withdrawn or my employment ending.'),
  bullet('I understand my employment is at will — either I or the Company can end it at any time, with or without cause or notice.'),
  bullet('I have received the FCRA Summary of Rights and a copy of every page I signed.'),
  bullet('I received and read the Shop Rules, Injury Reporting procedure and Workers’ Compensation Notice.'),
  bullet('I will follow Company safety rules and wear the required PPE on every job.'),
  spacer(),
  sig(),
  spacer(120),
  h2('Office checklist (completed by employer)'),
  (() => {
    const items = [
      ['Offer letter signed and returned', ''],
      ['Employee Information sheet', ''],
      ['UA consent signed', ''],
      ['Drug screen result received — negative', ''],
      ['FCRA disclosure + Summary of Rights given', ''],
      ['Background authorization signed', ''],
      ['Background report reviewed / cleared', ''],
      ['References and past employers called', ''],
      ['Driver’s license copied (if driving)', ''],
      ['MVR ordered / approved', ''],
      ['Safety cards and weld certs copied; weld test done', ''],
      ['I-9 Section 1 (by day 1)', ''],
      ['I-9 Section 2 (within 3 business days)', ''],
      ['W-4 received and entered in payroll', ''],
      ['Direct deposit form + voided check received and entered (if requested)', ''],
      ['Payroll deduction authorization signed (if used)', ''],
      ['Workers’ comp notice given and signed', ''],
      ['Shop rules and injury reporting signed', ''],
      ['PPE issued and signed for; respirator eval / fit test (if required)', ''],
      ['Hazard communication training completed', ''],
      ['Texas new-hire report filed (within 20 days)', ''],
    ];
    const cw = [720, 6480, 2880];
    const c = (txt, w, o = {}) => new TableCell({ width: { size: w, type: WidthType.DXA }, margins: { top: 30, bottom: 30, left: 120, right: 120 }, ...o,
      children: [new Paragraph({ spacing: { after: 0 }, children: [t(txt, { size: 19, ...(o.bold ? { bold: true, color: 'FFFFFF' } : {}) })] })] });
    const hdr = { shading: { type: ShadingType.CLEAR, fill: '333333', color: 'auto' }, bold: true };
    return new Table({
      width: { size: W, type: WidthType.DXA }, columnWidths: cw,
      rows: [new TableRow({ tableHeader: true, children: [c('✓', 720, hdr), c('Item', 6480, hdr), c('Date / Initials', 2880, hdr)] }),
        ...items.map(([s]) => new TableRow({ children: [c('☐', 720), c(s, 6480), c('', 2880)] }))],
    });
  })(),
  spacer(),
  p([t('Keep the I-9 and the drug test results in their own files, separate from the personnel file. Keep I-9s for 3 years after hire or 1 year after employment ends, whichever is later.', { size: 18, color: GREY, italics: true })]),
];

const doc = new Document({
  creator: CO,
  title: 'New Hire Package',
  styles: { default: { document: { run: { font: 'Arial', size: 21 } } } },
  numbering: { config: [
    { reference: 'b', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } }] },
    { reference: 'box', levels: [{ level: 0, format: LevelFormat.BULLET, text: '☐', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 400, hanging: 400 } }, run: { font: 'Segoe UI Symbol', size: 24 } } }] },
  ] },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } },
    headers: { default: new Header({ children: [new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: W }],
      children: [t(CO, { size: 16, color: GREY, bold: true }), t('\tNew Hire Package', { size: 16, color: GREY })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: W }],
      children: [t(`${ADDR}  ·  ${PHONE}`, { size: 15, color: GREY }), new TextRun({ children: ['\tPage ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], font: 'Arial', size: 15, color: GREY })] })] }) },
    children: [...cover, ...offer, ...info, ...ua, ...fcraDisclosure, ...bgAuth, ...refs, ...dl, ...certs, ...i9, ...tax, ...dd, ...deduct, ...wc, ...rules, ...injury, ...incident, ...ppe, ...hazcom, ...ack],
  }],
});

Packer.toBuffer(doc).then((b) => { fs.writeFileSync(process.argv[2], b); console.log('ok'); });
