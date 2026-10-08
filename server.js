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

    // Enrich direct messages with the other member's name/avatar.
    for (const space of spaces) {
        if (space.spaceType !== 'DIRECT_MESSAGE') {
            continue;
        }

        try {
            const response = await chat.spaces.members.list({
                parent: space.name,
                pageSize: 100
            });

            const members = response.data.memberships || [];

            // Find the human member who isn't the authenticated user.
            const otherMember = members.find(member => {
                const name = member.member?.name || '';
                return !name.endsWith('/' + process.env.GOOGLE_CHAT_USER_ID);
            }) || members[0];

            if (otherMember?.member) {
                const person = otherMember.member;

                if (person.displayName) {
                    space.displayName = person.displayName;
                }

                if (person.avatarUrl) {
                    space.avatarUrl = person.avatarUrl;
                }

                space.dmMember = person;
            }
        } catch (error) {
            console.warn(
                `⚠️ Could not resolve DM member for ${space.name}:`,
                error.message
            );
        }
    }

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

async function sendMessage(
    spaceName,
    text,
    attachmentDataRef = null,
    replyThreadName = null
) {
    const requestBody = {};

    if (text) {
        requestBody.text = text;
    }

    if (attachmentDataRef) {
        requestBody.attachment = [
            {
                attachmentDataRef
            }
        ];
    }

    const request = {
        parent: spaceName,
        requestBody
    };

    if (replyThreadName) {
        request.messageReplyOption =
            'REPLY_MESSAGE_OR_FAIL';

        requestBody.thread = {
            name: replyThreadName
        };
    }

    const response =
        await chat.spaces.messages.create(request);

    return response.data;
}

async function uploadChatAttachment(
    spaceName,
    filename,
    contentType,
    filePath
) {
    const fs = require('fs');

    console.log('📎 Upload details:');
    console.log('   filename:', JSON.stringify(filename));
    console.log('   contentType:', JSON.stringify(contentType));
    console.log('   filePath:', filePath);

    if (!filename) {
        throw new Error('Attachment filename is missing');
    }

    const response = await chat.media.upload({
        parent: spaceName,
        requestBody: {
            filename: filename
        },
        media: {
            mimeType: contentType || 'application/octet-stream',
            body: fs.createReadStream(filePath)
        }
    });

    console.log('📎 Google Chat upload response:', response.data);

    return response.data?.attachmentDataRef || response.data;
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


// --------------------------------------------------
// GOOGLE WORKSPACE EVENTS SUBSCRIPTION
// --------------------------------------------------

const WORKSPACE_EVENTS_BASE =
    'https://workspaceevents.googleapis.com/v1';

const WORKSPACE_TARGET_RESOURCE =
    '//chat.googleapis.com/spaces/-';

const WORKSPACE_EVENT_TYPES = [
    'google.workspace.chat.message.v1.created',
    'google.workspace.chat.message.v1.updated',
    'google.workspace.chat.message.v1.deleted'
];

const WORKSPACE_PUBSUB_TOPIC =
    `projects/${PROJECT_ID}/topics/chat_events`;

let workspaceSubscriptionName = null;

async function getWorkspaceAccessToken() {
    const result = await auth.getAccessToken();

    if (!result?.token) {
        throw new Error(
            'Could not obtain Google Workspace access token'
        );
    }

    return result.token;
}

function workspaceRequest(
    url,
    accessToken,
    method = 'GET',
    body = null
) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);

        const requestBody = body
            ? JSON.stringify(body)
            : null;

        const options = {
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            method,

            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/json'
            }
        };

        if (requestBody) {
            options.headers['Content-Type'] =
                'application/json';

            options.headers['Content-Length'] =
                Buffer.byteLength(requestBody);
        }

        const req = require('https').request(
            options,
            res => {
                let data = '';

                res.setEncoding('utf8');

                res.on('data', chunk => {
                    data += chunk;
                });

                res.on('end', () => {
                    let parsedData = {};

                    try {
                        parsedData =
                            data
                                ? JSON.parse(data)
                                : {};
                    } catch {
                        parsedData = {
                            raw: data
                        };
                    }

                    if (
                        res.statusCode >= 200 &&
                        res.statusCode < 300
                    ) {
                        resolve(parsedData);
                        return;
                    }

                    const error = new Error(
                        `Workspace Events API returned HTTP ${res.statusCode}`
                    );

                    error.statusCode =
                        res.statusCode;

                    error.response =
                        parsedData;

                    reject(error);
                });
            }
        );

        req.on('error', reject);

        if (requestBody) {
            req.write(requestBody);
        }

        req.end();
    });
}


