# Backend workstream: OCR normalization and prepaid contract

## Implementation repository

**IMPORTANT: This planning file is stored in `Biddlebaddleboo/receipt-keeper`, but this workstream modifies:**

`Biddlebaddleboo/ai-receipt-tracker-backend`

Target branch:

`main`

Verified baseline:

`3aec861ef072476d6c3576d2f6ede418c9570481`

Do not modify `receipt-keeper` from this workstream.

## Objective

Fix disappearing receipt items and provide the additive backend contract required for activation-receipt/card relationships, card front/back storage, side-specific extraction, and cleanup.

## Implementation scope

Start with:

- `cmd/apiserver/receipts.go`
  - `readStructuredFields`
  - `extractReceiptItems`
  - `receiptItemsFromAny`
  - `ocrItemsToReceiptItems`
  - `processReceiptJob`
- `cmd/apiserver/ocr_positional.go`
  - `extractPositionalReceiptItems`
- `cmd/apiserver/ocr_positional_test.go`
- `cmd/apiserver/prepaid.go`
  - `prepaidImageType`
  - `prepaidActivationReceipt`
  - `prepaidActivationReceiptInput`
  - `prepaidCardRecord`
  - `prepaidCardInput`
  - `prepaidCleanupSummary`
  - `handlePrepaid`
  - `handlePrepaidPurchasePath`
  - `normalizePrepaidActivationInputs`
  - `normalizePrepaidCardInputs`
  - `normalizePrepaidCardInput`
  - `normalizePrepaidCardUpdate`
  - `prepaidActivationReceiptsFromAny`
  - `prepaidCardsFromAny`
  - prepaid extraction helpers
  - card-image signing helpers
- `cmd/apiserver/prepaid_test.go`
- `cmd/apiserver/prepaid_handlers_test.go`
- `cmd/apiserver/prepaid_cleanup_test.go`
- `cmd/apiserver/prepaid_testhooks.go` only if required for deterministic handler tests.

Avoid broad searching unless symbols moved or tests expose additional dependencies.

## Verified receipt failure

The intended positional OCR format already supports:

```json
["VISA $75 VMS", 1, 75]
```

However the reported response is an outer array containing an object.

The object fallback successfully extracts receipt-level fields, but `extractReceiptItems` accepts only object-shaped entries and silently ignores tuple entries.

Therefore the receipt is recognized while `items` becomes empty.

## Receipt changes

Create/reuse one normalization helper capable of decoding either:

```json
{"name":"VISA $75 VMS","quantity":1,"price":75}
```

or:

```json
["VISA $75 VMS",1,75]
```

into `ocrItem`.

Use the helper from both:

- object fallback item extraction;
- positional item extraction.

Keep `ocrItemsToReceiptItems` as the canonical write boundary producing object maps.

Make `receiptItemsFromAny` tolerant of tuple-shaped historical values as defensive read compatibility.

Do not change receipt mutation APIs to write tuple-shaped data.

### Required regression

Use the exact reported logical structure:

```json
[
  {
    "vendor": "Circle K 69011",
    "purchase_date": "2026-09-15",
    "transaction_id": "1240445",
    "category": "Food & Drink",
    "items": [
      ["VISA $75 VMS", 1, 75.00],
      ["VANILLA VISA ACTIVATIO", 1, 5.50],
      ["VISA $75 VMS", 1, 75.00],
      ["VANILLA VISA ACTIVATIO", 1, 5.50],
      ["VISA $75 VMS", 1, 75.00],
      ["VANILLA VISA ACTIVATIO", 1, 5.50]
    ]
  }
]
```

Assert:

- vendor remains `Circle K 69011`;
- purchase date remains `2026-09-15`;
- transaction ID maps through the existing invoice/merchant identifier path as `1240445`;
- category remains valid when category options permit it;
- exactly six items are returned;
- quantities/prices remain intact.

Preserve object-item and normal positional-array coverage.

## Prepaid association schema

Extend activation input with optional client ID.

During purchase creation:

1. normalize activation receipts first;
2. validate/generate IDs;
3. reject duplicate IDs;
4. build valid activation-ID set;
5. normalize cards using that set.

