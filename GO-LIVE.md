# Going live: checklist

Parts 1–3 are yours: accounts, payment and secrets. Part 4 is Claude's. Tick as you go.

**What's safe to paste to Claude:** the Firebase web config, the project ID and the Discord **Client ID**. These are public.
**Never paste anywhere:** the Discord **Client Secret** (Part 3 stores it safely).

---

## Part 1: Firebase project

- [ ] **Create the project.** Go to https://console.firebase.google.com → **Create a project**.
  - Name: `I love JVO`. Note the **project ID** it shows underneath (e.g. `ilovejvo` or `ilovejvo-1a2b3`).
  - Google Analytics: **turn it off**. It isn't needed.
- [ ] **Upgrade to Blaze (pay-as-you-go).** In the console, bottom-left: **Spark → Upgrade**. Add your billing account and card.
- [ ] **Set budget alerts** (so you get emailed long before it costs anything real):
  Google Cloud console → **Billing → Budgets & alerts → Create budget** → amount **$5** → alert thresholds **20%, 50%, 100%** (emails at $1, $2.50, $5).
  Budget alerts only email you; they don't stop the site.
- [ ] **Create the database.** **Build → Firestore Database → Create database**:
  - Location: **australia-southeast1 (Sydney)**. *This can never be changed*, and the server code expects Sydney.
  - Start in **production mode**. Our own rules replace the defaults on deploy.
- [ ] **Turn on sign-in.** **Build → Authentication → Get started**. You don't need to enable any provider. Discord sign-in works through our own server function.
- [ ] **Register the web app.** ⚙️ **Project settings → General → Your apps → `</>` (Web)**:
  - Nickname: `I<3JVO web`. **Don't** tick "Also set up Firebase Hosting" (Claude does that).
  - Copy the `firebaseConfig` values (apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId) and **paste them to Claude**.

## Part 2: Discord app

- [ ] Go to https://discord.com/developers/applications → **New Application** → name it `I<3JVO` → accept Discord's developer terms.
- [ ] **OAuth2** page → copy the **Client ID** and **paste it to Claude**.
- [ ] **OAuth2 → Redirects → Add Redirect.** Add all of these (replace `PROJECT-ID`), then **Save Changes**:
  ```
  https://PROJECT-ID.web.app/auth/discord
  https://PROJECT-ID.firebaseapp.com/auth/discord
  http://127.0.0.1:5000/auth/discord
  ```
  Once the domain is connected, also add `https://ilovejvo.com/auth/discord`.
- [ ] **OAuth2 → Reset Secret** → copy the **Client Secret**. Keep it for Part 3. **Don't paste it into chat.**

## Part 3: Your terminal (in the project folder)

- [ ] Sign the Firebase tools in to your Google account (a browser window opens):
  ```
  firebase login
  ```
- [ ] Store the Discord secret in Google Secret Manager. Paste the secret when it asks; it won't show on screen:
  ```
  firebase functions:secrets:set DISCORD_CLIENT_SECRET --project PROJECT-ID
  ```
- [ ] Optional, for testing Discord sign-in locally: open `functions/.secret.local` and put the secret after `DISCORD_CLIENT_SECRET=`. Git ignores that file.
- [ ] Tell Claude it's done.

## Part 4: Claude fills in settings and deploys

- [ ] Live config into `public/js/config.js`, Client ID into `config.js` and `functions/.env`, `prod` alias in `.firebaserc`.
- [ ] `npm run deploy`. This checks settings, runs the tests, then deploys the site, database rules and server functions.
- [ ] Turn on automatic cleanup of old function builds (avoids small storage fees).

## Part 5: Make yourself the first admin

- [ ] **Allow the server to create sign-ins** (one-time, after the first deploy):
  Google Cloud console → **IAM & Admin → IAM** → find `PROJECT-NUMBER-compute@developer.gserviceaccount.com` → ✏️ **Edit** → **Add another role** → **Service Account Token Creator** → **Save**.
- [ ] Open `https://PROJECT-ID.web.app/admin` → **Sign in with Discord**. It'll say "Not an admin yet" and show your ID, like `discord:123456789012345678`.
- [ ] Firebase console → **Firestore** → **Start collection** `admins` → Document ID = **that ID** → add field `name` (string) = your name → Save.
- [ ] Refresh `/admin`. You're in. Add the real events.

## Part 6: The domain (ilovejvo.com)

- [ ] Buy `ilovejvo.com` from any registrar (e.g. Cloudflare Registrar, Porkbun, Namecheap). Skip add-ons: no paid email, "premium DNS" or SSL packages. Firebase gives free HTTPS.
- [ ] Firebase console → **Hosting → Add custom domain** → `ilovejvo.com` (and optionally `www.ilovejvo.com` redirecting to it).
- [ ] Add the DNS records Firebase shows at your registrar. Verification and the free HTTPS certificate can take from a few minutes up to 24 hours.
- [ ] Add `https://ilovejvo.com/auth/discord` to the Discord app's redirects (Part 2).

---

### What it costs

| Item | Cost |
|---|---|
| Hosting, database, sign-in | Free allowance; far above this site's needs |
| Server functions (Discord sign-in, audit log) | Free allowance covers millions of calls a month |
| Secret storage, build storage | Cents at most, with the cleanup turned on |
| ilovejvo.com | Roughly US$10–15/year (check the registrar's renewal price, not just year one) |
