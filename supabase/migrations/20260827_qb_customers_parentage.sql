-- QuickBooks lets a customer hang under another one: a job site, a project, a
-- division. RedHills Pipeline is one of these -- it is not its own company, it
-- is Rocking Double S's pipeline job, and QuickBooks has always had it that way.
--
-- The portal flattened that when it copied the list down, so RedHills showed up
-- in the picker looking like a customer in its own right with nothing to say
-- otherwise. Keeping the parentage means the picker can show it as what it is.
alter table qb_customers
  add column if not exists parent_id             text,
  add column if not exists fully_qualified_name  text,
  add column if not exists is_sub_customer       boolean not null default false;

comment on column qb_customers.parent_id is
  'The QuickBooks customer this one hangs under, when it is a job site or project rather than a company.';
comment on column qb_customers.fully_qualified_name is
  'QuickBooks name including its parents, e.g. "ROCKING DOUBLE S LLC:RedHills Pipeline".';
