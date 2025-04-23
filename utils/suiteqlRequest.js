const OAuth = require('oauth-1.0a');
const crypto = require('crypto');
const axios = require('axios');
const { getCurrentAccount } = require('./authManager');

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

  const headers = {
    ...authHeader,
    'Content-Type': 'application/json'
  };

  // Add `Prefer: transient` header ONLY for SuiteTalk requests
  if (cfg.url.includes('/services/rest/query/')) {
    headers['Prefer'] = 'transient';
  }

  const response = await axios.post(cfg.url, { q: query }, { headers });

  const raw = response.data;
  const normalized = raw.items || raw.data || [];

  return {
    raw,
    data: normalized
  };
}

module.exports = { sendSignedRequestWithAccount };
