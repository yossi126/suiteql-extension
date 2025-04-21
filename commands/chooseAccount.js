const vscode = require('vscode');
const { loadAccounts, saveAccounts } = require('../utils/authManager');

function showAddAccountWebview(context, existingAccount = null, provider = null) {

  const isEdit = !!existingAccount;
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
    <h2>${isEdit ? 'Edit' : 'Add'} NetSuite Account</h2>
    <input type="hidden" id="accountId" value="${isEdit ? existingAccount.id : ''}">
    <label>Display Name:</label>
    <br>
    <input id="displayName" style="width:100%" value="${isEdit ? existingAccount.displayName : ''}">
    <br><br>
    <label>Account ID:</label>
    <br>
    <input id="account" style="width:100%" value="${isEdit ? existingAccount.account : ''}">
    <br><br>
    <label>URL:</label><br><input id="url" style="width:100%" value="${isEdit ? existingAccount.url : ''}"><br><br>
    <label>Consumer Key:</label><br><input id="consumerKey" style="width:100%" value="${isEdit ? existingAccount.consumerKey : ''}"><br><br>
    <label>Consumer Secret:</label><br><input id="consumerSecret" style="width:100%" value="${isEdit ? existingAccount.consumerSecret : ''}"><br><br>
    <label>Token:</label><br><input id="token" style="width:100%" value="${isEdit ? existingAccount.token : ''}"><br><br>
    <label>Token Secret:</label><br><input id="tokenSecret" style="width:100%" value="${isEdit ? existingAccount.tokenSecret : ''}"><br><br>
    <button onclick="save()">${isEdit ? 'Update' : 'Save'} Account</button>

    <script>
      const vscode = acquireVsCodeApi();
function save() {
  const data = {
    id: document.getElementById('accountId').value || crypto.randomUUID(),
    displayName: document.getElementById('displayName').value || document.getElementById('account').value,
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
      const index = accounts.findIndex(a => a.id === msg.data.id);

      if (index !== -1) {
        accounts[index] = msg.data; // ✅ overwrite
      } else {
        accounts.push(msg.data); // ✅ new account
      }
      await saveAccounts(context, accounts);
      await context.globalState.update('suiteql.current', msg.data.id);
      const action = index !== -1 ? 'Updated' : 'Added';
      vscode.window.showInformationMessage(`${action} and selected account: ${msg.data.displayName}`);
      panel.dispose();

      // refresh after the panel closes
      if (provider) {
        console.log('Rendering in side panel');
        provider._render();
      }

    }
  });
}

async function chooseAccount(context, provider) {
  const accounts = loadAccounts(context);
  const currentId = context.globalState.get('suiteql.current');
  const picks = accounts.map(a => ({
    label: `${a.displayName || a.account}${a.id === currentId ? ' ✔️ Active' : ''}`,
    description: a.url,
    id: a.id
  }));
  picks.push({ label: '➕ Set up new account', description: '' });

  const choice = await vscode.window.showQuickPick(picks, { placeHolder: 'Select NetSuite account' });
  if (!choice) return;

  if (choice.label === '➕ Set up new account') {
    provider.renderAndShowAddAccount(context);
  } else {
    const action = await vscode.window.showQuickPick(
      ['✅ Use this account', '✏️ Edit this account', '🗑️ Delete this account'],
      { placeHolder: `What would you like to do with ${choice.label}?` }
    );

    if (action === '✅ Use this account') {
      await context.globalState.update('suiteql.current', choice.id);
      vscode.window.showInformationMessage('Selected account: ' + choice.label);

      // 🔁 Force refresh: close/reopen Activity Bar view if open
      const view = vscode.window.tabGroups?.all?.flatMap(g => g.tabs)?.find(t => t.viewId === 'suiteqlView');
      if (view?.isActive) {
        await vscode.commands.executeCommand('workbench.view.extension.suiteqlExplorer');
      }

      // 🔁 Now re-render both panels (Activity Bar + Tab)
      provider._render();
    }

    if (action === '✏️ Edit this account') {
      const accountToEdit = accounts.find(a => a.id === choice.id);
      provider.renderAndShowAddAccount(context, accountToEdit);
    }

    if (action === '🗑️ Delete this account') {
      const confirm = await vscode.window.showWarningMessage(
        `Are you sure you want to delete account "${choice.label}"?`,
        { modal: true },
        'Yes'
      );
      if (confirm === 'Yes') {
        let accounts = loadAccounts(context);
        accounts = accounts.filter(a => a.id !== choice.id);
        await saveAccounts(context, accounts);

        // Delete its history
        await context.workspaceState.update(`suiteql.history.${choice.id}`, undefined);

        vscode.window.showInformationMessage(`Deleted account: ${choice.label}`);
        provider._render(); // ✅ refresh both views
      }

    }
  }

}

module.exports = {
  chooseAccount,
  showAddAccountWebview
};
