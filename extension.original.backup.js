const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const OAuth = require('oauth-1.0a');
const crypto = require('crypto');
const axios = require('axios');

// === ACCOUNT MANAGEMENT ===

function loadAccounts(context) {
  let accounts = context.globalState.get('suiteql.accounts', []);
  if (accounts.length === 0) {
    const p = path.join(context.extensionPath, 'auth.json');
    if (fs.existsSync(p)) {
      try {
        const a = JSON.parse(fs.readFileSync(p, 'utf8'));
        accounts = [a];
        context.globalState.update('suiteql.accounts', accounts);
      } catch { }
    }
  }
  return accounts;
}

function saveAccounts(context, accounts) {
  return context.globalState.update('suiteql.accounts', accounts);
}

function getCurrentAccount(context) {
  const current = context.globalState.get('suiteql.current');
  const accounts = context.globalState.get('suiteql.accounts', []);
  return accounts.find(a => a.account === current) || accounts[0];
}

function getNonce() {
  return Array.from({ length: 16 }, () => Math.random().toString(36)[2]).join('');
}

function showAddAccountWebview(context) {
  const panel = vscode.window.createWebviewPanel(
    'suiteqlAddAccount',
    'Add NetSuite Account',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  const nonce = getNonce();
  panel.webview.html = `
  <!DOCTYPE html>
  <html>
  <body style="font-family:sans-serif;padding:1em;">
    <h2>Add NetSuite Account</h2>
    <label>Account ID:</label><br><input id="account" style="width:100%"><br><br>
    <label>URL:</label><br><input id="url" style="width:100%"><br><br>
    <label>Consumer Key:</label><br><input id="consumerKey" style="width:100%"><br><br>
    <label>Consumer Secret:</label><br><input id="consumerSecret" style="width:100%"><br><br>
    <label>Token:</label><br><input id="token" style="width:100%"><br><br>
    <label>Token Secret:</label><br><input id="tokenSecret" style="width:100%"><br><br>
    <button onclick="save()">Save Account</button>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      function save() {
        const data = {
          account: document.getElementById('account').value,
          url: document.getElementById('url').value,
          consumerKey: document.getElementById('consumerKey').value,
          consumerSecret: document.getElementById('consumerSecret').value,
          token: document.getElementById('token').value,
          tokenSecret: document.getElementById('tokenSecret').value
        };
        vscode.postMessage({ command: 'saveAccount', data });
      }
    </script>
  </body>
  </html>`;

  panel.webview.onDidReceiveMessage(async msg => {
    if (msg.command === 'saveAccount') {
      const accounts = loadAccounts(context);
      accounts.push(msg.data);
      await saveAccounts(context, accounts);
      await context.globalState.update('suiteql.current', msg.data.account);
      vscode.window.showInformationMessage(`Added and selected account: ${msg.data.account}`);
      panel.dispose();
    }
  });
}

async function chooseAccount(context) {
  const accounts = loadAccounts(context);
  const picks = accounts.map(a => ({ label: a.account, description: a.url }));
  picks.push({ label: '➕ Set up new account', description: '' });

  const choice = await vscode.window.showQuickPick(picks, { placeHolder: 'Select NetSuite account' });
  if (!choice) return;

  if (choice.label === '➕ Set up new account') {
    showAddAccountWebview(context);
  } else {
    await context.globalState.update('suiteql.current', choice.label);
    vscode.window.showInformationMessage(`Selected account ${choice.label}`);
  }
}

// === SIGNED REQUEST USING CURRENT ACCOUNT ===

async function sendSignedRequestWithAccount(context, query) {
  const cfg = getCurrentAccount(context);
  const oauth = OAuth({
    consumer: { key: cfg.consumerKey, secret: cfg.consumerSecret },
    signature_method: 'HMAC-SHA256',
    hash_function: (base, key) =>
      crypto.createHmac('sha256', key).update(base).digest('base64')
  });
  const token = { key: cfg.token, secret: cfg.tokenSecret };
  const requestData = {
    url: cfg.url,
    method: 'POST'
  };
  const authHeader = oauth.toHeader(oauth.authorize(requestData, token));
  authHeader.Authorization += `, realm="${cfg.account}"`;

  const resp = await axios.post(cfg.url, { query }, {
    headers: {
      ...authHeader,
      'Content-Type': 'application/json'
    }
  });
  return resp.data;
}

// === WEBVIEW PROVIDER ===

class SuiteQLViewProvider {
  constructor(context) {
    this.context = context;
  }

  resolveWebviewView(webviewView) {
    this.webview = webviewView;
    webviewView.webview.options = { enableScripts: true };
    this._render();

    webviewView.webview.onDidReceiveMessage(async msg => {
      if (msg.command === 'runQuery') {
        webviewView.webview.postMessage({ command: 'loading' });
        let entry = { query: msg.query };
        try {
          const resp = await sendSignedRequestWithAccount(this.context, msg.query);
          entry.result = resp;
        } catch (err) {
          entry.error = err.message;
        }
        const history = this.context.workspaceState.get('suiteql.history', []);
        history.push(entry);
        await this.context.workspaceState.update('suiteql.history', history);
        this._render();
      }
    });
  }

  openAsEditor() {
    const panel = vscode.window.createWebviewPanel(
      'suiteqlQueryEditor',
      'SuiteQL Query Editor',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.webview = panel;
    this._render();
    panel.webview.onDidReceiveMessage(msg => {
      if (msg.command === 'runQuery') {
        panel.webview.postMessage({ command: 'loading' });
        (async () => {
          let entry = { query: msg.query };
          try {
            const resp = await sendSignedRequestWithAccount(this.context, msg.query);
            entry.result = resp;
          } catch (err) {
            entry.error = err.message;
          }
          const history = this.context.workspaceState.get('suiteql.history', []);
          history.push(entry);
          await this.context.workspaceState.update('suiteql.history', history);
          this._render();
        })();
      }
    });
  }

  _render() {
    const history = this.context.workspaceState.get('suiteql.history', []);
    this.webview.webview.html = this._getHtml(history);
  }

  _getHtml(history) {
    const nonce = getNonce();
    const entriesHtml = history.map((entry, i) => {
      const q = entry.query.replace(/</g, '&lt;');
      let body;
      if (entry.error) {
        body = `<pre style="color:#f44747;">Error: ${entry.error}</pre>`;
      } else {
        const raw = entry.result.data || entry.result;
        const jsonView = `<pre>${JSON.stringify(entry.result, null, 2)}</pre>`;
        let tableView = '<p>No results.</p>';
        if (Array.isArray(raw) && raw.length) {
          const hdrs = Object.keys(raw[0]);
          const thead = `<thead><tr>${hdrs.map(h => `<th>${h}</th>`).join('')}</tr></thead>`;
          const rows = raw.map(r =>
            `<tr>${hdrs.map(h => `<td>${r[h] != null ? r[h] : ''}</td>`).join('')}</tr>`
          ).join('');
          tableView = `<table>${thead}<tbody>${rows}</tbody></table>`;
        }
        body = `
          <div class="buttons">
            <button onclick="showJson(${i})">JSON</button>
            <button onclick="showTable(${i})">Table</button>
          </div>
          <div id="json-${i}" class="view json">${jsonView}</div>
          <div id="table-${i}" class="view table" style="display:none;">${tableView}</div>
        `;
      }
      return `<div class="entry">
                <div class="query"><strong>Query:</strong> ${q}</div>
                ${body}
              </div>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8">
  <style>
    body { font-family:Consolas,monospace;background:#1e1e1e;color:#d4d4d4;
           margin:0;display:flex;flex-direction:column;height:100vh; }
    #chat { flex:1;overflow-y:auto;padding:10px; }
    .entry { background:#252526;padding:8px;margin-bottom:8px;border-left:4px solid #007acc; }
    .query { margin-bottom:6px; }
    .buttons { margin-bottom:6px; }
    .buttons button { margin-right:4px; }
    .view { background:#333;padding:6px;margin-bottom:10px; }
    table { width:100%;border-collapse:collapse; }
    th,td { border:1px solid #555;padding:4px 6px;color:#ddd; }
    #input { display:flex;padding:8px;border-top:1px solid #444; }
    #query { flex:1;padding:6px;background:#2d2d2d;color:#ccc;border:1px solid #555; }
    #run { margin-left:8px;padding:6px 12px; }
    .spinner { margin-left:8px;border:4px solid #444;border-top:4px solid #007acc;
               border-radius:50%;width:18px;height:18px;animation:spin 1s linear infinite;
               display:none; }
    @keyframes spin { from{transform:rotate(0deg);} to{transform:rotate(360deg);} }
    
  </style>
</head>
<body>
  <div id="chat">${entriesHtml}</div>
  <div id="input">
    <input id="query" placeholder="Enter SuiteQL query…" />
    <button id="run">Run</button>
    <div class="spinner" id="spinner"></div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const chat    = document.getElementById('chat');
    const input   = document.getElementById('query');
    const runBtn  = document.getElementById('run');
    const spinner = document.getElementById('spinner');

    function scrollToBottom() { chat.scrollTop = chat.scrollHeight; }

    runBtn.addEventListener('click', () => {
      const q = input.value.trim(); if (!q) return;
      spinner.style.display = 'inline-block';
      runBtn.disabled = true;
      vscode.postMessage({ command:'runQuery', query:q });
      input.value = '';
    });

    window.addEventListener('message', e => {
      const msg = e.data;
      if (msg.command === 'loading') {
        spinner.style.display = 'inline-block';
        runBtn.disabled = true;
        return;
      }
      spinner.style.display = 'none';
      runBtn.disabled = false;

      if (msg.command === 'showResults' || msg.command === 'showError') {
        scrollToBottom();
      }
    });

    function showJson(i) {
      document.getElementById('json-'+i).style.display = '';
      document.getElementById('table-'+i).style.display = 'none';
    }
    function showTable(i) {
      document.getElementById('json-'+i).style.display = 'none';
      document.getElementById('table-'+i).style.display = '';
    }

    scrollToBottom();
  </script>
</body>
</html>`;
  }
}

function activate(context) {
  const provider = new SuiteQLViewProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('suiteqlView', provider),
    vscode.commands.registerCommand('suiteql.openEditor', () => provider.openAsEditor()),
    vscode.commands.registerCommand('suiteql.runQuery', async () => {
      const q = await vscode.window.showInputBox({ prompt: 'Enter SuiteQL query' });
      if (!q) return;
      const out = vscode.window.createOutputChannel('SuiteQL Results');
      out.show(); out.appendLine('Query: ' + q);
      try {
        const r = await sendSignedRequestWithAccount(context, q);
        out.appendLine(JSON.stringify(r, null, 2));
      } catch (e) {
        out.appendLine('Error: ' + e.message);
      }
    }),
    vscode.commands.registerCommand('suiteql.chooseAccount', () => chooseAccount(context)),
    vscode.commands.registerCommand('suiteql.openAccountsConfig', () => {
      const panel = vscode.window.createWebviewPanel(
        'suiteqlAccountsConfig',
        'SuiteQL Accounts Config',
        vscode.ViewColumn.One,
        { enableScripts: true }
      );

      const accounts = loadAccounts(context);
      panel.webview.html = `<!DOCTYPE html>
        <html><body style="font-family:sans-serif;padding:1em;">
          <h2>NetSuite Accounts</h2>
          <textarea id="json" style="width:100%;height:300px;">${JSON.stringify(accounts, null, 2)}</textarea><br><br>
          <button onclick="save()">💾 Save</button>
          <script>
            const vscode = acquireVsCodeApi();
            function save() {
              try {
                const data = JSON.parse(document.getElementById('json').value);
                vscode.postMessage({ command: 'saveAccounts', data });
              } catch (e) {
                alert('Invalid JSON: ' + e.message);
              }
            }
          </script>
        </body></html>`;

      panel.webview.onDidReceiveMessage(async msg => {
        if (msg.command === 'saveAccounts') {
          await saveAccounts(context, msg.data);
          vscode.window.showInformationMessage('Accounts updated.');
        }
      });
    })
  );
}

exports.activate = activate;