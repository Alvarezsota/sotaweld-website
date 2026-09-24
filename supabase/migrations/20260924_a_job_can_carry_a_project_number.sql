-- A job can carry the customer's project number as well as their PO.
--
-- Some customers issue both and they are not the same thing: the PO is what
-- their accounts match the bill against, the project number is what their
-- engineering side files it under. Putting one in the other's box means one of
-- the two is wrong on every invoice for that job.
--
-- jobs.pw_project_number already exists and is NOT this. That one belongs to
-- the prevailing-wage block -- it only appears when a job is flagged
-- prevailing wage, and it is the agency's number for a public works project.
-- A private customer with a project number has nowhere to put it today.

alter table public.jobs
  add column if not exists project_number text;

comment on column public.jobs.project_number is
  'The customer''s project number for this job, where they issue one alongside '
  'a PO. Theirs, not ours. Distinct from pw_project_number, which is the '
  'contracting agency''s number on a prevailing-wage job.';