// --------------------------------------------------
// LIST EXISTING SUBSCRIPTIONS
// --------------------------------------------------

async function listWorkspaceSubscriptions() {
    const accessToken =
        await getWorkspaceAccessToken();

    const url =
        `${WORKSPACE_EVENTS_BASE}/subscriptions` +
        `?filter=${encodeURIComponent(
            `target_resource="${WORKSPACE_TARGET_RESOURCE}"`
        )}`;

    const response =
        await workspaceRequest(
            url,
            accessToken
        );

    return response.subscriptions || [];
}


// --------------------------------------------------
// WAIT FOR SUBSCRIPTION CREATION OPERATION
// --------------------------------------------------

async function waitForWorkspaceOperation(
    operationName
) {
    const maxAttempts = 30;
    const delayMs = 2000;

    console.log(
        '⏳ Waiting for Workspace Events subscription creation...'
    );

    for (
        let attempt = 1;
        attempt <= maxAttempts;
        attempt++
    ) {
        const accessToken =
            await getWorkspaceAccessToken();

        const response =
            await workspaceRequest(
                `${WORKSPACE_EVENTS_BASE}/${operationName}`,
                accessToken
            );

        if (response.done) {

            if (response.error) {
                const error = new Error(
                    `Workspace Events operation failed: ${
                        response.error.message ||
                        'Unknown error'
                    }`
                );

                error.response =
                    response.error;

                throw error;
            }

            const subscription =
                response.response;

            if (
                !subscription ||
                !subscription.name ||
                !subscription.name.startsWith(
                    'subscriptions/'
                )
            ) {
                throw new Error(
                    'Workspace Events operation completed without a valid subscription'
                );
            }

            workspaceSubscriptionName =
                subscription.name;

            console.log(
                '✅ Workspace Events subscription is ACTIVE'
            );

            console.log(
                '   Subscription:',
                subscription.name
            );

            if (subscription.expireTime) {
                console.log(
                    '   Expires:',
                    subscription.expireTime
                );
            }

            return subscription;
        }

        console.log(
            `   ⏳ Creation still in progress... (${attempt}/${maxAttempts})`
        );

        await new Promise(resolve =>
            setTimeout(
                resolve,
                delayMs
            )
        );
    }

    throw new Error(
        'Workspace Events subscription creation timed out'
    );
}


// --------------------------------------------------
// CREATE SUBSCRIPTION
// --------------------------------------------------

async function createWorkspaceSubscription() {
    const accessToken =
        await getWorkspaceAccessToken();

    console.log(
        '🆕 Creating Google Chat Workspace Events subscription...'
    );

    const response =
        await workspaceRequest(
            `${WORKSPACE_EVENTS_BASE}/subscriptions`,
            accessToken,
            'POST',
            {
                targetResource:
                    WORKSPACE_TARGET_RESOURCE,

                eventTypes:
                    WORKSPACE_EVENT_TYPES,

                notificationEndpoint: {
                    pubsubTopic:
                        WORKSPACE_PUBSUB_TOPIC
                },

                payloadOptions: {
                    includeResource: true
                }
            }
        );

    /*
     * Workspace Events can return a
     * long-running operation.
     */
    if (
        response.name &&
        response.name.startsWith(
            'operations/'
        )
    ) {
        console.log(
            '   Operation:',
            response.name
        );

        return await waitForWorkspaceOperation(
            response.name
        );
    }

    /*
     * Handle an immediate subscription response.
     */
    if (
        response.name &&
        response.name.startsWith(
            'subscriptions/'
        )
    ) {
        workspaceSubscriptionName =
            response.name;

        console.log(
            '✅ Workspace Events subscription created'
        );

        console.log(
            '   Subscription:',
            response.name
        );

        if (response.expireTime) {
            console.log(
                '   Expires:',
                response.expireTime
            );
        }

        return response;
    }

    throw new Error(
        'Unexpected Workspace Events API response while creating subscription'
    );
}


// --------------------------------------------------
// RENEW SUBSCRIPTION
// --------------------------------------------------

async function renewWorkspaceSubscription(
    subscription
) {
    const accessToken =
        await getWorkspaceAccessToken();

    const name =
        subscription.name;

    console.log(
        '🔄 Renewing Google Chat Workspace Events subscription...'
    );

    console.log(
        '   Subscription:',
        name
    );

    const response =
        await workspaceRequest(
            `${WORKSPACE_EVENTS_BASE}/${name}`,
            accessToken,
            'PATCH',
            {
                ttl: '0s'
            }
        );

    workspaceSubscriptionName =
        name;

    console.log(
        '✅ Workspace Events subscription renewed'
    );

    if (response.expireTime) {
        console.log(
            '   New expiry:',
            response.expireTime
        );
    }

    return response;
}


