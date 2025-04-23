const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { loadAccounts, saveAccounts } = require('../utils/authManager');

/**
 * Show Add/Edit Account panel.
 */
function showAddAccountWebview(context, existingAccount = null, provider = null) {
  const isEdit = !!existingAccount;
  const panel = vscode.window.createWebviewPanel(
    'suiteqlAddAccount',
    `${isEdit ? 'Edit' : 'Add'} NetSuite Account`,
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  // load static HTML
  const htmlPath = path.join(context.extensionPath, 'webviews', 'addAccountWebView.html');
  panel.webview.html = fs.readFileSync(htmlPath, 'utf8');

  // if editing, send account data immediately
  if (isEdit) {
    panel.webview.postMessage({ command: 'editAccount', account: existingAccount });
  }

  // handle save from webview
  panel.webview.onDidReceiveMessage(msg => {
    if (msg.command === 'saveAccount') {
      handleSave(msg.data, context, provider, panel);
    }
  });
}

/**
 * Persist new/updated account, re-select it and refresh views.
 */
async function handleSave(data, context, provider, panel) {
  const accounts = loadAccounts(context);
  const idx = accounts.findIndex(a => a.id === data.id);

  if (idx > -1) accounts[idx] = data;
  else accounts.push(data);

  await saveAccounts(context, accounts);
  await context.globalState.update('suiteql.current', data.id);
  vscode.window.showInformationMessage(
    `${idx > -1 ? 'Updated' : 'Added'} and selected account: ${data.displayName}`
  );
  panel.dispose();
  if (provider) provider._render();
}

/**
 * Main picker for choosing/adding/editing/deleting accounts.
 */
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

  if (choice.label.startsWith('➕')) {
    // use provider so that after saving it will refresh
    provider.renderAndShowAddAccount(context, null);
    return;
  }

  const action = await vscode.window.showQuickPick(
    ['✅ Use this account', '✏️ Edit this account', '🗑️ Delete this account'],
    { placeHolder: `What to do with ${choice.label}?` }
  );
  if (!action) return;

  switch (action) {
    case '✅ Use this account':
      await context.globalState.update('suiteql.current', choice.id);
      vscode.window.showInformationMessage('Selected: ' + choice.label);
      // 🔁 Force refresh: close/reopen Activity Bar view if open
      const view = vscode.window.tabGroups?.all?.flatMap(g => g.tabs)?.find(t => t.viewId === 'suiteqlView');
      if (view?.isActive) {
        await vscode.commands.executeCommand('workbench.view.extension.suiteqlExplorer');
      }
      // 🔁 Now re-render both panels (Activity Bar + Tab)
      provider._render();
      break;
    case '✏️ Edit this account':
      const accountToEdit = accounts.find(a => a.id === choice.id);
      provider.renderAndShowAddAccount(context, accountToEdit);
      break;
    case '🗑️ Delete this account':
      const confirm = await vscode.window.showWarningMessage(
        `Delete "${choice.label}"?`,
        { modal: true },
        'Yes'
      );
      if (confirm === 'Yes') {
        const remaining = accounts.filter(a => a.id !== choice.id);
        await saveAccounts(context, remaining);
        // Delete its history
        await context.workspaceState.update(`suiteql.history.${choice.id}`, undefined);
        vscode.window.showInformationMessage(`Deleted: ${choice.label}`);
        provider._render();
      }
      break;
  }
}

module.exports = {
  chooseAccount,
  showAddAccountWebview
};
