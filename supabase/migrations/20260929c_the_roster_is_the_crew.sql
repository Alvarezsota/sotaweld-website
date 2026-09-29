-- The roster is the crew.
--
-- welders_public is the list of names every page offers when it needs a person:
-- the welder picker on Log Work, the welder picker on the weld report, whose
-- ticket an admin is filling in. It was "every profile", which was true right
-- up until there was a profile that is not a welder.
--
-- Left as it was, Alexis appears in the list of men a job can be logged against.
-- Nothing stops an admin picking her by accident, and what comes out the other
-- end is a ticket with her name on it, against a job she has never been to, at
-- a bill rate she does not have, sitting in Approvals waiting to be billed to a
-- customer who owes nothing for it.
--
-- coalesce, not a plain comparison: pay_kind is not null today, but a view that
-- silently drops every row if that ever changes is worse than one that keeps a
-- row it should not.

create or replace view public.welders_public as
select id, full_name, active
from public.profiles
where coalesce(pay_kind, 'welder') <> 'office';

comment on view public.welders_public is
  'The crew, for every picker that needs a name: welders and anybody else paid '
  'against a job. Office staff are not on it -- they have no job to be picked '
  'for. Deliberately a definer view, so a welder can see who he works with '
  'without being able to read anybody''s rate.';
