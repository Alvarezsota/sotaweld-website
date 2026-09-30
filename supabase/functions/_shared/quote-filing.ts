// Files a drawn quote into the Quotes folder on the company OneDrive.
//
// Gilbert was saving these by hand out of the browser's download folder. The
// portal already draws the document; it may as well put it where he was putting
// it. Every render files -- the first one and every revision after it -- which
// is why the upload replaces rather than renames: a quote goes through three or
// four passes before it leaves, and the folder has to hold the current one, not
// all of them.
//
// ---------------------------------------------------------------------------
// FILING NEVER FAILS THE QUOTE
// ---------------------------------------------------------------------------
// This is a convenience, not a gate. The PDF is already drawn and already on
// its way back to whoever asked for it before this runs, and the caller does
// not wait on it: everything here is caught, and the worst case is a line in
// the function log and a quote whose onedrive_ columns stay null. The office
// can still download the document from the portal, which is how it worked
// before this existed.
//
// So: no throw escapes fileQuotePdf. If you are editing it, keep it that way.

import { type Admin, driveHandle, ensureRootFolder, uploadFile } from './onedrive.ts';

// Where the office keeps them, at the top of the drive. Looked up by this name
// on every run and made if it has gone; the id is never written down.
const QUOTES_FOLDER = 'Quotes';

export type FilingOutcome =
  | { ok: true; filename: string; itemId: string; webUrl: string | null }
  | { ok: false; why: string };

export async function fileQuotePdf(
  admin: Admin, quoteId: string, filename: string, pdf: Uint8Array,
): Promise<FilingOutcome> {
  try {
    const got = await driveHandle(admin);
    if (!got.ok) return { ok: false, why: got.error };

    const folderId = await ensureRootFolder(got.handle, QUOTES_FOLDER);
    const { itemId, webUrl } = await uploadFile(got.handle, folderId, filename, pdf);

    // Written back so the portal can link straight at the filed copy, and so a
    // later render knows there is already an item there under that name.
    const { error } = await admin.from('desk_quotes')
      .update({ onedrive_item_id: itemId || null, onedrive_url: webUrl })
      .eq('id', quoteId);
    if (error) {
      // The file IS on the drive. Say so, and say the row did not catch up --
      // reporting this as a failed upload would send somebody looking for a
      // file that is sitting right there.
      return { ok: false, why: `filed as "${filename}" but desk_quotes was not updated: ${error.message}` };
    }

    return { ok: true, filename, itemId, webUrl };
  } catch (err) {
    return { ok: false, why: err instanceof Error ? err.message : String(err) };
  }
}

/* Files in the background and writes the result to the log either way.
   Handed to waitUntil where the runtime has it, so the response goes back
   without waiting on Microsoft; where it does not, the promise is simply left
   running with its rejection already handled inside fileQuotePdf. */
export function fileQuotePdfDetached(
  admin: Admin, quoteId: string, filename: string, pdf: Uint8Array,
): void {
  const work = fileQuotePdf(admin, quoteId, filename, pdf).then((out) => {
    if (out.ok) {
      console.log(`[quote-filing] filed ${quoteId} as "${out.filename}"`);
    } else {
      console.error(`[quote-filing] ${quoteId} not filed: ${out.why}`);
    }
  // fileQuotePdf catches everything, so this cannot fire. It is here because an
  // unhandled rejection on a detached promise takes the isolate down with it,
  // and that WOULD reach the quote -- the one thing this file promises not to do.
  }).catch((err) => {
    console.error(`[quote-filing] ${quoteId} not filed: ${err}`);
  });

  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (typeof rt?.waitUntil === 'function') rt.waitUntil(work);
}
