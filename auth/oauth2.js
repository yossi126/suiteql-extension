const vscode = require('vscode');
const crypto = require('crypto');
const { startRedirectServer } = require('./oauthRedirectServer');
const { saveAccounts, loadAccounts } = require('../utils/authManager');

async function sendRequestWithOauth2(context, query, webviews) {
    const currentId = context.globalState.get('suiteql.current');
    const accounts = loadAccounts(context);
    const account = accounts.find(acc => acc.id === currentId);

    if (!account) throw new Error('No account selected.');
    if (!account.redirectUri || !account.consumerKey || !account.consumerSecret) {
        throw new Error('Account missing OAuth 2.0 credentials.');
    }

    async function refreshAccessToken(context, account) {
        const clientId = account.consumerKey;
        const clientSecret = account.consumerSecret;
        const refreshToken = account.refreshToken;
        const tokenUrl = `https://${account.account}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`;

        const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

        const body = new URLSearchParams();
        body.append('grant_type', 'refresh_token');
        body.append('refresh_token', refreshToken);

        let res;
        try {
            res = await fetch(tokenUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${credentials}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body
            });
        } catch (err) {
            console.error('❌ Network error refreshing token:', err.message);
            return null;
        }

        const text = await res.text();
        if (!res.ok) {
            console.error('❌ Refresh token failed:', text);
            return null;
        }

        let json;
        try {
            json = JSON.parse(text);
            // console.log('✅ Refresh token response:', json);
        } catch (err) {
            console.error('❌ Failed to parse refresh token response as JSON:', err);
            return null;
        }

        if (!json.access_token) {
            console.error('❌ No access_token found in refresh response:', json);
            return null;
        }

        // ✅ Update the stored token
        const accounts = loadAccounts(context);
        const idx = accounts.findIndex(acc => acc.id === account.id);
        if (idx !== -1) {
            accounts[idx].accessToken = json.access_token;
            await saveAccounts(context, accounts);
        }


        console.log('✅ Successfully refreshed access token.');
        return json.access_token;
    }


    const makeSuiteQLCall = async (accessToken) => {
        const url = `${account.url}`;

        const doSuiteQLRequest = async (token) => {
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'transient'
                },
                body: JSON.stringify({ q: query })
            });

            const text = await res.text();
            return { res, text };
        };

        // 1️⃣ First attempt
        let { res, text } = await doSuiteQLRequest(accessToken);

        if (!res.ok) {
            let message = text;
            let isTokenError = false;

            try {
                const json = JSON.parse(text);
                if (json?.error?.message) {
                    message = json.error.message;

                    if (json.error.code === 'INVALID_LOGIN_ATTEMPT' || json.error.code === 'INVALID_SESSION') {
                        isTokenError = true;
                    }
                }
            } catch (_) { }

            if (res.status === 401) {
                isTokenError = true;
            }

            console.warn('⚠️ SuiteQL initial attempt failed:', message);

            if (isTokenError) {
                console.log('🔄 Trying token refresh and retrying SuiteQL request...');
                let refreshedToken;
                try {
                    refreshedToken = await refreshAccessToken(context, account);
                } catch (e) {
                    console.error('❌ Refresh failed completely.', e);
                }

                if (refreshedToken) {
                    // 2️⃣ Retry after refreshing token
                    const { res: retryRes, text: retryText } = await doSuiteQLRequest(refreshedToken);

                    if (retryRes.ok) {
                        let rawRetry;
                        try {
                            rawRetry = JSON.parse(retryText);
                        } catch (err) {
                            console.error('❌ Failed to parse SuiteQL retry response as JSON:', err);
                            throw new Error('SuiteQL retry response was not valid JSON.');
                        }
                        const normalizedRetry = rawRetry.items || rawRetry.data || [];
                        console.log('✅ SuiteQL request succeeded after token refresh.');
                        return { raw: rawRetry, data: normalizedRetry };
                    } else {
                        console.warn('❌ Retry after refresh also failed:', retryText);
                    }
                } else {
                    console.warn('❗ No refreshed token received.');
                }

                // 3️⃣ Either refresh failed OR retry also failed → Start full OAuth re-auth
                console.log('🔁 Restarting OAuth flow completely...');
                const newAccessToken = await startOAuthFlow(context, account, webviews);

                if (!newAccessToken) {
                    throw new Error('OAuth re-authentication failed.');
                }

                // 🔄 Final retry after OAuth re-auth
                const { res: finalRes, text: finalText } = await doSuiteQLRequest(newAccessToken);

                if (!finalRes.ok) {
                    console.error('❌ Final attempt after OAuth flow failed:', finalText);
                    throw new Error(`SuiteQL request failed after re-auth: ${finalText}`);
                }

                let finalParsed;
                try {
                    finalParsed = JSON.parse(finalText);
                } catch (err) {
                    console.error('❌ Failed to parse SuiteQL response as JSON:', err);
                    throw new Error('SuiteQL final response was not valid JSON.');
                }

                const normalizedFinal = finalParsed.items || finalParsed.data || [];
                console.log('✅ SuiteQL request succeeded after OAuth re-auth.');
                return { raw: finalParsed, data: normalizedFinal };
            }

            // Not token error, regular failure
            console.error('❌ SuiteQL request failed:', message);
            throw new Error(`SuiteQL request failed: ${message}`);
        }

        // ✅ Success block
        let raw;
        try {
            raw = JSON.parse(text);
        } catch (err) {
            console.error('❌ Failed to parse SuiteQL response as JSON:', err);
            throw new Error('SuiteQL response was not valid JSON.');
        }

        const normalized = raw.items || raw.data || [];
        console.log('✅ SuiteQL request succeeded on first attempt.');
        return { raw, data: normalized };
    };





    // 1️⃣ ✅ Use existing valid access token
    const isExpired = account.expiresAt && Date.now() >= account.expiresAt;
    if (account.accessToken && !isExpired) {
        console.log('✅ Access token valid. Making SuiteQL query.');
        return await makeSuiteQLCall(account.accessToken);
    }

    // 2️⃣ 🔄 Token expired: try to refresh
    if (account.refreshToken && isExpired) {
        console.log('🔄 Access token expired. Attempting refresh...');

        const tokenUrl = `https://${account.account}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`;

        const res = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + Buffer.from(account.consumerKey + ':' + account.consumerSecret).toString('base64'),
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: account.refreshToken
            })
        });

        if (!res.ok) {
            const errorText = await res.text();
            console.error('❌ Token refresh failed:', errorText);
            vscode.window.showErrorMessage('Failed to refresh OAuth token.');
            webviews.forEach(wv => {
                wv.postMessage({ command: 'stopLoading', error: 'Token refresh failed.' });
            });
            throw new Error('Refresh token request failed.');
        }

        const tokenData = await res.json();
        console.log('✅ Token refreshed:', tokenData);

        // Update saved account
        account.accessToken = tokenData.access_token;
        if (tokenData.refresh_token) {
            account.refreshToken = tokenData.refresh_token;
        }
        account.expiresAt = Date.now() + (tokenData.expires_in * 1000);

        const index = accounts.findIndex(acc => acc.id === account.id);
        if (index !== -1) {
            accounts[index] = account;
            await saveAccounts(context, accounts);
            console.log('✅ Account updated with refreshed tokens.');
        }

        vscode.window.showInformationMessage('OAuth token refreshed.');
        return await makeSuiteQLCall(account.accessToken);
    }

    // 3️⃣ 🔑 No token yet: Start OAuth2 flow
    const newAccessToken = await startOAuthFlow(context, account, webviews);
    const result = await makeSuiteQLCall(newAccessToken);
    return result;



    // return await makeSuiteQLCall(account.accessToken);

    async function startOAuthFlow(context, account, webviews) {
        const state = crypto.randomBytes(16).toString('hex');
        const params = new URLSearchParams({
            redirect_uri: account.redirectUri,
            client_id: account.consumerKey,
            response_type: 'code',
            scope: 'rest_webservices restlets',
            state: state
        });
        const authorizeUrl = `https://${account.account}.app.netsuite.com/app/login/oauth2/authorize.nl?${params.toString()}`;

        vscode.window.showInformationMessage('Opening browser to authorize NetSuite access…');

        const open = (await import('open')).default;
        await open(authorizeUrl);

        return new Promise((resolve, reject) => {
            startRedirectServer(state, context, async (code) => {
                console.log('✅ Received auth code:', code);

                const tokenUrl = `https://${account.account}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`;

                try {
                    const res = await fetch(tokenUrl, {
                        method: 'POST',
                        headers: {
                            'Authorization': 'Basic ' + Buffer.from(account.consumerKey + ':' + account.consumerSecret).toString('base64'),
                            'Content-Type': 'application/x-www-form-urlencoded'
                        },
                        body: new URLSearchParams({
                            grant_type: 'authorization_code',
                            code: code,
                            redirect_uri: account.redirectUri
                        })
                    });

                    if (!res.ok) {
                        const errorText = await res.text();
                        console.error('❌ Token exchange failed:', errorText);
                        vscode.window.showErrorMessage('OAuth token exchange failed.');
                        webviews.forEach(wv => {
                            wv.postMessage({ command: 'stopLoading', error: 'OAuth token exchange failed.' });
                        });
                        return reject(new Error('Token exchange failed.'));
                    }

                    const tokenData = await res.json();
                    console.log('✅ Token data received:', tokenData);

                    // Save tokens
                    account.accessToken = tokenData.access_token;
                    account.refreshToken = tokenData.refresh_token;
                    account.expiresAt = Date.now() + (tokenData.expires_in * 1000);

                    const accounts = loadAccounts(context);
                    const index = accounts.findIndex(acc => acc.id === account.id);
                    if (index !== -1) {
                        accounts[index] = account;
                        await saveAccounts(context, accounts);
                        console.log('✅ Account updated with OAuth2 tokens.');
                    }

                    webviews.forEach(wv => {
                        wv.postMessage({ command: 'stopLoading', success: true });
                    });

                    resolve(account.accessToken);

                } catch (err) {
                    console.error('❌ Error exchanging code for token:', err.message);
                    vscode.window.showErrorMessage('Error during token exchange: ' + err.message);
                    webviews.forEach(wv => {
                        wv.postMessage({ command: 'stopLoading', error: 'OAuth token exchange error.' });
                    });
                    reject(err);
                }
            }, () => {
                vscode.window.showWarningMessage('OAuth flow timed out. Please try again.');
                webviews.forEach(wv => {
                    wv.postMessage({ command: 'stopLoading', error: 'Authorization timed out.' });
                });
                reject(new Error('OAuth flow timed out. Please try again.'));
            });
        });
    }

}


module.exports = { sendRequestWithOauth2 };
