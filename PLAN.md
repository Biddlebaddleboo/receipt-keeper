# Plan: Prepaid relationship and media management

## Baselines

Planning/frontend repo:
`Biddlebaddleboo/receipt-keeper@b8def4ce461e3a8bce90dadd9f80ecb86e28cca7`

Backend:
`Biddlebaddleboo/ai-receipt-tracker-backend@228b86dcbacec36933415869e2bd25dfe71f330a`

## Objective

Complete prepaid management so users can:

- link each activation receipt to at most one card/package;
- unlink or reassign receipts;
- delete an activation receipt;
- delete a card;
- delete any prepaid photo independently;
- replace any prepaid photo without recreating the card/receipt.

Prepaid photo slots are:

- activation receipt;
- package;
- card front;
- card back;
- legacy opened-card image.

Sales-receipt media remains managed by the normal Receipt Keeper workflow.

## Invariants

- One activation receipt may belong to zero or one card, never multiple cards.
- A card may have zero or one activation receipt.
- Existing duplicate legacy links remain readable; new/changed assignments may not create duplicates.
- Deleting a card leaves its activation receipt in the purchase, now unlinked.
- Deleting an activation receipt clears its card association.
- Deleting a photo does not delete its card or activation-receipt record.
- Replacing a photo preserves IDs and relationships.
- Removing/replacing media must not leave an inaccessible old image with no retry path if object deletion fails.
- PAN/expiry/CVV redaction rules remain unchanged.

## Workstreams

`PLAN_BACKEND.md` owns persistence, uniqueness enforcement, deletion/replacement routes, storage cleanup/retry, and backend tests.

`PLAN_FRONTEND.md` owns selector behavior, Delete/Replace controls, confirmations, extraction behavior after replacement, and UI tests.

Backend contract lands first; frontend consumes it.

## Validation

End-to-end verify:

1. Receipt A can link to Card 1 but disappears from Card 2's choices.
2. Clearing Card 1 makes Receipt A available to Card 2.
3. Backend rejects duplicate association attempts regardless of UI.
4. Activation receipt image can be replaced or deleted.
5. Activation receipt record can be deleted and its link clears.
6. Package/front/back/legacy card photos can each be deleted or replaced independently.
7. Card deletion removes the card and its card-owned photos but preserves sales and activation receipts.
8. Replacement front/back images still use side-specific OCR with existing stale/manual-edit protections.
9. Failed old-image cleanup remains retryable.
