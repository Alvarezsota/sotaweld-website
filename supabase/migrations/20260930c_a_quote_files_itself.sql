-- A quote files itself.
--
-- The portal drew the quote PDF and handed it to Gilbert to save, and he was
-- saving it into the Quotes folder on the company OneDrive by hand -- every
-- quote, and again on every revision, which is three or four times each before
-- it goes out. The portal now uploads it to that folder itself, on the first
-- render and on every one after.
--
-- These two columns are where the drive's answer lands. They are not the record
-- of the quote; the quote is the row and the lines, and it is complete without
-- them. They are here for two jobs:
--
--   onedrive_item_id -- what the drive called the file it made. A later render
--     uploads over the same name, so this is not needed to find the file again;
--     it is what lets the office tell "filed, and here it is" from "filed under
--     a name nobody recognises" if the folder is ever reorganised by hand.
--
--   onedrive_url -- the link the portal can put on the quote so the filed copy
--     is one click away instead of a search of the drive.
--
-- Both stay null when filing does not happen, and that is a normal state, not a
-- broken one: the drive can be disconnected, Microsoft can be down, or the
-- quote can simply predate this change. Nothing reads these to decide whether a
-- quote is real, and nothing should start to. Filing is a convenience laid on
-- top of a quote that was already finished -- see _shared/quote-filing.ts,
-- which is written so that no failure of it can reach the quote.

alter table public.desk_quotes
  add column if not exists onedrive_item_id text,
  add column if not exists onedrive_url text;

comment on column public.desk_quotes.onedrive_item_id is
  'Graph driveItem id of this quote''s PDF in the OneDrive Quotes folder. Null until it has been filed, which is not an error.';
comment on column public.desk_quotes.onedrive_url is
  'webUrl of the filed PDF, for linking the office straight at it. Null until it has been filed.';
