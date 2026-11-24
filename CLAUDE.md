# Grove Stock: notes for Claude

- Shares Firebase project `grove-mart` with the live POS grove-system-kh (code lives on the owner's PC, not in this repo).
- Never add a `firestore` key to firebase.json. Stock rules live in `firestore/inv.rules` and are merged by hand into grove's `firestore.rules`; deploying a separate rules file would wipe the POS rules.
- All collections start with `inv_` (see `src/lib/collections.ts`). Functions use codebase `stock`, region `asia-southeast1`.
- Stock changes only through Cloud Functions that write `inv_movements` and update `inv_stock` in one transaction. Clients never write those two collections.
- Quantities are stored in the item's base unit (g, ml, pcs). Money is stored in USD; KHR is shown with `inv_settings/main.usdToKhr`.
- Grove sales are in `coffee_sales`, `mart_sales`, `restaurant_sales` (fields include `items`, `totalUsd`, `branch`, `branchIdx`, `createdAt` string).
- Tests: `npm test` (vitest + functions node:test), `npm run test:rules` (Firestore emulator). Keep the rules tests in step with every rules change.
- The owner is learning: explain changes in plain English, step by step.