// --------------------------------------------------
// ENSURE ACTIVE SUBSCRIPTION
// --------------------------------------------------

async function ensureWorkspaceSubscription() {
    try {
        console.log(
            '🔎 Checking Google Workspace Events subscription...'
        );

        const subscriptions =
            await listWorkspaceSubscriptions();

        const matching =
            subscriptions
                .filter(subscription =>
                    subscription.targetResource ===
                    WORKSPACE_TARGET_RESOURCE
                )
                .filter(subscription =>
                    subscription.state === 'ACTIVE' ||
                    subscription.state === 'CREATING'
                );

        if (matching.length === 0) {
            console.log(
                '⚠️ No active Chat Events subscription found.'
            );

            await createWorkspaceSubscription();

            return;
        }

        /*
         * Prefer the subscription we already know.
         * Otherwise use the first matching active one.
         */
        const subscription =
            matching.find(item =>
                item.name ===
                workspaceSubscriptionName
            ) || matching[0];

        workspaceSubscriptionName =
            subscription.name;

        console.log(
            '   Subscription:',
            subscription.name
        );

        console.log(
            '   State:',
            subscription.state
        );

        if (subscription.expireTime) {
            const expiresAt =
                new Date(
                    subscription.expireTime
                ).getTime();

            const remaining =
                expiresAt -
                Date.now();

            const remainingMinutes =
                Math.round(
                    remaining / 60000
                );

            console.log(
                `   Time remaining: ${remainingMinutes} minutes`
            );

            /*
             * Renew with plenty of time left.
             */
            if (
                remaining <
                90 * 60 * 1000
            ) {
                await renewWorkspaceSubscription(
                    subscription
                );
            } else {
                console.log(
                    '✅ Subscription has sufficient lifetime'
                );
            }
        } else {
            console.log(
                '✅ Subscription is active without an expiry timestamp'
            );
        }

    } catch (error) {
        console.error(
            '❌ Workspace Events subscription check failed:'
        );

        console.error(
            error.response ||
            error.message ||
            error
        );
    }
}


// --------------------------------------------------
// START SUBSCRIPTION MANAGER
// --------------------------------------------------

