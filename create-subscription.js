const fs = require('fs');
const path = require('path');
const https = require('https');

const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');

const PROJECT_ID = 'weighty-vertex-510815-p1';

const PUBSUB_TOPIC =
  `projects/${PROJECT_ID}/topics/chat_events`;

/*
 * Subscribe to ALL Google Chat spaces where the
 * authenticated user is a member.
 */
const TARGET_RESOURCE =
  '//chat.googleapis.com/spaces/-';

/*
 * Events we want in real time.
 */
const EVENT_TYPES = [
  'google.workspace.chat.message.v1.created',
  'google.workspace.chat.message.v1.updated',
  'google.workspace.chat.message.v1.deleted'
];

function loadToken() {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(
      `token.json not found at:\n${TOKEN_PATH}\n\nRun node auth.js first.`
    );
  }

  return JSON.parse(
    fs.readFileSync(TOKEN_PATH, 'utf8')
  );
}

function requestGoogle(url, accessToken, method, body) {
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
        'Content-Type': 'application/json'
      }
    };

    if (requestBody) {
      options.headers['Content-Length'] =
        Buffer.byteLength(requestBody);
    }

    const req = https.request(options, res => {
      let data = '';

      res.setEncoding('utf8');

      res.on('data', chunk => {
        data += chunk;
      });

      res.on('end', () => {
        let parsedData;

        try {
          parsedData = data
            ? JSON.parse(data)
            : {};
        } catch {
          parsedData = {
            raw: data
          };
        }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parsedData);
        } else {
          const error = new Error(
            `Google API returned HTTP ${res.statusCode}`
          );

          error.statusCode = res.statusCode;
          error.response = parsedData;

          reject(error);
        }
      });
    });

    req.on('error', reject);

    if (requestBody) {
      req.write(requestBody);
    }

    req.end();
  });
}

async function main() {
  console.log('');
  console.log('========================================');
  console.log('   GOOGLE CHAT LIVE EVENT SUBSCRIPTION');
  console.log('========================================');
  console.log('');

  const token = loadToken();

  if (!token.access_token) {
    throw new Error(
      'token.json does not contain an access_token.'
    );
  }

  console.log('🎯 Target resource:');
  console.log(`   ${TARGET_RESOURCE}`);
  console.log('');

  console.log('📡 Pub/Sub topic:');
  console.log(`   ${PUBSUB_TOPIC}`);
  console.log('');

  console.log('📨 Event types:');

  for (const eventType of EVENT_TYPES) {
    console.log(`   • ${eventType}`);
  }

  console.log('');
  console.log('🚀 Creating Workspace Events subscription...');
  console.log('');

  const response = await requestGoogle(
    'https://workspaceevents.googleapis.com/v1/subscriptions',
    token.access_token,
    'POST',
    {
      targetResource: TARGET_RESOURCE,

      eventTypes: EVENT_TYPES,

      notificationEndpoint: {
        pubsubTopic: PUBSUB_TOPIC
      },

      /*
       * Include the changed Chat resource directly
       * in the event payload.
       *
       * This means our Node server can receive the
       * message contents without immediately making
       * another Chat API request.
       */
      payloadOptions: {
        includeResource: true
      }
    }
  );

  console.log('========================================');
  console.log('🎉 SUBSCRIPTION REQUEST ACCEPTED');
  console.log('========================================');
  console.log('');

  console.log(
    JSON.stringify(response, null, 2)
  );

  console.log('');
  console.log(
    'Google may return an operation that finishes asynchronously.'
  );
  console.log('');
}

main().catch(error => {
  console.error('');
  console.error('========================================');
  console.error('❌ SUBSCRIPTION CREATION FAILED');
  console.error('========================================');
  console.error('');

  console.error(
    error.response ||
    error.message ||
    error
  );

  console.error('');

  process.exit(1);
});
