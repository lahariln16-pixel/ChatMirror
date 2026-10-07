const fs = require('fs');
const path = require('path');

const { OAuth2Client } = require('google-auth-library');
const { PubSub } = require('@google-cloud/pubsub');

const PROJECT_ID = 'weighty-vertex-510815-p1';
const SUBSCRIPTION_NAME = 'chat_events_sub';

const TOKEN_PATH = path.join(__dirname, 'token.json');
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');

function loadJson(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`File not found: ${file}`);
  }

  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function main() {
  console.log('');
  console.log('========================================');
  console.log('       GOOGLE CHAT LIVE RECEIVER');
  console.log('========================================');
  console.log('');

  const credentials = loadJson(CREDENTIALS_PATH);
  const token = loadJson(TOKEN_PATH);

  if (!token.access_token) {
    throw new Error('token.json has no access_token');
  }

  console.log('🔐 Loading OAuth credentials...');

  const oauth2Client = new OAuth2Client(
    credentials.installed?.client_id ||
      credentials.web?.client_id,

    credentials.installed?.client_secret ||
      credentials.web?.client_secret,

    credentials.installed?.redirect_uris?.[0] ||
      credentials.web?.redirect_uris?.[0]
  );

  oauth2Client.setCredentials(token);

  console.log('   ✅ OAuth token loaded');

  console.log('');
  console.log('📡 Connecting to Pub/Sub...');
  console.log(`   Project: ${PROJECT_ID}`);
  console.log(`   Subscription: ${SUBSCRIPTION_NAME}`);
  console.log('');

  /*
   * Use the OAuth2 access token directly.
   *
   * This avoids requiring gcloud or Application
   * Default Credentials on your machine.
   */
  const pubsub = new PubSub({
    projectId: PROJECT_ID,
    authClient: oauth2Client
  });

  const subscription =
    pubsub.subscription(SUBSCRIPTION_NAME);

  console.log('========================================');
  console.log('       🔴 LISTENING FOR EVENTS');
  console.log('========================================');
  console.log('');

  console.log(
    'Waiting for Google Chat events...'
  );

  console.log('');
  console.log(
    'Send a message in any Google Chat space'
  );
  console.log(
    'your account can access.'
  );

  console.log('');
  console.log(
    'Press Ctrl+C to stop.'
  );

  console.log('');

  subscription.on('message', message => {
    console.log('');
    console.log('========================================');
    console.log('🔥 LIVE GOOGLE CHAT EVENT');
    console.log('========================================');

    console.log('');
    console.log('📨 Message ID:');
    console.log(`   ${message.id}`);

    console.log('');
    console.log('⏰ Published:');
    console.log(`   ${message.publishTime}`);

    console.log('');
    console.log('📦 Attributes:');

    if (message.attributes) {
      console.log(
        JSON.stringify(
          message.attributes,
          null,
          2
        )
      );
    }

    console.log('');
    console.log('📝 DATA:');

    const rawData =
      message.data?.toString('utf8') || '';

    try {
      const parsed =
        JSON.parse(rawData);

      console.log(
        JSON.stringify(
          parsed,
          null,
          2
        )
      );
    } catch {
      console.log(rawData);
    }

    console.log('');
    console.log('========================================');
    console.log('');

    /*
     * IMPORTANT:
     * Acknowledge only after we've successfully
     * received and processed the event.
     */
    message.ack();
  });

  subscription.on('error', error => {
    console.error('');
    console.error('========================================');
    console.error('❌ PUB/SUB ERROR');
    console.error('========================================');
    console.error('');
    console.error(
      error.message || error
    );
    console.error('');
  });

  subscription.on('close', () => {
    console.log('');
    console.log('⚠️ Pub/Sub connection closed.');
  });
}

process.on('SIGINT', () => {
  console.log('');
  console.log('');
  console.log('🛑 Stopping receiver...');
  process.exit(0);
});

main().catch(error => {
  console.error('');
  console.error('========================================');
  console.error('❌ RECEIVER FAILED');
  console.error('========================================');
  console.error('');

  console.error(
    error.response?.data ||
    error.message ||
    error
  );

  console.error('');

  process.exit(1);
});
