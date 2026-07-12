% Microsoft 365 — App Registration for **Sign in with Microsoft (SSO)**
% One Helpdesk / Ticketing Platform
% Setup guide for the Project Lead

---

## What this is for

This app lets the people in your organisation **sign in to the helpdesk with their
Microsoft (Entra ID) account** instead of a helpdesk username and password. It uses
**OpenID Connect** — Microsoft proves who the person is, and the helpdesk then logs
them in. It applies to every role (admins, agents, and end-users/requestors).

> **This is a different app from the Mailbox connector.** Register a **separate** app
> for SSO. See the companion guide *Azure App for Mailbox*.

**Who performs this:** a person who can **register an app** in Microsoft Entra
(Application Administrator / Global Administrator).

---

## Before you start — copy the Redirect URI

The **Redirect URI** is **always shown in the helpdesk settings**; don't type it by
hand. Go to **Tenant Settings → Authentication** (the gear → *Authentication & SSO*)
and use the **Copy** button next to **Redirect URI**. You'll paste this value into
Azure in Part A (Steps 1 and 3). Always copy the **current** value from Settings —
Microsoft matches it character-for-character, so an exact copy matters.

---

## Part A — Register the app in Microsoft Entra

### Step 1 — Create the registration
1. Go to the [Microsoft Entra admin center](https://entra.microsoft.com) (or the
   [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID**).
2. **App registrations → + New registration**.
3. **Name:** e.g. `Helpdesk SSO`.
4. **Supported account types:** **Accounts in this organizational directory only
   (Single tenant)**.
   *Important — single tenant is required.* It is what limits sign-in to your own
   staff and makes first-time auto-provisioning safe. (The helpdesk will **reject** a
   multi-tenant value such as "common".)
5. **Redirect URI:** platform **Web** → paste the **Redirect URI** you copied above.
6. Click **Register**.

### Step 2 — Copy the two IDs
On the app's **Overview** page, copy:

- **Application (client) ID** — a GUID.
- **Directory (tenant) ID** — a GUID. *(Must be this GUID, not "common".)*

### Step 3 — Confirm the Redirect URI (if not set in Step 1)
1. Open **Authentication**.
2. Under **Platform configurations → Web → Redirect URIs**, ensure the helpdesk
   Redirect URI is listed; add it and **Save** if needed.
3. You do **not** need to enable implicit grant / ID tokens — the helpdesk uses the
   secure authorization-code flow.

### Step 4 — Create a client secret
1. **Certificates & secrets → Client secrets → + New client secret**.
2. Add a description and an expiry (e.g. 24 months). Click **Add**.
3. **Immediately copy the secret `Value`** (not the *Secret ID*). It is shown only once.

   > Copy the **Value** column. The *Secret ID* will **not** work.

### Step 5 — (Recommended) ensure email is returned
The helpdesk matches Microsoft users to helpdesk accounts by **email**.

1. Open **Token configuration → + Add optional claim**.
2. Token type **ID**, tick **email**, click **Add** (accept the prompt to enable the
   basic Microsoft Graph `email` permission if asked).

No admin consent for anything beyond basic sign-in is required — the default
`openid` / `profile` / `email` / `User.Read` permissions are sufficient.

---

## Part B — Enter the details in the helpdesk

1. Back in **Tenant Settings → Authentication**, enter:
   - **Application (client) ID** — from Step 2
   - **Directory (tenant) ID** — from Step 2 (the GUID)
   - **Client secret** — the **Value** from Step 4
2. *(Optional)* **Allowed email domains** — e.g. `yourcompany.com`. Only these domains
   may auto-create accounts on first sign-in. Blank = anyone in your directory.
3. *(Optional)* **Auto-create first-time users** — on by default; a first-time
   Microsoft sign-in with no existing account creates a portal **Requestor**. Turn it
   off to allow only pre-created users.
4. Turn on **Enable "Sign in with Microsoft"** and **Save**.

A **"Sign in with Microsoft"** button now appears on your organisation's login page.

---

## How your users sign in

- When you **create a user**, choose their **Sign-in method**: *Username & password*
  or *Microsoft (SSO)*. For a Microsoft user, **email is required** and no password is
  created. The choice is per user, so you can mix both in one organisation.
- **Break-glass:** admins can **always** still sign in with a password, even if their
  method is Microsoft — so a misconfigured app can't lock you out. To set a break-glass
  password for an admin, use **Users → Reset password**.

---

## Values to hand over

| From Entra | Goes into Tenant Settings → Authentication |
|---|---|
| Application (client) ID | **Application (client) ID** |
| Directory (tenant) ID (GUID) | **Directory (tenant) ID** |
| Client secret **Value** | **Client secret** |
| Redirect URI (copied from Settings) | register it in Entra → Authentication |

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `AADSTS50011: redirect URI does not match` | The Redirect URI in Entra differs from the one on the Authentication page. Copy it again exactly (including the trailing `/`). |
| `AADSTS7000215: Invalid client secret` | You used the **Secret ID** instead of the **Value**, or the secret expired. Create a new secret and paste its **Value**. |
| "This Microsoft account belongs to a different directory." | The Directory (tenant) ID is wrong, or the user is from another tenant. Use a single-tenant app + your own Directory ID (GUID). |
| The helpdesk won't save "common" as the tenant | Intentional — a single-tenant **GUID** is required. Use the Directory (tenant) ID from the app's Overview page. |
| "No account exists for this Microsoft user…" | Auto-create is off (or the domain isn't allowed) and no matching account exists. Create the user first, or enable auto-create / add the domain. |
| Button doesn't appear on the login page | SSO isn't **enabled**, or one of Client ID / Tenant ID / secret is missing. |
| Sign-in stops working after some weeks | The **client secret expired**. Create a new secret in Entra and paste the new Value. |

---

## Security notes

- Each organisation uses its own **single-tenant** app, so only accounts from **your**
  Microsoft directory can ever sign in.
- The client secret is stored **encrypted** and is never shown back in the UI or API.
- Rotate the **client secret** before its expiry date to avoid an outage.
