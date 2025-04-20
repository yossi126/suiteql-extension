const path = require('path');
const fs = require('fs');

function loadAccounts(context) {
  let accounts = context.globalState.get('suiteql.accounts', []);
  if (accounts.length === 0) {
    const p = path.join(context.extensionPath, 'auth.json');
    if (fs.existsSync(p)) {
      try {
        const a = JSON.parse(fs.readFileSync(p, 'utf8'));
        accounts = [a];
        context.globalState.update('suiteql.accounts', accounts);
      } catch {}
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

module.exports = {
  loadAccounts,
  saveAccounts,
  getCurrentAccount
};