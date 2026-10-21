# Going live: checklist (free plan)

> **Status (21 Oct 2026): live at https://i-love-jvo.web.app.** Parts 1–4 are done (project `i-love-jvo`, admin login `jvo`). Only Part 5 (the domain) is left.
>
> To publish changes later: `npm run deploy` from a terminal in this folder (on this PC, call the CLI as `firebase.cmd`, because PowerShell blocks `.ps1` scripts).

Everything runs on Firebase's **free Spark plan**: no card, no bill. The only cost is the domain.
If the free limits are ever reached, the site pauses for the rest of the day; it can't charge you.

**Safe to paste to Claude:** the Firebase web config and the project ID (both public).
**Never paste anywhere:** admin passwords.

---

## Part 1: Firebase project (you)

- [ ] https://console.firebase.google.com → **Create a project** → name `I love JVO`. Note the **project ID**. Turn **Google Analytics off**.
  Stay on the **Spark (free)** plan. Don't upgrade.
- [ ] **Build → Firestore Database → Create database** → location **australia-southeast1 (Sydney)** (can't be changed later) → **production mode**.
- [ ] **Build → Authentication → Get started → Sign-in method → Email/Password → Enable** (just the first switch) → Save.
- [ ] ⚙️ **Project settings → General → Your apps → `</>` (Web)** → nickname `I<3JVO web` → don't tick Hosting → **Register** → **paste the `firebaseConfig` values to Claude**.

## Part 2: Admin logins (you)

Admins sign in with a **username + password**. Behind the scenes, username `george` is the Firebase account `george@users.ilovejvo.com`. That address never receives email.

For each admin:
- [ ] **Authentication → Users → Add user** → Email: `USERNAME@users.ilovejvo.com` → a strong password → **Add user**.
- [ ] Copy that user's **User UID** (the long code in the list).
- [ ] **Firestore → Start collection** `admins` (first time) → **Document ID = the User UID** → field `name` (string) = their name → Save.

Forgotten password? Delete the user, add them again with a new password, and update their `admins` document to the new UID.
(Prefer password-reset emails? Use a real email address as the login instead; the sign-in box accepts full emails too.)

## Part 3: Your terminal (in the project folder)

- [ ] Sign the Firebase tools in to your Google account (a browser window opens):
  ```
  firebase login
  ```
- [ ] Tell Claude it's done.

## Part 4: Claude deploys

- [ ] Live config into `public/js/config.js`, `prod` alias in `.firebaserc`.
- [ ] `npm run deploy`. This checks settings, runs the tests, then publishes the site and the database rules.
- [ ] Check `https://PROJECT-ID.web.app`, sign in at `/admin`, add the real teams, players and events.

## Part 5: The domain (ilovejvo.com)

- [ ] Buy `ilovejvo.com` (e.g. Cloudflare Registrar, Porkbun, Namecheap). Skip add-ons: no paid email, "premium DNS" or SSL packages.
- [ ] Firebase console → **Hosting → Add custom domain** → `ilovejvo.com` (and `www` redirecting to it) → add the DNS records it shows at your registrar. Free HTTPS follows within minutes to 24 hours.
- [ ] **Authentication → Settings → Authorized domains → Add domain** → `ilovejvo.com`.

## Part 6: Image uploads (team logos, profile pictures, GIF banners and backgrounds)

Free and no card. The Cloudflare Worker that does Discord sign-in also stores the images, in **Workers KV** (free plan: 1 GB, 100,000 image views and 1,000 uploads a day).

- [x] Storage created: `wrangler kv namespace create MEDIA` (its id is in `worker/wrangler.toml`).
- [x] `npx wrangler@4.146.0 deploy` from `worker/`, then `liveUploadsReady = true` in `public/js/config.js` and deploy the site.

The Worker checks every upload: the person's Firebase sign-in (checked against Google's keys), that the team or player is theirs (read from the database), that it really is a PNG/JPG/WebP/GIF, and the size (2 MB pictures, 4 MB banners, 6 MB backgrounds). Admins can remove anything from **Teams & players**.

To test on this computer: `npm run dev` (Firebase emulators) and `npm run worker` (the Worker, port 8787) side by side.

---

### Free plan limits (per day)

| | Free allowance | What it means here |
|---|---|---|
| Database reads | 50,000 | Roughly 1,000+ visitors a day browsing several pages |
| Database writes | 20,000 | Far more than admins will ever enter |
| Hosting transfer | 360 MB | Pages are small; the logo is the biggest file (~30 KB) |
| Sign-ins | Free | Email/password is free on Spark |
