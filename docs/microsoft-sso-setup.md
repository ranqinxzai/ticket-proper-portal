# Sign in with Microsoft — Tenant Setup Guide

This lets the people in **your** organisation sign in to the helpdesk with their
Microsoft (Entra ID / Azure AD) account instead of a username and password.

It works exactly like configuring a **mailbox**: *you* register your own app in
Microsoft, then paste its details into the helpdesk. We never hold one shared
Microsoft app — each organisation brings its own, and your credentials stay
encrypted and private to your workspace.

> **Who can do this:** a person who is an **admin in your helpdesk** *and* can
> register an app in your company's Microsoft Entra (Azure AD) directory
> (typically an *Application Administrator* / *Global Administrator*).

---

## Before you start — copy your Redirect URI

1. In the helpdesk, go to **Tenant Settings → Authentication** (the gear → *Authentication & SSO*).
2. Copy the **Redirect URI** shown there. It looks like:

   ```
   https://<your-helpdesk-host>/api/v1/t/<your-org>/itsm/auth/sso/microsoft/callback/
   ```

   Keep this handy — you'll paste it into Microsoft in Step 3. Use it **exactly**
   as shown (Microsoft matches it character-for-character, including the trailing `/`).

---

## Part A — Register the app in Microsoft Entra

### Step 1 — Create the app registration
1. Go to the [Microsoft Entra admin center](https://entra.microsoft.com) (or [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID**).
2. Open **App registrations → + New registration**.
3. **Name:** anything recognisable, e.g. `Helpdesk SSO`.
4. **Supported account types:** choose
   **“Accounts in this organizational directory only (Single tenant)”**.
   *(Recommended. Single-tenant is what keeps sign-in limited to your own staff and
   makes first-time auto-provisioning safe.)*
5. **Redirect URI:** set the platform to **Web** and paste the **Redirect URI** you
   copied above.
6. Click **Register**.

### Step 2 — Note your two IDs
On the app's **Overview** page, copy:
- **Application (client) ID** — a GUID.
- **Directory (tenant) ID** — a GUID.

You'll paste both into the helpdesk.

### Step 3 — Confirm the Redirect URI (if you skipped it in Step 1)
1. Open **Authentication** in the left menu.
2. Under **Platform configurations → Web → Redirect URIs**, make sure your
   helpdesk Redirect URI is listed. Add it if needed, then **Save**.
3. You do **not** need to enable implicit grant / ID tokens — we use the secure
   authorization-code flow.

### Step 4 — Create a client secret
1. Open **Certificates & secrets → Client secrets → + New client secret**.
2. Add a description and pick an expiry (e.g. 24 months). Click **Add**.
3. **Immediately copy the secret `Value`** (not the *Secret ID*). Microsoft only
   shows it once.

   > ⚠️ Copy the **Value** column. The *Secret ID* will **not** work.

### Step 5 — (Recommended) make sure email is returned
We match Microsoft users to helpdesk accounts by **email**.
1. Open **Token configuration → + Add optional claim**.
2. Token type **ID**, tick **email**, click **Add** (accept the prompt to turn on the
   Microsoft Graph `email` permission if asked).

   *(Most directories already return `email`/`preferred_username`; this just makes it
   reliable. No admin consent for anything beyond basic sign-in is required.)*

---

## Part B — Enter the details in the helpdesk

1. Back in **Tenant Settings → Authentication**, fill in:
   - **Application (client) ID** → from Step 2
   - **Directory (tenant) ID** → from Step 2
   - **Client secret** → the **Value** from Step 4
2. (Optional) **Allowed email domains** — e.g. `acme.com`. Only these domains may
   auto-create accounts on first sign-in. Leave blank to allow anyone in your directory.
3. (Optional) **Auto-create first-time users** — on by default. When a directory user
   signs in with no existing account, they get a portal **Requestor** account created
   from their Microsoft profile. Turn it off to allow only pre-created users.
4. Turn on **Enable “Sign in with Microsoft”** and click **Save changes**.

A **“Sign in with Microsoft”** button now appears on your org's login page.

---

## How your users sign in

- When you **create a user**, pick their **Sign-in method**:
  - **Username & password** — the classic login (a one-time password is generated).
  - **Microsoft (SSO)** — they sign in with the Microsoft button; **email is required**
    and **no password is created** for them.
- The method is set per user, so you can mix password and Microsoft users in the same org.
- It applies to **every role** — admins, agents, and requestors alike.

---

## Important notes

- **Break-glass admin access.** Admin users can *always* still sign in with a password,
  even if their method is Microsoft. This is deliberate: if the Microsoft app is ever
  misconfigured or the secret expires, an admin can still get in and fix it. To give an
  admin a break-glass password, use **Users → Reset password** on their row.
- **Secret expiry.** The client secret you created has an expiry date. Before it lapses,
  create a **new** secret in Entra (Step 4) and paste the new Value into the
  Authentication page — otherwise Microsoft sign-in will stop working.
- **Switching a user to Microsoft.** Set their method to Microsoft and make sure their
  email matches their Microsoft account. Their password stops being accepted (unless
  they're a break-glass admin).
- **Security model.** Each tenant uses its own single-tenant app, so only accounts from
  *your* Microsoft directory can ever sign in. The client secret is stored encrypted and
  is never shown back in the UI or API.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `AADSTS50011: redirect URI … does not match` | The Redirect URI in Entra ≠ the one on the Authentication page. Copy it again **exactly** (incl. trailing `/`). |
| `AADSTS7000215: Invalid client secret` | You pasted the **Secret ID** instead of the **Value**, or the secret expired. Create a new secret and paste its **Value**. |
| “This Microsoft account belongs to a different directory.” | The **Directory (tenant) ID** is wrong, or the user is from another tenant. Use a single-tenant app + your own Directory ID. |
| “No account exists for this Microsoft user…” | Auto-create is off (or domain not allowed) and no matching account exists. Create the user first, or enable auto-create / add the domain. |
| Button doesn't appear on the login page | SSO isn't **enabled**, or one of Client ID / Tenant ID / secret is missing. Re-check the Authentication page. |
| “This account signs in with Microsoft…” on the password form | Expected — that user's method is Microsoft. Use the **Sign in with Microsoft** button. |
