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
| 2 | Stock per branch, receive, waste, adjust, transfers, movement history | built |
| 3 | Suppliers and purchase orders, receiving against an order | built |
| 4 | Menu with recipes per size, sales entry or CSV import, auto deduction, cancelling a sale | built |
| 5 | Stock counts with variance, expiry (use oldest first), low-stock and expiry alerts | built |
| 6 | Reports: sales, cost of ingredients, waste, count differences, purchases, stock value, Excel download | built |
| 7 | Link sales from grove-system-kh | next |

## How the code is organised

```
src/
  lib/          firebase setup, data types, units, permissions, live data hooks
  components/   layout and small UI pieces
  pages/        one file per screen
functions/      Cloud Functions (codebase "stock": never touches grove's functions)
firestore.rules security rules for the stock database only
tests/rules/    tests for those rules (run on the Firestore emulator)
functions/test-int/  stock ledger tests against the emulator (receive, waste, transfers, purchase orders, sales, counts)
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
npm run test:int     # stock ledger tests on the emulator (needs Java)
```

Practice without touching the real database: run `npm run emulators` in one window and
`npm run dev:local` in another. Everything you do then lives only in a throwaway practice database.

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
