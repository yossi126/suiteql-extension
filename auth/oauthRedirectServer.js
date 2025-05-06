const express = require('express');
const http = require('http');
const { getCurrentAccount } = require('../utils/authManager');

let server;
let timeoutHandle;

function startRedirectServer(expectedState, context, onCodeReceived, onTimeout) {
    const app = express();
    const cfg = getCurrentAccount(context);
    const redirectUri = cfg.redirectUri
    const uri = new URL(redirectUri);
    const PORT = parseInt(uri.port, 10);

    app.get('/callback', (req, res) => {
        const { code, state, error } = req.query;
        if (error) {
            console.error('OAuth Error:', error);
            res.send('<h2>Authorization failed.</h2>');
            shutdown();
            return;
        }

        if (state !== expectedState) {
            console.error('State mismatch. Potential CSRF attack.');
            res.send('<h2>State mismatch. Please try again.</h2>');
            shutdown();
            return;
        }

        if (code) {
            console.log('Received authorization code:', code);
            res.send('<h2>Authorization successful! You can close this window.</h2>');
            onCodeReceived(code);
            clearTimeout(timeoutHandle);  // ✅ Clear timeout
            shutdown();
        } else {
            res.send('<h2>No code received.</h2>');
            clearTimeout(timeoutHandle);
            shutdown();
        }
    });

    server = http.createServer(app);

    server.listen(PORT, () => {
        console.log(`OAuth Redirect Server running at ${redirectUri}`);

        // ⏳ Set a 60-second timeout to auto-shutdown
        timeoutHandle = setTimeout(() => {
            console.warn('OAuth Redirect Server timed out after 60 seconds without receiving a callback.');
            if (typeof onTimeout === 'function') {
                onTimeout();  // ✅ Notify VS Code that timeout happened
            }
            shutdown();
        }, 60 * 1000);  // 60 seconds
    });
}

function shutdown() {
    if (server) {
        server.close(() => {
            console.log('OAuth Redirect Server closed.');
        });
        server = null;
    }
}

module.exports = { startRedirectServer };
