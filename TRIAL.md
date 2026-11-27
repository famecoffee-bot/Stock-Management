# Test version (staging)

A separate Firebase project full of practice data, so you can try every feature
before anything goes near grove-mart or grove-system-kh. Nothing here touches grove-mart:
`npm run build:trial` refuses to build with grove-mart's settings, and the data
loader refuses to run against grove-mart.

## One-time setup

1. Firebase console: create a project or reuse a spare one (never grove-mart), make sure it is on Blaze,
   turn on Authentication > Email/Password, and add a web app.
2. Put that web app's config in `.env.trial` as one line of JSON:
   `VITE_FIREBASE_CONFIG={"apiKey":"…","authDomain":"…","projectId":"…",…}`
3. In `.firebaserc`, add the alias `"trial": "<test-project-id>"`.
4. Sign in, then create the test website and the `stock` database (once). Both are NEW
   things, so a spare project you reuse keeps everything it already has:
   ```
   npx firebase login
   npx firebase hosting:sites:create grove-stock-test --project trial   # skip if it already exists
   npx firebase firestore:databases:create stock --location asia-southeast1 --project trial
   ```

## Launch

```
npm ci && npm --prefix functions ci
npm run deploy:trial
```

The site is then at `https://grove-stock-test.web.app` (if that name is taken, pick another
and change `site` in `firebase.trial.json`).

## Load practice data (once)

Firebase console > Project settings > Service accounts > "Generate new private key".
Save it OUTSIDE this folder (e.g. Downloads), then:

```
# PowerShell
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\Users\<you>\Downloads\grove-stock-test-key.json"
npm run trial:data -- <test-project-id>
```

Logins (password `practice123`): owner@grove.kh (owner), vanna@grove.kh (manager at
Riverside), dara@grove.kh (staff at Riverside).

### Add the main warehouse (ស្តុកធំ) practice data

After the normal practice data, with the same key:

```
npm run trial:warehouse -- <test-project-id>
```

It adds a "Main stock" warehouse, links both branches to it, two daily orders waiting to be
sent, and a stock keeper login: sophea@grove.kh (password `practice123`).

When you are done testing, you can delete the whole test project in the Firebase console.
