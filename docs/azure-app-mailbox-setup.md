% Microsoft 365 — App Registration for **Mailbox (Email-to-Ticket)**
% One Helpdesk / Ticketing Platform
% Setup guide for the Project Lead

---

## What this is for

This app lets the helpdesk **connect to a Microsoft 365 mailbox** so it can:

- **Pull incoming email into tickets** (IMAP), and
- **Send replies from that mailbox** (SMTP).

Microsoft has retired Basic Authentication for IMAP/SMTP, so the connection uses
**OAuth 2.0**. You register an app in Microsoft Entra (Azure AD), grant it the
mail permissions, and paste its details into the mailbox screen — the same way
you would configure any modern mail integration.

> **This is a different app from the "Sign in with Microsoft" (SSO) app.** Register
> a **separate** app for mailboxes. See the companion guide *Azure App for SSO*.

**Who performs this:** a person who is both an **Exchange administrator** (to enable
the mailbox protocols) and can **register an app** in Entra (Application
Administrator / Global Administrator).

---

## Before you start — collect two things

1. **The mailbox address** you want the helpdesk to use, e.g. `support@yourcompany.com`
   (a shared or licensed mailbox).
2. **The Redirect URI** — this is **always shown in the helpdesk settings**; don't
   type it by hand. Open the workspace's **Settings → Mailboxes → (add/edit a
   mailbox) → Connection**, choose **Microsoft 365 (OAuth)**, and use the **Copy**
   button next to **Redirect URI**. You'll paste this value into Azure in Part B, and
   again to confirm it in Part C. Always copy the **current** value from Settings —
   Microsoft matches it character-for-character, so an exact copy matters.

---

## Part A — Prepare the mailbox in Exchange (one-time)

OAuth still requires the mailbox's IMAP and authenticated-SMTP protocols to be
switched on. In the **Microsoft 365 admin** / **Exchange admin center**, or via
Exchange Online PowerShell:

```powershell
# Connect first:  Connect-ExchangeOnline

# Enable IMAP + authenticated SMTP for the mailbox
Set-CASMailbox -Identity support@yourcompany.com `
  -ImapEnabled $true `
  -SmtpClientAuthenticationDisabled $false

# If authenticated SMTP is disabled tenant-wide, allow it
# (or scope per-mailbox as above):
Set-TransportConfig -SmtpClientAuthenticationDisabled $false
```

- If your tenant uses **Security Defaults** or **Conditional Access**, make sure
  they don't block OAuth token issuance for this app / mailbox.
- No change to the mailbox password is needed — OAuth replaces password auth.

---

## Part B — Register the app in Microsoft Entra

### Step 1 — Create the registration
1. Go to the [Microsoft Entra admin center](https://entra.microsoft.com) (or the
   [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID**).
2. **App registrations → + New registration**.
3. **Name:** e.g. `Helpdesk Mailbox Connector`.
4. **Supported account types:** **Accounts in this organizational directory only
   (Single tenant)**.
5. **Redirect URI:** platform **Web** → paste the **Redirect URI** you copied above.
6. Click **Register**.

### Step 2 — Copy the two IDs
On the app's **Overview** page, copy:

- **Application (client) ID** — a GUID.
- **Directory (tenant) ID** — a GUID.

### Step 3 — Add the mail permissions
1. Open **API permissions → + Add a permission → APIs my organization uses**.
2. Search for and select **Office 365 Exchange Online**.
3. Choose **Delegated permissions** and tick:
   - **IMAP.AccessAsUser.All** (read the inbox)
   - **SMTP.Send** (send replies)
4. Click **Add permissions**.
5. Add **Microsoft Graph → Delegated → offline_access** the same way (lets the
   helpdesk refresh the connection without re-consenting). `openid` / `User.Read`
   are fine to leave as-is.
6. Click **Grant admin consent for &lt;your tenant&gt;** and confirm. (Admin consent
   avoids a per-user consent prompt and is required for the IMAP permission.)

### Step 4 — Create a client secret
1. **Certificates & secrets → Client secrets → + New client secret**.
2. Add a description and an expiry (e.g. 24 months). Click **Add**.
3. **Immediately copy the secret `Value`** (not the *Secret ID*). It is shown only once.

   > Copy the **Value** column. The *Secret ID* will **not** work.

---

## Part C — Enter the details in the helpdesk

1. In the helpdesk, go to the workspace's **Settings → Mailboxes** and add/edit the mailbox.
2. On the **Connection** tab, set **Authentication** to **Microsoft 365 (OAuth)** and enter:
   - **Application (client) ID** — from Step 2
   - **Directory (tenant) ID** — from Step 2
   - **Client secret** — the **Value** from Step 4
   - **Mailbox address / username** — e.g. `support@yourcompany.com`
3. Confirm the **Redirect URI** shown matches what you registered in Step 1.
4. Click **Connect mailbox**. A Microsoft sign-in opens — **sign in as the mailbox
   account** (or an admin authorising it) and accept the consent. Tokens are then
   stored (encrypted) and the mailbox shows **Connected**.
5. Use **Test connection** (inbound IMAP) and **Test SMTP** (outbound) to verify,
   then save. Optionally **Poll now** to pull mail immediately.

---

## Values to hand over

| From Entra | Goes into the mailbox's Connection tab |
|---|---|
| Application (client) ID | **Client ID** |
| Directory (tenant) ID | **Directory (tenant) ID** |
| Client secret **Value** | **Client secret** |
| Redirect URI (copied from Settings) | register it in Entra → Authentication |

Inbound server `outlook.office365.com:993` (SSL) and outbound `smtp.office365.com:587`
(STARTTLS) are filled in automatically for Microsoft 365.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `AADSTS50011: redirect URI does not match` | The Redirect URI in Entra differs from the one on the mailbox screen. Copy it again exactly (including the trailing `/`). |
| `AADSTS7000215: Invalid client secret` | You used the **Secret ID** instead of the **Value**, or the secret expired. Create a new secret and paste its **Value**. |
| "Connected" but Test connection fails on IMAP | IMAP not enabled for the mailbox — run `Set-CASMailbox -ImapEnabled $true`; confirm **IMAP.AccessAsUser.All** is granted with admin consent. |
| Test SMTP fails / `SmtpClientAuthentication is disabled` | Enable authenticated SMTP (`Set-CASMailbox -SmtpClientAuthenticationDisabled $false`, and org-level `Set-TransportConfig`). Confirm **SMTP.Send** is granted. |
| Consent screen says admin approval required | Click **Grant admin consent** on the app's API permissions page. |
| Connection drops after a few weeks | The **client secret expired**. Create a new secret in Entra and paste the new Value into the mailbox screen. |

---

## Security notes

- The mailbox uses a **single-tenant** app, so only your organisation's directory can issue tokens.
- The client secret and the mailbox tokens are stored **encrypted** and are never shown back in the UI.
- Rotate the **client secret** before its expiry date to avoid an outage.
