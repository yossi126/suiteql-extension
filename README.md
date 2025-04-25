# SuiteQL Runner

A Visual Studio Code extension that lets you write and run SuiteQL queries directly against your NetSuite account.

---

## ✨ Features

- 🔎 Run SuiteQL queries from a built-in sidebar or tab view
- 🗂️ Manage multiple NetSuite accounts (RESTlet or SuiteTalk)
- 📋 View results in JSON or table format
- 🧠 Minimal config, easy to get started

---

## 🚀 Getting Started

### 1. Upload the RESTlet (for RESTlet mode)

If you want to use the RESTlet approach:

1. Open NetSuite.
2. Go to: **Customizations → Scripting → Scripts → New**
3. Upload the `suiteql.restlet.js` (provided in the extension instructions).
4. Deploy the script and note the URL.

### 2. Open the Extension Sidebar

- Launch the **SuiteQL Runner** sidebar from the activity bar (or run `SuiteQL: Open` from the Command Palette).

### 3. Add Your NetSuite Account

Click the ⚙️ icon in the top right of the view and choose “➕ Set up new account”.  
Fill in:

- `Account ID` (your realm)
- `Consumer Key`, `Consumer Secret`
- `Token`, `Token Secret`
- `URL` — either:
  - the **SuiteQL RESTlet** URL  
  - or: `https://{account_id}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`

> You can save multiple accounts and switch between them as needed.

---

## 📝 Usage

1. Type a SuiteQL query (e.g. `SELECT id, entityid FROM Employee`)
2. Click **Run**
3. See results in JSON or Table format
4. Delete past queries if needed

---

## ⚙️ Authentication

This extension uses **OAuth 1.0a** and does not require saving credentials to disk — they’re stored securely using VS Code’s global storage.

---

## 💡 Tips

- For **SuiteTalk**, you don't need to deploy anything in NetSuite. Just use the REST API URL.
- You can edit or delete saved accounts anytime by clicking the ⚙️ again.

---

## 📦 Publish Notes

If you're a developer cloning this extension:

```bash
npm install
npm run package
