# Going live: checklist (free plan)

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

---

### Free plan limits (per day)

| | Free allowance | What it means here |
|---|---|---|
| Database reads | 50,000 | Roughly 1,000+ visitors a day browsing several pages |
| Database writes | 20,000 | Far more than admins will ever enter |
| Hosting transfer | 360 MB | Pages are small; the logo is the biggest file (~30 KB) |
| Sign-ins | Free | Email/password is free on Spark |
