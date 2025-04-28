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

Before you start, you must be in the rule of Administrator in netSuite and to create an Access Token to get `Consumer Key` and `Consumer Secret` and Integrations record to get `Token` and `Token Secret` in netSuite

You can find information and example [`here`](https://youtu.be/bM7KqjRr-h8?si=q1zG7PZQQjj6GhDr) 

### 1. Upload the RESTlet (for RESTlet mode)

If you want to use the RESTlet approach:

1. Open NetSuite.
2. Go to: **Customizations → Scripting → Scripts → New**
3. Upload the [`customscript_suiteql_restlet.js`](https://github.com/yossi126/suiteql-extension/tree/main/restlet-example)
4. Deploy the script and note the URL.

### 2. Open the Extension Sidebar

- Launch the **SuiteQL Runner** sidebar from the activity bar (or run `SuiteQL: Focus on SuiteQl Query View` from the Command Palette).

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


![Demo GIF](resources/example.gif)

## 🛠️ Additional Commands

### SuiteQL: Open Accounts Config

- Opens a simple JSON editor with all your saved NetSuite accounts.
- You can manually edit account details (Account ID, tokens, URL, etc).
- Useful for quick corrections, bulk changes, or advanced users.

⚡ Changes are applied immediately after saving.


### Run SuiteQL Query

- Lets you run a **single quick query** directly from the Command Palette.
- The result is displayed in the **VS Code Terminal**.
- It does **not save** the query into the chat/history.

⚡ Ideal for quick one-time lookups or testing simple queries.

---

## 📚 Commands and Usage

| Command                         | Description                                                                 |
|:--------------------------------|:----------------------------------------------------------------------------|
| `SuiteQL: Choose Account`       | Select which NetSuite account to use for querying.                         |
| `SuiteQL: Open Accounts Config` | Edit NetSuite accounts manually as JSON inside a VS Code Webview editor.    |
| `Run SuiteQL Query`    | Run a quick one-off SuiteQL query and see the result directly in Terminal.  |

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

## 📖 Notes

- You must have the rule of Administrator in netSuite and to create an Access Token and Integrations in netSuite
- RESTlet approach requires deploying the provided Restlet script from [`restlet-example/customscript_suiteql_restlet.js`](https://github.com/yossi126/suiteql-extension/tree/main/restlet-example)
- SuiteTalk REST API can work without any upload, only needing proper account credentials.
- Query results are displayed in either JSON view or Table view with easy switching.

---

## 📦 Publish Notes

If you're a developer cloning this extension:

```bash
npm install
npm run package

