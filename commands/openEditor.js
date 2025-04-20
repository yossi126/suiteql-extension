const vscode = require('vscode');
const { sendSignedRequestWithAccount } = require('../utils/suiteqlRequest');

function openEditor(context, viewProvider) {
  const panel = vscode.window.createWebviewPanel(
    'suiteqlQueryEditor',
    'SuiteQL Query Editor',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  viewProvider.webview = panel;
  viewProvider._render();

  panel.webview.onDidReceiveMessage(msg => {
    if (msg.command === 'runQuery') {
      panel.webview.postMessage({ command: 'loading' });
      (async () => {
        let entry = { query: msg.query };
        try {
          const resp = await sendSignedRequestWithAccount(context, msg.query);
          entry.result = resp;
        } catch (err) {
          entry.error = err.message;
        }
        const history = context.workspaceState.get('suiteql.history', []);
        history.push(entry);
        await context.workspaceState.update('suiteql.history', history);
        viewProvider._render();
      })();
    }
  });
}

module.exports = { openEditor };