# Plan: Receipt item recovery and unified Vanilla card tracking

## Planning repository

All planning artifacts for this change live in:

`Biddlebaddleboo/receipt-keeper`

Target planning branch:

`main`

Verified planning head:

`928f951212cea115d763ec5d3f9071a39e72d5af`

This plan coordinates implementation across two repositories:

- `Biddlebaddleboo/receipt-keeper`
- `Biddlebaddleboo/ai-receipt-tracker-backend`

Backend baseline:

`ai-receipt-tracker-backend@3aec861ef072476d6c3576d2f6ede418c9570481`

Immediately before implementation or integration, verify that both `main` branches still match or reconcile relevant changes.

## Objective

Fix the receipt OCR failure where extracted line items are present in model output but disappear before reaching the stored receipt/UI.

Extend Vanilla prepaid tracking so:

- an activation receipt may optionally be linked to a specific card;
- package/card images use auto-crop before extraction;
- card front and card back are separate images;
- front capture automatically extracts card number and expiry;
- back capture automatically extracts CVV;
- package barcode, linked activation receipt, masked card number, card details, and related images are presented as one coherent card record;
- existing prepaid records remain compatible.

## Workstreams

### Workstream 1 — Backend contract and persistence

Plan file:

`PLAN_BACKEND.md`

**Planning file location:** `Biddlebaddleboo/receipt-keeper/PLAN_BACKEND.md`

**Implementation repository:** `Biddlebaddleboo/ai-receipt-tracker-backend`

Owns:

- OCR tuple/object line-item normalization;
- prepaid activation-receipt/card association schema;
- front/back image fields;
- front/back extraction endpoints;
- signing routes;
- validation/redaction;
- archive image cleanup.

### Workstream 2 — Frontend capture and presentation

Plan file:

`PLAN_FRONTEND.md`

**Planning file location:** `Biddlebaddleboo/receipt-keeper/PLAN_FRONTEND.md`

**Implementation repository:** `Biddlebaddleboo/receipt-keeper`

Owns:

- defensive tuple item decoding;
- prepaid image preparation/cropping;
- activation receipt selector;
- front/back capture and automatic extraction;
- stale-result protection;
- unified prepaid-card UI;
- frontend tests.

## Dependency and parallel-safety

The two workstreams may begin in parallel **only after treating the API contract in this `PLAN.md` as fixed**.

The backend workstream owns the wire contract. The frontend consumes it and must not independently rename fields or routes.

Backend must be integrated/deployed before frontend code depending on new endpoints is released.

The frontend receipt tuple-read compatibility does not depend on backend prepaid work and is independently implementable.

## Shared contract

### Activation receipts

Activation receipt creation accepts optional:

`id`

The frontend generates a UUID before purchase creation.

Backend behavior:

- absent ID: generate server-side UUID as today;
- supplied ID: validate as UUID and persist unchanged;
- duplicate IDs within a purchase request: reject.

### Card association

Card field:

`activation_receipt_id`

Rules:

- optional;
- may be absent/null;
- must refer to an activation receipt belonging to the same purchase;
- one activation receipt may be linked to multiple cards;
- no positional/index-based association.

### Card image fields

Canonical new card fields:

- `card_front_image_storage_path`
- `card_back_image_storage_path`

Existing field:

- `opened_card_image_storage_path`

remains supported for legacy records only.

Do not infer whether a legacy opened-card image is front or back.

### New prepaid image types

- `card_front`
- `card_back`

Existing:

- `activation_receipt`
- `package`
- `opened_card`

remain valid.

### New extraction endpoints

`POST /prepaid/card-front-extract`

Returns:

```json
{
  "extraction": {
    "pan": "1234567890123456",
    "expiry": "12/29"
  },
  "warnings": [],
  "requires_confirmation": true
}
```

`POST /prepaid/card-back-extract`

Returns:

```json
{
  "extraction": {
    "cvv": "123"
  },
  "warnings": [],
  "requires_confirmation": true
}
```

Legacy `/prepaid/opened-card-extract` remains operational.

### New card image routes

- `/prepaid/purchases/{purchaseID}/cards/{cardID}/card-front-image`
- `/prepaid/purchases/{purchaseID}/cards/{cardID}/card-back-image`

Existing package/opened-card routes remain.

## Core invariants

Receipt items are stored canonically as objects:

```json
{
  "name": "VISA $75 VMS",
  "quantity": 1,
  "price": 75
}
```

Tuple-shaped AI or legacy input may be accepted, but canonical writes remain object-shaped.

Prepaid overview/list/search responses must never expose PAN, expiry, or CVV.

Full card credentials remain available only through the existing owner-authorized card-detail path and current unsaved frontend edit state.

Activation-receipt association remains optional.

Package barcode and Vanilla serial remain package identifiers and are not replaced by PAN association.

Front extraction owns PAN and expiry.

Back extraction owns CVV.

An asynchronous extraction result must never overwrite:

- a newer uploaded image;
- a user edit made after that extraction started.

Original sales receipts are never deleted by prepaid archive-image cleanup.

## Integration order

1. Verify latest `main` in both repositories.
2. Execute `PLAN_BACKEND.md`.
3. Run backend full tests.
4. Integrate/deploy additive backend contract.
5. Execute/integrate `PLAN_FRONTEND.md`.
6. Run frontend targeted tests, full tests, lint, and build.
7. Exercise one end-to-end multi-card Vanilla purchase.
8. Independently compare final diffs against all three plans.
9. Resolve deviations centrally.
10. Delete all `PLAN*.md` planning files from `receipt-keeper` before the final implementation integration commit.

## End-to-end acceptance scenario

Use a sales receipt whose OCR result contains the reported six tuple items:

- three `VISA $75 VMS` × 1 × `$75.00`;
- three `VANILLA VISA ACTIVATIO` × 1 × `$5.50`.

Verify:

- all six receipt items populate;
- multiple Vanilla cards can be added;
- activation receipts may be linked to individual cards or left unlinked;
- one activation receipt may intentionally be shared;
- package uploads are cropped before extraction;
- card front uploads are cropped and automatically populate PAN/expiry;
- card back uploads are cropped and automatically populate CVV;
- manual corrections survive late asynchronous extraction;
- reload preserves associations and media;
- overview displays only masked card information;
- linked activation receipt, package barcode, and card identity are shown together;
- unlinked activation receipts remain accessible;
- legacy opened-card images remain usable;
- archived-photo cleanup handles package/front/back/legacy images without deleting the sales receipt.

## Execution handoff

Implement `PLAN.md` exactly.

Read the relevant workstream file before editing code.

Each executor must explicitly state which repository it is operating in before making changes.

Executors must report:

- implementation repository;
- branch;
- changed files;
- implementation commit SHA;
- tests run;
- deviations from the plan;
- unresolved assumptions.

Do not let an executor silently redesign the shared API contract. Contract changes must be reconciled centrally across both workstreams.
