const fs = require('fs');
const http = require('http');
const path = require('path');
const { google } = require('googleapis');

const PORT = 3000;

const SCOPES = [
  'https://www.googleapis.com/auth/chat.messages',
  'https://www.googleapis.com/auth/chat.spaces.readonly',
  'https://www.googleapis.com/auth/pubsub'
];

const credentialsPath = path.join(
  __dirname,
  'credentials.json'
);

const tokenPath = path.join(
  __dirname,
  'token.json'
);

async function main() {
  console.log('');
  console.log('======================================');
  console.log('🔐 CHAT MIRROR GOOGLE AUTH');
  console.log('======================================');

  const credentials = JSON.parse(
    fs.readFileSync(credentialsPath, 'utf8')
  );

  const config =
    credentials.installed ||
    credentials.web;

  const redirectUri =
    `http://localhost:${PORT}/oauth2callback`;

  const oauth2Client = new google.auth.OAuth2(
    config.client_id,
    config.client_secret,
    redirectUri
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'select_account consent',
    include_granted_scopes: true
  });

  console.log('');
  console.log('🌐 Opening Google account picker...');
  console.log('');
  console.log(authUrl);
  console.log('');

  const server = http.createServer(
    async (req, res) => {

      if (!req.url.startsWith('/oauth2callback')) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const url = new URL(
        req.url,
        `http://localhost:${PORT}`
      );

      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(400, {
          'Content-Type': 'text/html; charset=utf-8'
        });

        res.end(`
          <h1>Google authentication failed</h1>
          <p>${error}</p>
        `);

        server.close();
        process.exit(1);
      }

      if (!code) {
        res.writeHead(400);
        res.end('Missing OAuth code');
        return;
      }

      try {
        console.log('');
        console.log('🔄 Exchanging authorization code...');

        const { tokens } =
          await oauth2Client.getToken(code);

        fs.writeFileSync(
          tokenPath,
          JSON.stringify(tokens, null, 2)
        );

        console.log('');
        console.log('======================================');
        console.log('✅ GOOGLE AUTH COMPLETE');
        console.log('======================================');
        console.log('');
        console.log('💾 Token saved to token.json');
        console.log('');

        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8'
        });

        res.end(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>ChatMirror Auth</title>
            <style>
              body {
                background: #090909;
                color: white;
                font-family: Arial, sans-serif;
                display: flex;
                align-items: center;
                justify-content: center;
                height: 100vh;
                margin: 0;
              }

              .box {
                text-align: center;
                padding: 40px;
                border: 1px solid #333;
                border-radius: 16px;
                background: #111;
              }

              h1 {
                color: #ff3030;
              }
            </style>
          </head>

          <body>
            <div class="box">
              <h1>✅ ChatMirror Connected</h1>
              <p>Google account authentication successful.</p>
              <p>You can close this tab.</p>
            </div>
          </body>
          </html>
        `);

        setTimeout(
          () => server.close(),
          1000
        );

      } catch (err) {
        console.error(
          '❌ Token exchange failed:',
          err
        );

        res.writeHead(500, {
          'Content-Type': 'text/html; charset=utf-8'
        });

        res.end(`
          <h1>Authentication failed</h1>
          <pre>${err.message}</pre>
        `);

        server.close();
        process.exit(1);
      }
    }
  );

  server.listen(
    PORT,
    '127.0.0.1',
    () => {
      console.log(
        `🚀 OAuth callback server: http://127.0.0.1:${PORT}`
      );

      const { exec } = require('child_process');

      exec(
        `xdg-open '${authUrl.replace(/'/g, "'\\''")}'`
      );
    }
  );
}

main().catch(err => {
  console.error('');
  console.error('❌ GOOGLE AUTH FAILED');
  console.error(err);
  process.exit(1);
});
