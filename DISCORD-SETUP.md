# Discord sign-in for players: setup checklist

Players sign in with Discord. A tiny **Cloudflare Worker** (free, no card) confirms the login and
hands the site a Firebase sign-in. Everything else stays on Firebase's free plan.

**Safe to paste to Claude:** the Discord **Client ID** and the Worker address.
**Never paste anywhere:** the Discord **Client Secret** or the Google **key file** (they go straight into Cloudflare's secret store).

---

## Part A: Discord app (you, ~3 min)

- [ ] https://discord.com/developers/applications → **New Application** → name `I<3JVO` → accept Discord's terms → **Create**.
- [ ] **OAuth2** (left menu) → copy the **Client ID** → paste it to Claude.
- [ ] **OAuth2 → Redirects → Add Redirect**, add each of these, then **Save Changes**:
  ```
  https://i-love-jvo.web.app/auth/discord
  https://i-love-jvo.firebaseapp.com/auth/discord
  http://127.0.0.1:5000/auth/discord
  ```
  (Later, also `https://ilovejvo.com/auth/discord` once the domain is connected.)
- [ ] **OAuth2 → Client Secret → Reset Secret** → copy it somewhere private for Part C. Don't paste it in chat.

## Part B: Google signing key (you, ~3 min)

The Worker needs a key to sign Firebase logins. We use a separate account with **no permissions**, so the key can't do anything else.

- [ ] Open https://console.cloud.google.com/iam-admin/serviceaccounts?project=i-love-jvo
- [ ] **+ Create service account** → name `discord-signin` → **Create and continue** → skip the roles step → **Done**.
- [ ] Click `discord-signin@…` → **Keys** tab → **Add key → Create new key → JSON → Create**. A `.json` file downloads. Treat it like a password.

## Part C: Cloudflare (you, ~5 min)

- [ ] Create a free account at https://dash.cloudflare.com/sign-up (no card needed).
- [ ] In a terminal opened in this project folder, sign the Cloudflare tool in (a browser window opens; click **Allow**):
  ```
  npx.cmd wrangler@4.146.0 login
  ```
- [ ] Tell Claude. Claude deploys the Worker, then you run these two commands to store the secrets
  (Claude will open them in your terminal; they ask for input, so nothing is shown on screen):
  ```
  cd worker
  npx.cmd wrangler@4.146.0 secret put DISCORD_CLIENT_SECRET
  Get-Content "C:\Users\fanou\Downloads\i-love-jvo-xxxx.json" -Raw | npx.cmd wrangler@4.146.0 secret put FIREBASE_SERVICE_ACCOUNT
  ```
- [ ] **Delete the downloaded `.json` key file** once it's stored (and empty the Recycle Bin).

## Part D: Claude finishes

- [ ] Client ID into `public/js/config.js` and `worker/wrangler.toml`; Worker address into `public/js/config.js`.
- [ ] Redeploy the site, then you test: **Me → Sign in with Discord**.

---

### What it costs

| | |
|---|---|
| Cloudflare Workers free plan | 100,000 requests a day; one per sign-in. $0, no card |
| Firebase | Still the free Spark plan |
| Discord app | Free |

### If something goes wrong later

- **"Discord didn't accept the sign-in"**: check the redirect list in Part A matches the site address exactly.
- **Sign-in fails after Discord**: the Google key may have been deleted or disabled. Make a new one (Part B) and store it again (Part C).
- **Lost a secret?** Reset it where it came from (Discord or Google) and store the new one with `secret put`.
