const OAuth = require('oauth-1.0a');
const crypto = require('crypto');
const axios = require('axios');
const { getCurrentAccount } = require('./authManager');

/**
 * Sends a signed SuiteQL request using the selected account.
 */
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

  const resp = await axios.post(cfg.url, { q: query }, {
    headers: {
      ...authHeader,
      'Content-Type': 'application/json'
    }
  });
  return resp.data;
}

module.exports = { sendSignedRequestWithAccount };