Add card field:

`activation_receipt_id`

Association validation must be server-side.

For existing-purchase card add/update operations, derive valid IDs from the authoritative purchase record.

For PATCH, distinguish omission from explicit clearing. Do not erase a relationship during unrelated card-detail edits.

No one-to-one restriction.

## Front/back card media

Add card fields:

- `card_front_image_storage_path`
- `card_back_image_storage_path`

Preserve:

`opened_card_image_storage_path`

for compatibility.

Add image types:

- `card_front`
- `card_back`

Each path must satisfy the same owner-prefix and uploaded-object validation currently used for prepaid media.

Unrelated PATCH operations must not erase saved media paths.

## Extraction

Add proposed helpers:

- `runPrepaidCardFrontExtraction`
- `runPrepaidCardBackExtraction`
- `validatePrepaidCardFrontExtraction`
- `validatePrepaidCardBackExtraction`

Front extraction prompt requests only:

- 16-digit PAN;
- expiry.

Back extraction requests only:

- CVV/CVC/security code.

Do not ask front extraction for CVV.

Do not ask back extraction for PAN.

Reuse existing PAN/CVV/expiry normalization and validation rules.

Expose:

- `POST /prepaid/card-front-extract`
- `POST /prepaid/card-back-extract`

Retain legacy opened-card extraction unchanged for old clients.

## Image signing

Add:

- card-front-image route;
- card-back-image route.

Reuse existing purchase/card ownership verification.

Do not expose storage URLs directly beyond the current signed-image behavior.

Continue `Cache-Control: no-store`.

## Cleanup

For archived cards independently delete:

- package image;
- card front image;
- card back image;
- legacy opened-card image.

Extend cleanup result with:

- `card_front_images_deleted`
- `card_back_images_deleted`

Retain:

`opened_card_images_deleted`

Do not change sales-receipt preservation.

Do not change activation-receipt cleanup eligibility because of the new association field.

Individual object deletion failures remain counted rather than aborting the entire cleanup.

## Backward compatibility

No eager Firestore migration.

Existing records missing all new fields must continue working.

Do not infer a front/back role for `opened_card_image_storage_path`.

List/search responses continue redacting:

- PAN;
- expiry;
- CVV.

Owner card detail continues returning credentials.

Search behavior remains unchanged.

## Security

Reject activation links pointing outside the purchase.

Do not log:

- PAN;
- CVV;
- expiry;
- signed image URLs;
- model extraction response bodies containing credentials.

Extraction endpoints do not directly persist credentials; persistence still occurs only through the confirmed card create/update flow.

## Non-goals

Do not redesign frontend-first OCR to add line-item extraction.

Do not implement receipt bulk backfill.

Do not change subtotal reconciliation except as a consequence of correctly recovered line items.

Do not expose prepaid data through the read-only AI receipts API.

Do not remove the legacy opened-card API.

## Tests

Required deterministic tests:

- reported Circle K response produces six items;
- object items still work;
- positional tuples still work;
- tuple-shaped historical receipt storage reads;
- canonical writes are objects;
- optional activation association;
- valid association;
- missing association target rejected;
- duplicate client activation ID rejected;
- one activation receipt linked to multiple cards;
- link update/clear behavior;
- front and back paths independent;
- old opened-card path preserved;
- front validation ignores CVV;
- back validation ignores PAN/expiry;
- credential redaction unchanged;
- non-owner access rejected;
- cleanup deletes new media classes;
- sales receipt preserved.

## Validation

From `cmd/apiserver`:

```bash
gofmt -w <changed-go-files>
go test ./... -run 'Receipt|OCR|Prepaid'
go test ./...
```

Review final diff for unexpected credential exposure.

## Handoff

Report:

- repository: `Biddlebaddleboo/ai-receipt-tracker-backend`;
- branch;
- changed files;
- commit SHA;
- tests;
- deviations;
- assumptions.

The backend contract defined by `PLAN.md` is shared infrastructure. Do not rename routes/fields without coordinating the frontend plan.
