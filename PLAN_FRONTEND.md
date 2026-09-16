# Frontend workstream: prepaid capture and unified card UI

## Implementation repository

**IMPORTANT: This planning file is stored in `Biddlebaddleboo/receipt-keeper`, and this workstream also modifies:**

`Biddlebaddleboo/receipt-keeper`

Target branch:

`main`

Verified baseline:

`928f951212cea115d763ec5d3f9071a39e72d5af`

The backend contract comes from `PLAN.md` and `PLAN_BACKEND.md`. Do not independently rename backend fields or routes.

## Objective

Make receipt reads tolerant of tuple-shaped item data and redesign prepaid capture/presentation around one coherent Vanilla card record with optional activation receipt, package information, front/back media, and automatically extracted credentials.

## Implementation scope

Start with:

- `src/hooks/useReceiptApi.ts`
  - `toItems`
  - receipt detail normalization
- `src/hooks/useReceiptApi.test.tsx`
- `src/hooks/usePrepaidApi.ts`
  - prepaid interfaces/types
  - extraction methods
  - signing helpers
- `src/components/prepaid/AddPrepaidPurchaseFlow.tsx`
  - image drafts
  - card draft
  - package extraction
  - save payload
- `src/components/prepaid/AddPrepaidPurchaseFlow.test.tsx`
- `src/pages/PrepaidCards.tsx`
  - `PrepaidPurchaseGroup`
  - `PrepaidCardRow`
  - `PrepaidCardDetail`
  - related image/receipt actions
- `src/pages/PrepaidCards.test.tsx`
- `src/lib/receiptAutoCrop.ts`
  - read-only dependency unless representative fixtures prove detector tuning is required.

Proposed addition:

`src/lib/prepaidImagePipeline.ts`

and a focused unit test if useful.

## Receipt tuple compatibility

Update `toItems` so both:

```ts
{ name, quantity, price }
```

and:

```ts
[name, quantity, price]
```

normalize into `ReceiptItem`.

Keep `ReceiptItem` object-shaped throughout application state.

Do not redesign receipt item rendering/editing.

Malformed individual entries should be ignored without discarding valid neighboring entries.

## Shared prepaid image pipeline

Introduce one preprocessing helper.

Required ordering:

1. `autoCropReceiptImage`
2. optional grayscale conversion
3. `convertReceiptImageFile`
4. assert `image/webp`
5. upload

Apply it to:

- activation receipts;
- package images;
- card front;
- card back.

The existing auto-crop algorithm is fail-open; retain that behavior.

Do not retune detector thresholds without real failing Vanilla fixtures.

Both gallery and camera inputs use the identical preparation path.

## Prepaid API model

Extend activation receipt create data with stable UUID.

Generate activation draft IDs with `crypto.randomUUID()`.

Add card fields:

- `activation_receipt_id`
- `card_front_image_storage_path`
- `card_back_image_storage_path`

Retain legacy:

`opened_card_image_storage_path`

Add image kinds/types for front/back.

Add client calls:

- `extractCardFront`
- `extractCardBack`

Extend image signing for front/back.

Extend cleanup summary typing.

## New purchase card draft

One `CardDraft` owns all state related to a card:

- package image;
- activation barcode;
- Vanilla serial;
- denomination;
- optional activation receipt ID;
- front image;
- back image;
- PAN;
- expiry;
- CVV;
- extraction status/warnings for each image;
- uploaded storage paths.

Avoid index-based relationships.

### Activation receipt selector

Within each card show an optional selector.

Values come from activation receipt drafts in the same purchase.

Default:

No linked activation receipt.

Allow clear/unlink.

Allow the same activation receipt to be chosen by multiple cards.

Removing an activation receipt that is linked to cards must clear or explicitly resolve those draft links rather than leaving dangling IDs.

## Package image

Run crop preprocessing before package conversion/upload.

Existing package extraction may remain manually triggered.

After upload/extraction, cache the storage path and reuse it during:

- retry extraction;
- final save;
- failed final-save retry.

Do not re-upload an unchanged package image unnecessarily.

## Card front

When user captures/selects the front:

1. update preview;
2. start preparation;
3. auto-crop;
4. convert;
5. upload as `card_front`;
6. retain storage path;
7. automatically invoke `extractCardFront`;
8. populate PAN and expiry where returned;
9. expose warnings/manual correction.

Provide Retry extraction after failure/warning.

No initial manual Extract click should be required.

### Stale result protection

Give each front selection an identity/generation.

Apply extraction results only when they still correspond to the current front image.

If the user edits PAN or expiry after extraction begins, a late extraction result must not overwrite the manual edit.

## Card back

Use equivalent flow:

- auto-crop;
- upload as `card_back`;
- automatically call `extractCardBack`;
- populate CVV only.

Back extraction never updates PAN/expiry.

Front extraction never updates CVV.

Protect against stale image/extraction results exactly as for front.

## Final create payload

Each card may submit:

