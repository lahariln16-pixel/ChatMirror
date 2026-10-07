require('dotenv').config();

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { google } = require('googleapis');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const PROJECT_ID = 'weighty-vertex-510815-p1';
const PUBSUB_SUBSCRIPTION = 'chat_events_sub';

const CREDENTIALS_FILE =
    fs.existsSync('/etc/secrets/credentials.json')
        ? '/etc/secrets/credentials.json'
        : path.join(__dirname, 'credentials.json');

const TOKEN_FILE =
    fs.existsSync('/etc/secrets/token.json')
        ? '/etc/secrets/token.json'
        : path.join(__dirname, 'token.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const PASSWORD_HASH = process.env.CHATMIRROR_PASSWORD_HASH;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!PASSWORD_HASH || !SESSION_SECRET) {
    console.error('❌ Missing CHATMIRROR_PASSWORD_HASH or SESSION_SECRET in .env');
    process.exit(1);
}

console.log('🔐 Loading OAuth credentials...');

if (!fs.existsSync(CREDENTIALS_FILE)) {
    console.error('❌ credentials.json not found');
    process.exit(1);
}

if (!fs.existsSync(TOKEN_FILE)) {
    console.error('❌ token.json not found');
    process.exit(1);
}

const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
const token = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));

const oauth = credentials.installed || credentials.web;

const auth = new google.auth.OAuth2(
    oauth.client_id,
    oauth.client_secret,
    oauth.redirect_uris?.[0] || 'http://localhost'
);

auth.setCredentials(token);

const chat = google.chat({
    version: 'v1',
    auth
});

console.log('   ✅ OAuth token loaded');

const pubsubBase =
    `https://pubsub.googleapis.com/v1/projects/${PROJECT_ID}`;

// --------------------------------------------------
// SESSION
// --------------------------------------------------

function sign(value) {
    return crypto
        .createHmac('sha256', SESSION_SECRET)
        .update(value)
        .digest('hex');
}

function createSession() {
    const payload = `${crypto.randomUUID()}.${Date.now()}`;
    return `${payload}.${sign(payload)}`;
}

function validSession(cookie) {
    if (!cookie) return false;

    const match = cookie.match(/chatmirror_session=([^;]+)/);
    if (!match) return false;

    const value = match[1];
    const parts = value.split('.');

    if (parts.length !== 3) return false;

    const payload = `${parts[0]}.${parts[1]}`;
    const signature = parts[2];

    const expected = sign(payload);

    if (signature.length !== expected.length) return false;

    if (!crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected)
    )) {
        return false;
    }

    const created = Number(parts[1]);

    if (!Number.isFinite(created)) return false;

    // 7 days
    if (Date.now() - created > 7 * 24 * 60 * 60 * 1000) {
        return false;
    }

    return true;
}

function isAuthenticated(req) {
    return validSession(req.headers.cookie);
}

// --------------------------------------------------
// CHAT API
// --------------------------------------------------

async function listSpaces() {
    const spaces = [];
    let pageToken;

    do {
        const response = await chat.spaces.list({
            pageSize: 100,
            pageToken
        });

        if (response.data.spaces) {
            spaces.push(...response.data.spaces);
        }

        pageToken = response.data.nextPageToken;
    } while (pageToken);

    return spaces;
}

async function listMessages(spaceName) {
    const messages = [];
    let pageToken;

    do {
        const response = await chat.spaces.messages.list({
            parent: spaceName,
            pageSize: 100,
            orderBy: 'createTime DESC',
            pageToken
        });

        if (response.data.messages) {
            messages.push(...response.data.messages);
        }

        pageToken = response.data.nextPageToken;
    } while (pageToken);

    return messages;
}

async function sendMessage(spaceName, text) {
    const response = await chat.spaces.messages.create({
        parent: spaceName,
        requestBody: {
            text
        }
    });

    return response.data;
}

// --------------------------------------------------
// PUB/SUB REST
// --------------------------------------------------

async function getPubSubToken() {
    const tokenInfo = await auth.getAccessToken();

    if (!tokenInfo || !tokenInfo.token) {
        throw new Error('Unable to obtain Google access token');
    }

    return tokenInfo.token;
}

async function pullPubSub() {
    const accessToken = await getPubSubToken();

    const response = await fetch(
        `${pubsubBase}/subscriptions/${PUBSUB_SUBSCRIPTION}:pull`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                maxMessages: 20
            })
        }
    );

    if (!response.ok) {
        throw new Error(
            `Pub/Sub pull failed: ${response.status} ${await response.text()}`
        );
    }

    return response.json();
}