function startWorkspaceSubscriptionManager() {
    console.log(
        '🔄 Workspace Events subscription manager started'
    );

    /*
     * Check immediately on startup.
     */
    ensureWorkspaceSubscription();

    /*
     * Then check every 30 minutes.
     */
    setInterval(
        ensureWorkspaceSubscription,
        30 * 60 * 1000
    );
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

        // ---------------- ATTACHMENT HELPERS ----------------

        async function parseMultipartAttachment(req, maxBytes = 200 * 1024 * 1024) {
            const Busboy = require('busboy');
            const fs = require('fs');
            const os = require('os');
            const path = require('path');
            const crypto = require('crypto');

            return await new Promise((resolve, reject) => {
                let finished = false;
                let totalBytes = 0;
                let fileInfo = null;
                let fileStream = null;
                let filePath = null;
                const fields = {};

                let bb;

                try {
                    bb = Busboy({
                        headers: req.headers,
                        limits: {
                            files: 1,
                            fileSize: maxBytes
                        }
                    });
                } catch (error) {
                    reject(error);
                    return;
                }

                const cleanup = () => {
                    if (fileStream) {
                        try {
                            fileStream.destroy();
                        } catch {}
                    }

                    if (filePath) {
                        try {
                            fs.unlinkSync(filePath);
                        } catch {}
                    }
                };

                bb.on('field', (name, value) => {
                    fields[name] = value;
                });

                bb.on('file', (name, stream, info) => {
                    if (name !== 'file') {
                        stream.resume();
                        return;
                    }

                    const safeName =
                        path.basename(info.filename || 'attachment');

                    filePath = path.join(
                        os.tmpdir(),
                        `chatmirror-${crypto.randomUUID()}-${safeName}`
                    );

                    fileInfo = {
                        filename: safeName,
                        contentType:
                            info.mimeType ||
                            'application/octet-stream'
                    };

                    fileStream = fs.createWriteStream(filePath);

                    stream.on('data', chunk => {
                        totalBytes += chunk.length;

                        if (totalBytes > maxBytes) {
                            stream.destroy(
                                new Error(
                                    'Attachment exceeds the 200 MB limit'
                                )
                            );
                        }
                    });

                    stream.on('limit', () => {
                        stream.destroy(
                            new Error(
                                'Attachment exceeds the 200 MB limit'
                            )
                        );
                    });

                    stream.on('error', error => {
                        if (!finished) {
                            finished = true;
                            cleanup();
                            reject(error);
                        }
                    });

                    fileStream.on('error', error => {
                        if (!finished) {
                            finished = true;
                            cleanup();
                            reject(error);
                        }
                    });

                    stream.pipe(fileStream);
                });

                bb.on('error', error => {
                    if (!finished) {
                        finished = true;
                        cleanup();
                        reject(error);
                    }
                });

                bb.on('finish', () => {
                    if (finished) {
                        return;
                    }

                    finished = true;

                    if (!fileInfo || !filePath) {
                        reject(
                            new Error(
                                'No attachment file was provided'
                            )
                        );
                        return;
                    }

                    fileStream.end(() => {
                        resolve({
                            fields,
                            filePath,
                            fileInfo,
                            size: totalBytes,
                            cleanup
                        });
                    });
                });

                req.pipe(bb);
            });
        }

        async function downloadChatAttachment(
            resourceName,
            res,
            filename,
            contentType
        ) {
            const response = await chat.media.download(
                {
                    resourceName,
                    alt: 'media'
                },
                {
                    responseType: 'stream'
                }
            );

            res.statusCode = 200;

            res.setHeader(
                'Content-Type',
                contentType || 'application/octet-stream'
            );

            res.setHeader(
                'Content-Disposition',
                `inline; filename="${String(
                    filename || 'attachment'
                ).replace(/["\\\r\n]/g, '_')}"`
            );

            res.setHeader(
                'Cache-Control',
                'private, max-age=300'
            );

            response.data.pipe(res);
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

            const text =
                String(body.text || '').trim();

            const replyThreadName =
                String(body.replyThreadName || '').trim();

            if (!text) {
                return sendJSON(res, 400, {
                    error: 'Message cannot be empty'
                });
            }

            if (
                replyThreadName &&
                !replyThreadName.startsWith(
                    `${spaceName}/threads/`
                )
            ) {
                return sendJSON(res, 400, {
                    error: 'Invalid reply thread'
                });
            }

            const message =
                await sendMessage(
                    spaceName,
                    text,
                    null,
                    replyThreadName || null
                );

            return sendJSON(res, 200, {
                message
            });
        }

        // ---------------- SEND ATTACHMENT ----------------

        if (
            req.method === 'POST' &&
            url.pathname.startsWith('/api/spaces/') &&
            url.pathname.endsWith('/attachments')
        ) {
            const encodedSpace = url.pathname
                .slice('/api/spaces/'.length)
                .slice(0, -'/attachments'.length);

            const spaceName = decodeURIComponent(encodedSpace);

            if (!spaceName.startsWith('spaces/')) {
                return sendJSON(res, 400, {
                    error: 'Invalid space'
                });
            }

            const upload = await parseMultipartAttachment(req);

            try {
                const text =
                    String(upload.fields.text || '').trim();

                const replyThreadName =
                    String(
                        upload.fields.replyThreadName || ''
                    ).trim();

                if (
                    replyThreadName &&
                    !replyThreadName.startsWith(
                        `${spaceName}/threads/`
                    )
                ) {
                    throw new Error(
                        'Invalid reply thread'
                    );
                }

                console.log(
                    `📎 Uploading attachment: ${upload.fileInfo.filename} (${upload.size} bytes)`
                );

                const attachmentDataRef =
                    await uploadChatAttachment(
                        spaceName,
                        upload.fileInfo.filename,
                        upload.fileInfo.contentType,
                        upload.filePath
                    );

                if (
                    !attachmentDataRef ||
                    !(
                        attachmentDataRef.attachmentUploadToken ||
                        attachmentDataRef.resourceName
                    )
                ) {
                    throw new Error(
                        'Google Chat did not return an attachment reference'
                    );
                }

                const message =
                    await sendMessage(
                        spaceName,
                        text,
                        attachmentDataRef,
                        replyThreadName || null
                    );

                console.log(
                    `📎 Attachment message sent: ${message.name}`
                );

                return sendJSON(res, 200, {
                    message
                });

            } finally {
                upload.cleanup();
            }
        }

        // ---------------- DOWNLOAD ATTACHMENT ----------------

        if (
            req.method === 'GET' &&
            url.pathname === '/api/attachments/download'
        ) {
            const resourceName =
                url.searchParams.get('resourceName');

            const filename =
                url.searchParams.get('filename') ||
                'attachment';

            const contentType =
                url.searchParams.get('contentType') ||
                'application/octet-stream';

            if (!resourceName) {
                return sendJSON(res, 400, {
                    error: 'Missing attachment resourceName'
                });
            }

            return await downloadChatAttachment(
                resourceName,
                res,
                filename,
                contentType
            );
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

startWorkspaceSubscriptionManager();

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
