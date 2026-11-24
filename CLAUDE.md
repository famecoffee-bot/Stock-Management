# Grove Stock: notes for Claude

## Hard rule from the owner (2026-11-24)
This project must NEVER change or delete anything of grove-system-kh (grove-system-kh.web.app).
grove-system-kh's data may only be READ.

How the code keeps that promise:
- The stock app has its OWN Firestore database, `stock`, in the grove-mart project. grove-system-kh uses `(default)`.
  The web app opens only `stock` (`src/lib/firebase.ts`). Functions write only to `stock`; `groveDb` (default) is read-only.
- `firebase.json` lists only the `stock` database's rules. Never add the `(default)` database, and never edit
  grove's `firestore.rules` (it lives on the owner's PC in `My Drive/Grove Project/grove-deploy`, not here).
- Functions use their own codebase `stock`, region `asia-southeast1`. Hosting uses its own site `grove-stock-kh`.
  Never deploy without `--only hosting,functions:stock,firestore:stock`.
- Logins are shared (Firebase Auth). Never change an existing login: `invSetPassword` only works on users with
  `createdByStock: true`, and `invCreateUser` refuses emails that already exist.

## Conventions
- All collections start with `inv_` (see `src/lib/collections.ts`).
- Stock changes only through Cloud Functions that write `inv_movements` and update `inv_stock` in one transaction.
- Quantities are in the item's base unit (g, ml, pcs). Money is in USD; KHR is shown with `inv_settings/main.usdToKhr`.
- Grove sales (read-only, `(default)` db): `coffee_sales`, `mart_sales`, `restaurant_sales` (fields include
  `items`, `totalUsd`, `branch`, `branchIdx`, `createdAt` string). Grove also has `{shop}_supplyItems`, `_stockCounts`.
- Tests: `npm test` (vitest + functions node:test), `npm run test:rules` (Firestore emulator).
- The owner is learning: explain changes in plain English, step by step.
