# Frontend workstream

Implementation repo:
`Biddlebaddleboo/receipt-keeper`

Start in:
- `src/hooks/usePrepaidApi.ts`
- `src/components/prepaid/AddPrepaidPurchaseFlow.tsx`
- `src/components/prepaid/AddPrepaidPurchaseFlow.test.tsx`
- `src/pages/PrepaidCards.tsx`
- `src/pages/PrepaidCards.test.tsx`

## One-to-one receipt selection

In new-purchase card selectors:

- exclude receipts selected by another card;
- keep the current card's own selection visible;
- clearing/changing a selection immediately releases the old receipt.

Remove all wording saying an activation receipt may be shared.

In `PrepaidCardDetailV2`:
- exclude receipts assigned to other cards;
- keep the current card's own receipt available.

Backend remains authoritative if a race occurs.

## Activation receipt controls

For every persisted activation receipt provide:

- View
- Download
- Replace photo
- Delete photo
- Delete activation receipt

Delete receipt requires confirmation and refreshes the purchase state.

Deleting its photo leaves the activation receipt relationship intact but displays it as having no photo.

Replacing preserves the same receipt ID/link.

## Card controls

Add explicit `Delete card` separate from archive.

Require destructive confirmation.

After deletion:
- close detail;
- update purchase lists;
- linked activation receipt remains as an unlinked receipt.

## Card photo controls

For each existing:

- package image;
- card front;
- card back;
- legacy opened-card image;

provide:

- View
- Download
- Replace
- Delete photo

Replacement uses the existing crop → conversion → upload pipeline.

Package replacement may reuse existing package extraction controls.

Front replacement automatically runs PAN/expiry extraction.

Back replacement automatically runs CVV extraction.

Preserve the current image-generation/manual-edit protection so replacement OCR cannot overwrite later manual edits.

Legacy opened-card replacement only replaces that legacy media slot; do not infer front/back.

## Failure behavior

If replacement upload succeeds but API replacement fails, keep the existing persisted image displayed and surface the failure.

If backend reports delayed old-image cleanup, the replacement/deletion still reflects durable record state; show a non-blocking cleanup warning if exposed by the API.

Never locally remove a persisted card/receipt until the backend confirms the mutation.

## Tests

Add deterministic coverage for:

- exclusive receipt selectors;
- release on unlink;
- delete activation receipt;
- delete activation photo only;
- replace activation photo;
- delete card;
- activation receipt surviving card deletion;
- delete/replace package image;
- delete/replace front image;
- delete/replace back image;
- delete/replace legacy image;
- front/back OCR after replacement;
- failed mutation leaves old UI state intact;
- destructive confirmations.
