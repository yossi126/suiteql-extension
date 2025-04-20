const vscode = require('vscode');
const { sendSignedRequestWithAccount } = require('../utils/suiteqlRequest');

async function runQuery(context) {
  const query = await vscode.window.showInputBox({ prompt: 'Enter SuiteQL query' });
  if (!query) return;

  const output = vscode.window.createOutputChannel('SuiteQL Results');
  output.show();
  output.appendLine('Query: ' + query);

  try {
    const result = await sendSignedRequestWithAccount(context, query);
    output.appendLine(JSON.stringify(result, null, 2));
  } catch (err) {
    output.appendLine('Error: ' + err.message);
  }
}

module.exports = { runQuery };