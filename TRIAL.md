# Test version (staging)

A separate Firebase project full of practice data, so you can try every feature
before anything goes near grove-mart or grove-system-kh. Nothing here touches grove-mart:
`npm run build:trial` refuses to build with grove-mart's settings, and the data
loader refuses to run against grove-mart.

## One-time setup

1. Firebase console: create a project (e.g. `grove-stock-test`), upgrade it to Blaze,
   turn on Authentication > Email/Password, and add a web app.
2. Put that web app's config in `.env.trial` as one line of JSON:
   `VITE_FIREBASE_CONFIG={"apiKey":"…","authDomain":"…","projectId":"…",…}`
3. In `.firebaserc`, add the alias `"trial": "<test-project-id>"`.
4. Sign in and create the `stock` database (once):
   ```
   npx firebase login
   npx firebase firestore:databases:create stock --location asia-southeast1 --project trial
   ```

## Launch

```
npm ci && npm --prefix functions ci
npm run deploy:trial
```

The site is then at `https://<test-project-id>.web.app`.

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

When you are done testing, you can delete the whole test project in the Firebase console.
