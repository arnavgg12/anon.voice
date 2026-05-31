# Adding your own TURN server (for reliable connections on bad networks)

The app already works with free public TURN out of the box. But the free
OpenRelay relay is rate-limited and sometimes down. For anything you're
actually sharing widely, plug in your own TURN credentials.

The code is **already wired for this** — you don't touch any files. You just
set three environment variables on Render and redeploy. The server reads them
in `iceServers()` (see `server.js`); if they're absent it falls back to the
free public relay automatically.

> **Security:** these are secrets. Put them ONLY in the Render dashboard's
> Environment settings. Never paste them into the repo, a code file, a commit,
> a chat, or anywhere public. The repo is set up so secrets never need to live
> in it.

---

## Option A — Metered.ca (recommended, has a real free tier)

1. Go to **https://www.metered.ca/stun-turn** and create a free account.
2. In the dashboard, open your **TURN server** app. You'll see:
   - a list of TURN URLs (e.g. `turn:standard.relay.metered.ca:80`,
     `turn:standard.relay.metered.ca:443`,
     `turns:standard.relay.metered.ca:443?transport=tcp`)
   - a **username** and a **credential/password**
3. Check the current free-tier monthly transfer limit on their pricing page
   (it's generous for a hobby app, but confirm the live number — it changes).

Then in **Render → your service → Environment → Add Environment Variable**,
add these three (comma-separate multiple URLs, no spaces):

| Key              | Value (example — use YOUR dashboard's values)                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `TURN_URLS`      | `turn:standard.relay.metered.ca:80,turn:standard.relay.metered.ca:443,turns:standard.relay.metered.ca:443?transport=tcp` |
| `TURN_USERNAME`  | *(the username from your Metered dashboard)*                                                    |
| `TURN_CREDENTIAL`| *(the credential/password from your Metered dashboard)*                                         |

Click **Save Changes**. Render redeploys automatically. Done.

---

## Option B — Twilio Network Traversal Service

Twilio issues short-lived TURN credentials via API. Simplest static path:
generate a token, then paste its `urls` / `username` / `password` into the same
three env vars above. (Tokens expire, so for Twilio you'd eventually want the
server to mint them per-request — ask and I'll add that.)

---

## Option C — Self-host coturn (cheapest at scale, most effort)

On any small VPS:

```bash
sudo apt install coturn
# /etc/turnserver.conf — minimal:
#   listening-port=3478
#   tls-listening-port=5349
#   realm=yourdomain.com
#   user=myuser:mypassword
#   lt-cred-mech
sudo systemctl enable --now coturn
```

Then set:

| Key              | Value                                            |
| ---------------- | ------------------------------------------------ |
| `TURN_URLS`      | `turn:yourdomain.com:3478,turns:yourdomain.com:5349` |
| `TURN_USERNAME`  | `myuser`                                          |
| `TURN_CREDENTIAL`| `mypassword`                                      |

---

## How to verify it's actually relaying

1. Open the deployed site on a phone on **cellular data** (not Wi‑Fi) and a
   second device elsewhere. Cellular is the common strict-NAT case that fails
   with STUN-only.
2. In desktop Chrome you can also visit `chrome://webrtc-internals`, start a
   chat, and look at the selected candidate pair — `relay` means TURN is in use.
3. Sanity-check the config your server is handing out:
   `https://YOUR-RENDER-URL/ice` should list your TURN URLs.

If `/ice` shows your URLs but calls still fail on cellular, the TURN
credentials are wrong or the relay is unreachable — re-copy them from the
provider dashboard.