- activation barcode;
- Vanilla serial;
- denomination;
- package image storage path;
- optional activation receipt ID;
- front image storage path;
- back image storage path;
- PAN;
- expiry;
- CVV;
- `confirmed: true`.

Activation receipt entries submit their stable UUIDs.

Preserve current recovery behavior:

- already-created sales receipt ID is reused;
- already-uploaded prepaid images are reused;
- retrying a failed purchase save does not duplicate uploads.

## Unified overview

Keep the sales receipt at purchase level.

Render each prepaid card as one coherent card panel containing available non-secret information:

- denomination;
- masked PAN/last4;
- card-detail captured status;
- package barcode;
- Vanilla serial;
- linked activation receipt action;
- media/status indicators as useful.

Do not expose full PAN, expiry, or CVV in overview.

### Linked activation receipts

A linked activation receipt's View/Download controls belong with its card panel.

Do not simultaneously render that receipt in the unlinked purchase section.

### Unlinked activation receipts

Activation receipts not referenced by any card remain visible under:

`Unlinked activation receipts`

at purchase level.

No uploaded activation receipt should disappear merely because it was not associated.

## Card detail

Replace the new generic opened-card capture flow with:

### Card front

- camera/gallery;
- cropped preview;
- automatic extraction;
- retry;
- saved View;
- saved Download.

### Card back

- camera/gallery;
- cropped preview;
- automatic extraction;
- retry;
- saved View;
- saved Download.

Editable details:

- PAN;
- expiry;
- CVV;
- activation receipt relationship where appropriate;
- package barcode;
- Vanilla serial.

Existing `opened_card_image_storage_path` must render as:

`Legacy opened-card image`

with View/Download support.

Never guess whether it was front or back.

Card-detail saves must preserve omitted paths/relationships.

## Privacy

Full credentials are allowed only in:

- the current unsaved card edit state;
- owner-authorized card-detail response.

Do not put full credentials into:

- search results;
- overview panels;
- persistent browser storage;
- logs.

Revoke preview object URLs when replaced/unmounted.

## Cleanup presentation

Update cleanup result and confirmation wording to include:

- package images;
- card fronts;
- card backs;
- legacy opened-card images.

Sales receipt preservation must remain explicit.

## Failure and recovery

Crop failure returns the original image and continues.

Upload failure leaves existing card values intact.

Extraction failure allows manual entry.

Successful upload + failed extraction retains storage path for retry.

Replacing a side invalidates older extraction results for that side.

Manual values win over late extraction results.

A failed final save preserves already-uploaded paths and saved sales receipt ID.

Do not introduce a new orphan-image garbage collector in this change.

## Non-goals

Do not add line-item extraction to frontend-first OCR.

Do not bulk reprocess existing receipts.

Do not change crop thresholds without fixtures.

Do not automatically guess activation receipt/card association.

Do not migrate old opened-card images.

Do not move the common sales receipt into every card panel.

## Tests

### `useReceiptApi.test.tsx`

Cover:

- canonical object items;
- tuple items;
- six reported Circle K line items;
- malformed neighbor handling.

### Image pipeline

Mock all stages.

Assert:

`crop → optional grayscale → WebP conversion → upload`

and reject non-WebP conversion output.

### `AddPrepaidPurchaseFlow.test.tsx`

Cover:

- activation receipt remains optional;
- stable UUID submitted;
- association selection/clearing;
- shared activation receipt permitted;
- removal of linked activation receipt leaves no dangling draft ID;
- package crop precedes upload/extraction;
- front crop/upload automatically triggers front extraction;
- PAN/expiry populate;
- back crop/upload automatically triggers back extraction;
- CVV populates;
- front cannot alter CVV;
- back cannot alter PAN/expiry;
- stale extraction ignored after image replacement;
- late extraction cannot overwrite manual edits;
- save retry reuses receipt and media paths.

### `PrepaidCards.test.tsx`

Cover:

- coherent panel per card;
- linked receipt rendered with its card;
- unlinked receipt remains at purchase scope;
- shared receipt can appear appropriately for multiple linked cards;
- package barcode and masked PAN appear together;
- full card detail loads only on open;
- front/back saved image actions independent;
- front/back camera handlers independent;
- legacy opened-card image remains visible;
- cleanup result includes new counters.

## Validation

```bash
npm test -- src/hooks/useReceiptApi.test.tsx src/components/prepaid/AddPrepaidPurchaseFlow.test.tsx src/pages/PrepaidCards.test.tsx
npm test
npm run lint
npm run build
```

Include a new image-pipeline test in the targeted command if one is created.

## Handoff

Report:

- repository: `Biddlebaddleboo/receipt-keeper`;
- branch;
- changed files;
- commit SHA;
- tests;
- deviations;
- unresolved assumptions.

If backend behavior disagrees with the shared contract, stop and escalate the contradiction to the orchestrator rather than silently adapting the frontend to a different architecture.
