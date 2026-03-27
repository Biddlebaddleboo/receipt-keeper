# Receipt Keeper Frontend

React + Vite frontend for receipt tracking with:

- Google sign-in
- Firebase Auth + Firestore (direct client reads/writes for user-scoped data)
- Lightweight backend only for privileged operations (signed uploads/URLs, billing actions)

## Links

- Live app: [AI Receipt Tracker](https://ai-receipt-tracker.web.app/)
- Backend repo: [ai-receipt-tracker-backend](https://github.com/Biddlebaddleboo/ai-receipt-tracker-backend)

## Stack

- React 18 + TypeScript
- Vite
- Firebase Auth
- Firestore Lite SDK
- Tailwind + shadcn/radix UI

## Architecture

- Frontend reads/writes:
  - `users` (read-only on client)
  - `receipts` (owner-scoped read/update)
  - `categories` (owner-scoped CRUD)
  - `plans` (read)
- Backend handles:
  - Signed upload flow to GCS
  - Signed image URL generation
  - Billing activation and webhook-driven payment state

## Environment Variables

Create a `.env` file in the project root.

```bash
VITE_FIREBASE_API_KEY=your_firebase_web_api_key
VITE_FIREBASE_DATABASE_ID=ai-receipt-track
VITE_GOOGLE_CLIENT_ID=your_google_oauth_client_id
VITE_API_BASE_URL=https://your-backend-url
VITE_PAYMENT_PAGE_URL=https://your-payment-hosted-page
```

Notes:

- `authDomain` and `projectId` are currently set in [firebase.ts](/C:/Users/John/Desktop/receipt-keeper-main/src/lib/firebase.ts).
- If you fork to another Firebase project, update those values there.

## Scripts

```bash
npm install
npm run dev
npm run build
npm run preview
npm run test
```

## Firestore Rules Expectations

Current app behavior expects rules that:

- restrict `receipts` and `categories` by `owner_email == request.auth.token.email`
- keep `users` client read-only
- keep billing-sensitive writes server-owned

If categories are editable from frontend, rules should allow only:

- `owner_email`
- `name`
- `description`

for category create/update.

## Key Paths

- Main settings/subscription UI: [Settings.tsx](/C:/Users/John/Desktop/receipt-keeper-main/src/pages/Settings.tsx)
- Receipt data hook: [useReceiptApi.ts](/C:/Users/John/Desktop/receipt-keeper-main/src/hooks/useReceiptApi.ts)
- Category data hook: [useCategoryApi.ts](/C:/Users/John/Desktop/receipt-keeper-main/src/hooks/useCategoryApi.ts)
- User plan hook: [useUserPlanApi.ts](/C:/Users/John/Desktop/receipt-keeper-main/src/hooks/useUserPlanApi.ts)

## Status

This frontend is optimized for a minimal-backend architecture: direct Firestore access for user-owned app data, with backend kept for security-critical operations only.