async function acknowledge(ackIds) {
    if (!ackIds.length) return;

    const accessToken = await getPubSubToken();

    const response = await fetch(
        `${pubsubBase}/subscriptions/${PUBSUB_SUBSCRIPTION}:acknowledge`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ackIds
            })
        }
    );

    if (!response.ok) {
        throw new Error(
            `Pub/Sub acknowledge failed: ${response.status} ${await response.text()}`
        );
    }
}

// --------------------------------------------------
// WEBSOCKET
// --------------------------------------------------

const server = http.createServer();
const wss = new WebSocketServer({ noServer: true });

function broadcast(data) {
    const payload = JSON.stringify(data);

    let count = 0;

    for (const client of wss.clients) {
        if (client.readyState === 1) {
            client.send(payload);
            count++;
        }
    }

    console.log(`📡 Broadcasted event to ${count} browser(s)`);
}

server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws') {
        socket.destroy();
        return;
    }

    if (!isAuthenticated(req)) {
        socket.write(
            'HTTP/1.1 401 Unauthorized\r\n' +
            'Connection: close\r\n\r\n'
        );
        socket.destroy();
        return;
    }

    wss.handleUpgrade(req, socket, head, ws => {
        wss.emit('connection', ws, req);
    });
});

wss.on('connection', ws => {
    console.log('🌐 Browser connected');

    ws.send(JSON.stringify({
        type: 'connected',
        message: 'ChatMirror WebSocket connected'
    }));

    ws.on('close', () => {
        console.log('🌐 Browser disconnected');
    });
});

// --------------------------------------------------
// EVENT PROCESSING
// --------------------------------------------------

function decodePubSubMessage(received) {
    try {
        const encoded = received?.message?.data;

        if (!encoded) return null;

        const decoded = Buffer
            .from(encoded, 'base64')
            .toString('utf8');

        return JSON.parse(decoded);
    } catch (error) {
        console.error('❌ Failed to decode Pub/Sub message:', error);
        return null;
    }
}

function processChatEvent(event) {
    const message = event?.message;

    if (!message) return;

    const eventName =
        event?.eventType ||
        event?.event?.type ||
        'google.workspace.chat.message.v1.created';

    let type = 'message_created';

    if (eventName.includes('.updated')) {
        type = 'message_updated';
    } else if (eventName.includes('.deleted')) {
        type = 'message_deleted';
    }

    console.log('');
    console.log('🔥 GOOGLE CHAT EVENT RECEIVED');
    console.log(`   Event: ${type}`);
    console.log(`   Message: ${message.name || 'unknown'}`);
    console.log(`   Text: ${message.text || '[no text]'}`);

    broadcast({
        type,
        eventType: eventName,
        message
    });
}

// --------------------------------------------------
// PUB/SUB RECEIVER
// --------------------------------------------------

let receiverRunning = true;

async function receiveLoop() {
    console.log('📡 Pub/Sub REST receiver started');
    console.log('   Subscription:', PUBSUB_SUBSCRIPTION);

    while (receiverRunning) {
        try {
            const result = await pullPubSub();

            const receivedMessages = result.receivedMessages || [];

            if (receivedMessages.length) {
                const ackIds = [];

                for (const received of receivedMessages) {
                    const event = decodePubSubMessage(received);

                    if (event) {
                        processChatEvent(event);
                    }

                    if (received.ackId) {
                        ackIds.push(received.ackId);
                    }
                }

                await acknowledge(ackIds);

                console.log(`✅ ACKed ${ackIds.length} message(s)`);
            }

        } catch (error) {
            console.error('❌ Pub/Sub receiver error:', error.message);

            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

// --------------------------------------------------
// HTTP HELPERS
// --------------------------------------------------

function sendJSON(res, status, data) {
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
    });

    res.end(JSON.stringify(data));
}

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';

        req.on('data', chunk => {
            body += chunk;

            if (body.length > 1024 * 1024) {
                reject(new Error('Request body too large'));
                req.destroy();
            }
        });

        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch {
                reject(new Error('Invalid JSON'));
            }
        });

        req.on('error', reject);
    });
}

function serveStatic(req, res) {
    let requested = req.url.split('?')[0];

    if (requested === '/') {
        requested = '/index.html';
    }

    const filePath = path.normalize(
        path.join(PUBLIC_DIR, requested)
    );

    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not Found');
        return;
    }

    const ext = path.extname(filePath);

    const types = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json'
    };

    res.writeHead(200, {
        'Content-Type': types[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store'
    });

    fs.createReadStream(filePath).pipe(res);
}

