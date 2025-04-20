const vscode = require('vscode');
const { loadAccounts, saveAccounts } = require('../utils/authManager');

function showAddAccountWebview(context) {
  const panel = vscode.window.createWebviewPanel(
    'suiteqlAddAccount',
    'Add NetSuite Account',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

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

    <script>
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
  </body></html>`;

  panel.webview.onDidReceiveMessage(async msg => {
    if (msg.command === 'saveAccount') {
      const accounts = loadAccounts(context);
      accounts.push(msg.data);
      await saveAccounts(context, accounts);
      await context.globalState.update('suiteql.current', msg.data.account);
      vscode.window.showInformationMessage('Added and selected account: ' + msg.data.account);
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
    vscode.window.showInformationMessage('Selected account: ' + choice.label);
  }
}

module.exports = { chooseAccount };