# Backend workstream

Implementation repo:
`Biddlebaddleboo/ai-receipt-tracker-backend`

Start in:
- `cmd/apiserver/prepaid.go`
- `prepaid_test.go`
- `prepaid_handlers_test.go`
- `prepaid_cleanup_test.go`

## One-to-one activation association

Enforce uniqueness in:

- purchase creation;
- `addPrepaidCard`;
- `updatePrepaidCard`.

When assigning a non-empty `activation_receipt_id`, reject it if another card in the same purchase already owns it.

For update, exclude the card being edited.

Omitted association on PATCH remains unchanged; explicit empty value clears it.

Do not make unrelated updates fail solely because historical data already contains a duplicate link.

## New destructive operations

Add owner-authorized routes for:

- deleting an activation-receipt record;
- deleting a card record;
- deleting an activation-receipt image only;
- deleting package/front/back/legacy card images individually;
- replacing each of those image slots.

Deleting an activation receipt:
- removes the receipt;
- clears that ID from its linked card;
- schedules/deletes its image.

Deleting a card:
- removes the card and recalculates counts;
- preserves activation and sales receipts;
- deletes package/front/back/legacy images.

Deleting only a photo:
- clears that storage-path field;
- preserves extracted metadata/credentials and the owning record.

Replacing:
- validates the newly uploaded object;
- atomically changes the record to the new path;
- preserves card/receipt IDs and relationships;
- schedules the old path for deletion.

## Failed image deletion

Do not lose cleanup responsibility after clearing/removing a record.

Persist old paths needing deletion in a deduplicated purchase-level pending-cleanup field or equivalent durable mechanism.

After the Firestore mutation:
- attempt GCS deletion;
- object-not-found counts as success;
- remove successfully deleted paths from the pending set;
- retain failed paths for retry.

Extend the existing cleanup operation to retry pending media deletions.

Never queue the current replacement path for deletion.

## Concurrency

Use authoritative current purchase state when enforcing unique activation links and destructive mutations.

A replace/delete operation must not silently overwrite a newer image path.

Prefer a Firestore transaction or equivalent compare-before-write behavior around relationship/path mutation.

## Tests

Cover:

- duplicate association on create/add/update;
- clear then reassignment;
- legacy duplicate compatibility;
- delete linked activation receipt clears link;
- delete card preserves activation receipt;
- individual image deletion for every slot;
- replacement preserves IDs and links;
- old image deletion;
- deletion failure queued and retried;
- object-not-found deletion success;
- unauthorized/cross-owner requests;
- counters after card deletion;
- sales receipt never deleted.