// --------------------------------------------------
// HTTP SERVER
// --------------------------------------------------

server.on('request', async (req, res) => {
    try {
        const url = new URL(
            req.url,
            `http://${req.headers.host || 'localhost'}`
        );

        // ---------------- AUTH STATUS ----------------

        if (req.method === 'GET' && url.pathname === '/api/auth/status') {
            return sendJSON(res, 200, {
                authenticated: isAuthenticated(req)
            });
        }

        // ---------------- LOGIN ----------------

        if (req.method === 'POST' && url.pathname === '/api/auth/login') {
            const body = await parseBody(req);

            const bcrypt = require('bcryptjs');

            const password = String(body.password || '');

            const valid = await bcrypt.compare(
                password,
                PASSWORD_HASH
            );

            if (!valid) {
                return sendJSON(res, 401, {
                    success: false,
                    error: 'Incorrect password'
                });
            }

            const session = createSession();

            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
                'Set-Cookie':
                    `chatmirror_session=${session}; ` +
                    'HttpOnly; ' +
                    'Path=/; ' +
                    'SameSite=Strict; ' +
                    'Max-Age=604800'
            });

            return res.end(JSON.stringify({
                success: true
            }));
        }

        // ---------------- LOGOUT ----------------

        if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
                'Set-Cookie':
                    'chatmirror_session=; ' +
                    'HttpOnly; ' +
                    'Path=/; ' +
                    'SameSite=Strict; ' +
                    'Max-Age=0'
            });

            return res.end(JSON.stringify({
                success: true
            }));
        }

        // ---------------- PROTECT API ----------------

        if (url.pathname.startsWith('/api/')) {
            if (!isAuthenticated(req)) {
                return sendJSON(res, 401, {
                    error: 'Authentication required'
                });
            }
        }

        // ---------------- HEALTH ----------------

        if (req.method === 'GET' && url.pathname === '/api/health') {
            return sendJSON(res, 200, {
                ok: true,
                authenticated: isAuthenticated(req),
                websocketClients: wss.clients.size,
                timestamp: new Date().toISOString()
            });
        }

        // ---------------- SPACES ----------------

        if (req.method === 'GET' && url.pathname === '/api/spaces') {
            const spaces = await listSpaces();

            return sendJSON(res, 200, {
                spaces
            });
        }

        // ---------------- MESSAGES ----------------

        if (
            req.method === 'GET' &&
            url.pathname.startsWith('/api/spaces/') &&
            url.pathname.endsWith('/messages')
        ) {
            const encodedSpace = url.pathname
                .slice('/api/spaces/'.length)
                .slice(0, -'/messages'.length);

            const spaceName = decodeURIComponent(encodedSpace);

            const messages = await listMessages(spaceName);

            return sendJSON(res, 200, {
                messages
            });
        }

        // ---------------- SEND MESSAGE ----------------

        if (
            req.method === 'POST' &&
            url.pathname.startsWith('/api/spaces/') &&
            url.pathname.endsWith('/messages')
        ) {
            const encodedSpace = url.pathname
                .slice('/api/spaces/'.length)
                .slice(0, -'/messages'.length);

            const spaceName = decodeURIComponent(encodedSpace);

            const body = await parseBody(req);

            const text = String(body.text || '').trim();

            if (!text) {
                return sendJSON(res, 400, {
                    error: 'Message cannot be empty'
                });
            }

            const message = await sendMessage(spaceName, text);

            return sendJSON(res, 200, {
                message
            });
        }

        // ---------------- STATIC FILES ----------------

        return serveStatic(req, res);

    } catch (error) {
        console.error('❌ Request error:', error);

        sendJSON(res, 500, {
            error: error.message
        });
    }
});

// --------------------------------------------------
// START
// --------------------------------------------------

server.listen(PORT, HOST, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║              CHAT MIRROR 🔴                 ║');
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║  http://${HOST}:${PORT}                    ║`);
    console.log('║                                              ║');
    console.log('║  🔐 Password protection: ENABLED            ║');
    console.log('║  ⚡ Live Chat Events: ENABLED               ║');
    console.log('║  📡 Pub/Sub REST receiver: ENABLED          ║');
    console.log('║  🌐 WebSocket: ENABLED                      ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');

    receiveLoop();
});

process.on('SIGINT', () => {
    receiverRunning = false;
    console.log('\n👋 Shutting down ChatMirror...');
    server.close(() => process.exit(0));
});
