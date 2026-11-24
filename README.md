# Grove Stock

Stock management for Grove Coffee: ingredients, multi-branch stock, purchase orders,
recipes with automatic deduction on sales, counts, expiry, alerts and reports.

It runs in the **same Firebase project as grove-system-kh (`grove-mart`)**, but with
its **own database (`stock`)** and its own website (`grove-stock-kh.web.app`).
grove-system-kh is never changed: the stock app only *reads* its data (owner list,
and later its sales).

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
firestore.rules security rules for the stock database only
tests/rules/    tests for those rules (run on the Firestore emulator)
```

How grove-system-kh stays untouched:

1. The stock app writes only to its own database, `stock`. grove-system-kh uses `(default)`.
2. Its rules file covers only the `stock` database; grove's rules file is never edited.
3. Cloud Functions use their own codebase, `stock`, and the website is its own site.
4. Logins are shared, but the stock app never changes an existing login.

## Run it on your computer

```
npm install
npm run dev          # opens http://localhost:5173
npm test             # unit tests
npm run test:rules   # security rule tests (needs Java)
```

## Going live (only with the owner's OK)

Each step only ADDS something new to the grove-mart project:

1. Firebase console > Firestore > "Create database": name `stock`, location
   `asia-southeast1`, production mode.
2. Firebase console > Hosting > "Add another site": `grove-stock-kh`.
3. From this repo: `npm run build`, then
   `npx firebase deploy --only hosting,functions:stock,firestore:stock`.
   Always use `--only` exactly like this.
4. Open the site, sign in with your grove-system-kh owner email, and press
   "Create owner profile". Then add branches, items and staff.
