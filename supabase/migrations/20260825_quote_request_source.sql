-- Where a quote request came from.
--
-- A request used to arrive with a name, a phone number and a message, and
-- nothing at all about how the man got here. Google? A link off a job page?
-- Somebody handed him the address? No way to tell, so no way to know which
-- half of the advertising is working.
--
-- The trail is only readable at the moment of the first page of a visit. By the
-- time he has clicked through to the quote form, document.referrer says
-- sotaweld.com, which says nothing. So the browser records the landing page,
-- what sent him there, and the pages he looked at, and carries all of it to the
-- form. These columns are where it lands.
--
-- Every one of them is nullable and every one is optional: an old request, a
-- browser with storage turned off, or a man who blocks referrers all still file
-- a request the same as before. Blank here means "not known", never "direct".

alter table public.quote_requests
  add column if not exists landing_page   text,
  add column if not exists landing_query  text,
  add column if not exists referrer       text,
  add column if not exists source_page    text,
  add column if not exists utm_source     text,
  add column if not exists utm_medium     text,
  add column if not exists utm_campaign   text,
  add column if not exists utm_term       text,
  add column if not exists utm_content    text,
  add column if not exists click_id       text,
  add column if not exists pages_seen     text[],
  add column if not exists visit_started_at timestamptz,
  add column if not exists user_agent     text,
  add column if not exists screen_size    text;

comment on column public.quote_requests.landing_page is
  'First page of the visit -- the one he arrived on, not the one he submitted from.';
comment on column public.quote_requests.landing_query is
  'Query string on that first page, kept whole. Ad click ids and campaign tags live here.';
comment on column public.quote_requests.referrer is
  'document.referrer at first touch: the search engine, social site or other site that sent him. Blank means he typed the address, followed a text or email link, or his browser withheld it.';
comment on column public.quote_requests.source_page is
  'The page the form was actually filled out on.';
comment on column public.quote_requests.click_id is
  'gclid, fbclid or msclkid off the landing page -- proof the visit came from a paid ad rather than an ordinary search result.';
comment on column public.quote_requests.pages_seen is
  'Every page of the visit in order, first to last. A man who read three job pages before asking is a different lead from one who filled the form in ten seconds.';
comment on column public.quote_requests.visit_started_at is
  'When he landed. Against created_at this gives how long he looked around before asking.';

-- The public insert policy is check(true), so a form submission may write these
-- columns and nothing else needs granting. Nothing here is trusted: it is what
-- the browser reported, which is the only thing anyone can know about this.
