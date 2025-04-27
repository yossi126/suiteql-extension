const fs = require('fs');
const path = require('path');
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

  startThemeListener() {
    vscode.window.onDidChangeActiveColorTheme((e) => {
      const isDark = e.kind === vscode.ColorThemeKind.Dark;
      const theme = isDark ? 'material-darker' : 'eclipse';

      const themeHref = vscode.Uri.joinPath(
        this.context.extensionUri,
        'webviews',
        'codemirror',
        isDark ? 'material-darker.min.css' : 'eclipse.min.css'
      );

      // Send to side panel
      if (this.sidePanelView?.webview) {
        this.sidePanelView.webview.postMessage({
          command: 'setTheme',
          theme: theme,
          themeHref: this.sidePanelView.webview.asWebviewUri(themeHref).toString()
        });
      }

      // Send to tab panel
      if (this.tabPanelView?.webview) {
        this.tabPanelView.webview.postMessage({
          command: 'setTheme',
          theme: theme,
          themeHref: this.tabPanelView.webview.asWebviewUri(themeHref).toString()
        });
      }
    });
  }



  resolveWebviewView(webviewView) {
    this.sidePanelView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'webviews'),
        vscode.Uri.joinPath(this.context.extensionUri, 'resources'),
        vscode.Uri.joinPath(this.context.extensionUri, 'webviews', 'codemirror')
      ]
    };

    this._render(); // <-- this loads the HTML

    // 🆕 Now immediately send the theme after loading
    const isDarkTheme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;
    const theme = isDarkTheme ? 'material-darker' : 'eclipse';
    const themeHref = isDarkTheme
      ? vscode.Uri.joinPath(this.context.extensionUri, 'webviews', 'codemirror', 'material-darker.min.css')
      : vscode.Uri.joinPath(this.context.extensionUri, 'webviews', 'codemirror', 'eclipse.min.css');

    webviewView.webview.postMessage({
      command: 'setTheme',
      theme: theme,
      themeHref: webviewView.webview.asWebviewUri(themeHref).toString()
    });

    webviewView.onDidDispose(() => {
      this.sidePanelView = null;
    });

    webviewView.webview.onDidReceiveMessage(msg => {
      if (msg.command === 'runQuery') {
        this._handleQuery(msg.query);
      } else if (msg.command === 'deleteEntry') {
        this._handleDelete(msg.index);
        vscode.window.showInformationMessage('Query deleted successfully.');
      } else if (msg.command === 'copyQuery') {
        vscode.window.showInformationMessage(msg.message);
      }
    });

  }


  setTabPanel(panel) {
    this.tabPanelView = panel;

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'webviews'),
        vscode.Uri.joinPath(this.context.extensionUri, 'resources'),
        vscode.Uri.joinPath(this.context.extensionUri, 'webviews', 'codemirror')
      ]
    };

    this._render();

    const isDarkTheme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;
    const theme = isDarkTheme ? 'material-darker' : 'eclipse';
    const themeHref = isDarkTheme
      ? vscode.Uri.joinPath(this.context.extensionUri, 'webviews', 'codemirror', 'material-darker.min.css')
      : vscode.Uri.joinPath(this.context.extensionUri, 'webviews', 'codemirror', 'eclipse.min.css');

    panel.webview.postMessage({
      command: 'setTheme',
      theme: theme,
      themeHref: panel.webview.asWebviewUri(themeHref).toString()
    });

    panel.onDidDispose(() => {
      this.tabPanelView = null;
    });

    panel.webview.onDidReceiveMessage(msg => {
      if (msg.command === 'runQuery') {
        this._handleQuery(msg.query);
      } else if (msg.command === 'deleteEntry') {
        this._handleDelete(msg.index);
      } else if (msg.command === 'copyQuery') {
        vscode.window.showInformationMessage(msg.message);
      }
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

  async _handleDelete(index) {
    const currentId = this.context.globalState.get('suiteql.current');
    const key = `suiteql.history.${currentId}`;
    const history = this.context.workspaceState.get(key, []);
    history.splice(index, 1);                                // remove the one entry
    await this.context.workspaceState.update(key, history); // persist change
    this._render();                                         // re-draw the view
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

        // 🆕 Immediately send current theme again after reloading HTML
        const isDark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;
        const theme = isDark ? 'material-darker' : 'eclipse';
        const themeHref = vscode.Uri.joinPath(
          this.context.extensionUri,
          'webviews',
          'codemirror',
          isDark ? 'material-darker.min.css' : 'eclipse.min.css'
        );

        this.sidePanelView.webview.postMessage({
          command: 'setTheme',
          theme: theme,
          themeHref: this.sidePanelView.webview.asWebviewUri(themeHref).toString()
        });

      } catch (e) {
        console.warn('⚠️ sidePanelView render failed:', e.message);
        this.sidePanelView = null;
      }
    }

    if (this.tabPanelView?.webview) {
      try {
        this.tabPanelView.webview.html = html;

        // 🆕 Same for tabPanelView
        const isDark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;
        const theme = isDark ? 'material-darker' : 'eclipse';
        const themeHref = vscode.Uri.joinPath(
          this.context.extensionUri,
          'webviews',
          'codemirror',
          isDark ? 'material-darker.min.css' : 'eclipse.min.css'
        );

        this.tabPanelView.webview.postMessage({
          command: 'setTheme',
          theme: theme,
          themeHref: this.tabPanelView.webview.asWebviewUri(themeHref).toString()
        });

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
        const jsonView = `<pre>${JSON.stringify(entry.result.data, null, 2)}</pre>`;
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
        <button class="view-btn" onclick="showJson(${i})">JSON</button>
        <button class="view-btn" onclick="showTable(${i})">Table</button>
      </div>
      <div id="json-${i}" class="view json">${jsonView}</div>
      <div id="table-${i}" class="view table" style="display:none;">${tableView}</div>
    `;
      }

      return `<div class="entry">
          <div class="entry-header">
            <button class="copy-btn" onclick="copyEntry(${i})" title="Copy this query">📋 Copy</button>
            <button class="delete-btn" onclick="deleteEntry(${i})" title="Delete this query">🗑️ Delete</button>
          </div>
          <div class="query">
            <strong>Query:</strong> <span id="query-text-${i}">${q}</span>
          </div>
          ${body}
        </div>`;

    }).join('');

    const webview = this.sidePanelView?.webview || this.tabPanelView?.webview;

    const cmRoot = vscode.Uri.joinPath(this.context.extensionUri, 'webviews', 'codemirror');
    const cmCss = webview.asWebviewUri(vscode.Uri.joinPath(cmRoot, 'codemirror.min.css'));
    const cmJs = webview.asWebviewUri(vscode.Uri.joinPath(cmRoot, 'codemirror.min.js'));
    const sqlMode = webview.asWebviewUri(vscode.Uri.joinPath(cmRoot, 'sql.min.js'));

    // 🆕 Detect current VS Code theme
    const isDark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;
    const themeCss = webview.asWebviewUri(vscode.Uri.joinPath(cmRoot, isDark ? 'material-darker.min.css' : 'eclipse.min.css'));

    const templatePath = path.join(this.context.extensionPath, 'webviews', 'sidePanelView.html');
    let html = fs.readFileSync(templatePath, 'utf8');

    html = html.replace(/__NONCE__/g, nonce);
    html = html.replace(/__ENTRIES__/g, entriesHtml);
    html = html.replace(/__CM_CSS__/g, cmCss.toString());
    html = html.replace(/__CM_JS__/g, cmJs.toString());
    html = html.replace(/__CM_SQL__/g, sqlMode.toString());
    html = html.replace(/__CM_THEME__/g, themeCss.toString()); // 🆕 inject correct initial theme immediately

    return html;
  }

}

let globalSuiteQLViewProvider;


function activate(context) {
  const provider = new SuiteQLViewProvider(context);
  globalSuiteQLViewProvider = provider;
  provider.startThemeListener();
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