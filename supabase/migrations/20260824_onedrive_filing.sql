-- Filing a week's pay statements to OneDrive.
--
-- Applied to production 2026-08-24, alongside the edge function
-- onedrive-file-statements (verify_jwt off - see below).
--
-- ---------------------------------------------------------------------------
-- A WEEK IS APPROVED ONE JOB AT A TIME
-- ---------------------------------------------------------------------------
--
-- job_weeks holds a row per job per week, so approving "the week" is really
-- several approvals, minutes or days apart. A pay statement is not per job - it
-- is one man's whole week across every job he touched - so filing on the first
-- approval would file half a week, and filing on each one would rewrite every
-- statement several times over.
--
-- So the trigger waits. On each approval it asks whether any job with work that
-- week is still open, and does nothing until none are. The last approval of the
-- week is the one that files, and it files the whole thing.
--
-- The log row is also the lock: one row per week, claimed with
-- "on conflict do nothing returning", so if two approvals land in the same
-- instant exactly one of them files. Same trick tg_job_week_email_summaries uses.
--
-- ---------------------------------------------------------------------------
-- WHY verify_jwt IS OFF ON THE FUNCTION
-- ---------------------------------------------------------------------------
--
-- net.http_post from a trigger carries no Supabase token, so the gateway check
-- cannot be the thing that guards this. The function does its own: the shared
-- summary_hook_secret for the trigger, or an admin's bearer token for the
-- Summary page's button. Anything else is turned away before a OneDrive token is
-- read, which matters because past that point it is holding a key to the drive.

create table if not exists public.onedrive_file_log (
  week_start   date primary key,
  folder       text,
  filed_count  integer not null default 0,
  failed_count integer not null default 0,
  detail       jsonb,
  status       text not null default 'queued',
  filed_at     timestamptz,
  created_at   timestamptz not null default now()
);

comment on table public.onedrive_file_log is
  'One row per week filed to OneDrive. Doubles as the lock that keeps two approvals from filing the same week twice.';

alter table public.onedrive_file_log enable row level security;

drop policy if exists onedrive_file_log_read_admin on public.onedrive_file_log;
create policy onedrive_file_log_read_admin on public.onedrive_file_log
  for select using (public.is_admin(auth.uid()));

-- One call for everything a week's statements need. Sixteen round trips - a
-- summary row then a detail call per man - is sixteen chances for a week to end
-- up half filed.
create or replace function public.week_pay_statements(p_week date)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(s order by s->>'kind' desc, s->>'name'), '[]'::jsonb)
  from (
    select to_jsonb(w) - 'welder_id' - 'welder_name'
           || jsonb_build_object(
                'kind', 'welder', 'person_id', w.welder_id, 'name', w.welder_name,
                'detail', public.week_person_detail(p_week, 'welder', w.welder_id)) as s
    from public.v_week_welder_summary w where w.week_start = p_week
    union all
    select to_jsonb(h) - 'helper_id' - 'helper_name'
           || jsonb_build_object(
                'kind', 'helper', 'person_id', h.helper_id, 'name', h.helper_name,
                'detail', public.week_person_detail(p_week, 'helper', h.helper_id))
    from public.v_week_helper_summary h where h.week_start = p_week
  ) t(s);
$function$;

revoke all on function public.week_pay_statements(date) from public;
grant execute on function public.week_pay_statements(date) to service_role;

create or replace function public.tg_job_week_file_statements()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'net', 'extensions'
as $function$
declare
  v_enabled text; v_url text; v_secret text; v_open int; v_claim date;
begin
  if new.status <> 'approved' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'approved' then return new; end if;

  select value into v_enabled from public.app_settings where key = 'onedrive_filing_enabled';
  if coalesce(v_enabled, 'false') <> 'true' then return new; end if;

  select value into v_url    from public.app_settings where key = 'onedrive_file_url';
  select value into v_secret from public.app_settings where key = 'summary_hook_secret';
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then return new; end if;

  select count(*) into v_open
  from (
    select distinct wl.bill_job_id as job_id from public.v_work_lines wl
     where wl.week_start = new.week_start and wl.bill_job_id is not null
    union
    select distinct wl.cost_job_id from public.v_work_lines wl
     where wl.week_start = new.week_start and wl.cost_job_id is not null
  ) j
  where not exists (
    select 1 from public.job_weeks jw
     where jw.job_id = j.job_id and jw.week_start = new.week_start
       and jw.status in ('approved', 'synced'));

  if v_open > 0 then return new; end if;

  insert into public.onedrive_file_log (week_start, status)
  values (new.week_start, 'queued')
  on conflict (week_start) do nothing
  returning week_start into v_claim;

  if v_claim is null then return new; end if;

  -- A OneDrive problem must never stand between a man and an approved week.
  begin
    perform net.http_post(
      url     := v_url,
      body    := jsonb_build_object('week_start', new.week_start),
      params  := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-sota-secret', v_secret),
      timeout_milliseconds := 10000);
  exception when others then
    update public.onedrive_file_log
       set status = 'failed', detail = jsonb_build_object('error', sqlerrm)
     where week_start = new.week_start;
  end;

  return new;
end;
$function$;

drop trigger if exists job_week_file_statements on public.job_weeks;
create trigger job_week_file_statements
  after insert or update on public.job_weeks
  for each row execute function public.tg_job_week_file_statements();

-- Off until OneDrive is connected and the office turns it on, so nothing fires
-- into a half-configured setup.
insert into public.app_settings (key, value) values
  ('onedrive_filing_enabled', 'false'),
  ('onedrive_file_url', 'https://woqzbterwialanccprhp.supabase.co/functions/v1/onedrive-file-statements')
on conflict (key) do update set value = excluded.value
where public.app_settings.key = 'onedrive_file_url';
