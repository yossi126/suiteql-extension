const vscode = require('vscode');
const { chooseAccount } = require('./commands/chooseAccount');
const { openEditor } = require('./commands/openEditor');
const { runQuery } = require('./commands/runQuery');
const { sendSignedRequestWithAccount } = require('./utils/suiteqlRequest');
const { loadAccounts, saveAccounts } = require('./utils/authManager');

function getNonce() {
  return Array.from({ length: 16 }, () => Math.random().toString(36)[2]).join('');
}

class SuiteQLViewProvider {
  constructor(context) {
    this.context = context;
    this.sidePanelView = null;
    this.tabPanelView = null;
  }

  resolveWebviewView(webviewView) {
    this.sidePanelView = webviewView;
    webviewView.webview.options = { enableScripts: true };
    this._render();

    webviewView.onDidDispose(() => {
      this.sidePanelView = null;
    });

    webviewView.webview.onDidReceiveMessage(msg => {
      if (msg.command === 'runQuery') this._handleQuery(msg.query);
    });
  }

  setTabPanel(panel) {
    this.tabPanelView = panel;
    panel.webview.options = { enableScripts: true };
    this._render();

    panel.onDidDispose(() => {
      this.tabPanelView = null;
    });

    panel.webview.onDidReceiveMessage(msg => {
      if (msg.command === 'runQuery') this._handleQuery(msg.query);
    });
  }

  async _handleQuery(query) {
    const currentId = this.context.globalState.get('suiteql.current');
    const key = `suiteql.history.${currentId}`;
    const entry = { query };

    this._postMessageAll({ command: 'loading' });

    try {
      entry.result = await sendSignedRequestWithAccount(this.context, query);
    } catch (err) {
      entry.error = err.message;
    }

    const history = this.context.workspaceState.get(key, []);
    history.push(entry);
    await this.context.workspaceState.update(key, history);

    this._render();
    this._postMessageAll({ command: 'showResults' });
  }

  _postMessageAll(msg) {
    if (this.sidePanelView?.webview) {
      try {
        this.sidePanelView.webview.postMessage(msg);
      } catch (e) {
        console.warn('⚠️ sidePanelView.postMessage failed:', e.message);
        this.sidePanelView = null;
      }
    }

    if (this.tabPanelView?.webview) {
      try {
        this.tabPanelView.webview.postMessage(msg);
      } catch (e) {
        console.warn('⚠️ tabPanelView.postMessage failed:', e.message);
        this.tabPanelView = null;
      }
    }
  }

  _render() {
    const currentId = this.context.globalState.get('suiteql.current');
    const key = `suiteql.history.${currentId}`;
    const history = this.context.workspaceState.get(key, []);
    const html = this._getHtml(history);

    if (this.sidePanelView?.webview) {
      try {
        this.sidePanelView.webview.html = html;
      } catch (e) {
        console.warn('⚠️ sidePanelView render failed:', e.message);
        this.sidePanelView = null;
      }
    }

    if (this.tabPanelView?.webview) {
      try {
        this.tabPanelView.webview.html = html;
      } catch (e) {
        console.warn('⚠️ tabPanelView render failed:', e.message);
        this.tabPanelView = null;
      }
    }
  }

  renderAndShowAddAccount(context, existingAccount = null) {
    this._render();
    const { showAddAccountWebview } = require('./commands/chooseAccount');
    showAddAccountWebview(context, existingAccount, this);
  }



  _getHtml(history) {
    const nonce = getNonce();
    const entriesHtml = history.map((entry, i) => {
      const q = (entry.query || '').replace(/</g, '&lt;');
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

let globalSuiteQLViewProvider;


function activate(context) {
  const provider = new SuiteQLViewProvider(context);
  globalSuiteQLViewProvider = provider;

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('suiteqlView', provider),
    vscode.commands.registerCommand('suiteql.runQuery', () => runQuery(context)),
    vscode.commands.registerCommand('suiteql.chooseAccount', () => chooseAccount(context, provider)),
    vscode.commands.registerCommand('suiteql.chooseAccountGear', () => chooseAccount(context, provider)),
    vscode.commands.registerCommand('suiteql.openEditor', () => openEditor(context, provider)),
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