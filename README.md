# Grove Stock

Stock management for Grove Coffee: ingredients, multi-branch stock, purchase orders,
recipes with automatic deduction on sales, counts, expiry, alerts and reports.

It runs in the **same Firebase project as grove-system-kh (`grove-mart`)**, as a
second website (`grove-stock-kh.web.app`), so staff use the same logins and sales
can be linked later.

Plan and data model: see the project's plan doc. Build status:

| Phase | What | Status |
| --- | --- | --- |
| 1 | Login, branches, items with units, users and branch roles | built |
| 2 | Stock per branch, receive, waste, adjust, transfers, movement history | next |
| 3 | Suppliers and purchase orders | |
| 4 | Recipes and auto deduction on sales | |
| 5 | Stock counts, expiry, low-stock alerts | |
| 6 | Reports and dashboard | |
| 7 | Link sales from grove-system-kh | |

## How the code is organised

```
src/
  lib/          firebase setup, data types, units, permissions, live data hooks
  components/   layout and small UI pieces
  pages/        one file per screen
functions/      Cloud Functions (codebase "stock": never touches grove's functions)
firestore/      inv.rules: the stock rules, to paste INTO grove's firestore.rules
tests/rules/    tests for those rules (run on the Firestore emulator)
```

Three rules keep the shared project safe:

1. Every collection name starts with `inv_`.
2. Cloud Functions use their own codebase, `stock`.
3. This repo has **no** `firestore` entry in `firebase.json`, so a deploy from here
   can never replace grove-system-kh's database rules. The stock rules are added
   to grove's `firestore.rules` by hand (see below).

## Run it on your computer

```
npm install
npm run dev          # opens http://localhost:5173
npm test             # unit tests
npm run test:rules   # security rule tests (needs Java)
```

## Going live (only with the owner's OK)

1. In Firebase console > Hosting > "Add another site", create `grove-stock-kh`.
2. Copy `firestore/inv.rules` into `grove-deploy/firestore.rules`, inside
   `match /databases/{database}/documents { ... }`, then deploy rules from
   grove-deploy as usual.
3. From this repo: `npm run build`, then
   `npx firebase deploy --only hosting,functions:stock`.
4. Open the site, sign in with your grove-system-kh owner email, and press
   "Create owner profile". Then add branches, items and staff.
