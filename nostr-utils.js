const fs = require('fs');
const path = require('path');
const { generatePrivateKey, getPublicKey, getEventHash, getSignature, relayInit } = require('nostr-tools');

const ACCOUNTS_DIR = path.join(__dirname, 'nostr-accounts');
const PUBLISHED_PROFILES_LOG = path.join(__dirname, 'logs/published-profiles.json');

// Ensure directories exist
if (!fs.existsSync(ACCOUNTS_DIR)) fs.mkdirSync(ACCOUNTS_DIR);
if (!fs.existsSync('logs')) fs.mkdirSync('logs');
if (!fs.existsSync(PUBLISHED_PROFILES_LOG)) fs.writeFileSync(PUBLISHED_PROFILES_LOG, '[]');

/**
 * Create or return existing Nostr account for a given Twitter handle.
 */

function createNostrAccount(twitterHandle, profileData, latestCreatedAt = null) {
  const filename = path.join(ACCOUNTS_DIR, `${twitterHandle}.json`);

  if (fs.existsSync(filename)) {
    console.log(`[SKIP] Account for @${twitterHandle} already exists.`);
    return JSON.parse(fs.readFileSync(filename, 'utf8'));
  }

  const privateKey = generatePrivateKey();
  const publicKey = getPublicKey(privateKey);

  const account = {
    twitterHandle,
    name: profileData.name,
    displayName: profileData.displayName || profileData.name,
    picture: profileData.profile_image_url_https || '',
    pubkey: publicKey,
    privkey: privateKey,
    lastFetchedAt: latestCreatedAt ? new Date(latestCreatedAt).toISOString() : null,
  };

  fs.writeFileSync(filename, JSON.stringify(account, null, 2));
  console.log(`[✅] Created Nostr account for @${twitterHandle}`);
  return account;
}

/**
 * Return all stored Nostr accounts.
 */
function getAllAccounts() {
  return fs.readdirSync(ACCOUNTS_DIR)
    .map(file => JSON.parse(fs.readFileSync(path.join(ACCOUNTS_DIR, file))));
}

/**
 * Check if profile has already been published to the relay.
 */
function alreadyPublished(pubkey) {
  const published = JSON.parse(fs.readFileSync(PUBLISHED_PROFILES_LOG));
  return published.includes(pubkey);
}

/**
 * Mark a profile as published.
 */
function markAsPublished(pubkey) {
  const published = JSON.parse(fs.readFileSync(PUBLISHED_PROFILES_LOG));
  if (!published.includes(pubkey)) {
    published.push(pubkey);
    fs.writeFileSync(PUBLISHED_PROFILES_LOG, JSON.stringify(published, null, 2));
  }
}

/**
 * Publish kind:0 metadata (profile) to a relay if not already published.
 */
async function publishProfileIfNotExists(account, relayUrl) {
  try {

    if (alreadyPublished(account.pubkey)) {
      console.log(`🧑‍🎤 Profile already published for ${account.twitterHandle}`);
      return;
    }
  
    const profileEvent = {
      kind: 0,
      pubkey: account.pubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify({
        name: account.name,
        display_name: account.displayName,
        picture: account.picture,
      }),
    };
  
    profileEvent.id = getEventHash(profileEvent);
    profileEvent.sig = getSignature(profileEvent, account.privkey);
  
    const relay = relayInit(relayUrl);
    await relay.connect();
  
    const ok = await relay.publish(profileEvent);
  
    if (ok) {
      console.log(`✅ Relay accepted profile for @${account.twitterHandle}`);
      markAsPublished(account.pubkey);
    } else {
      console.warn(`⚠️ Relay did not immediately accept profile for @${account.twitterHandle}`);
    }
  
    setTimeout(() => {
      relay.close();
    }, 1500); // give it time to finish
  } catch (error) {
    console.error(`❌ Error publishing profile for @${account.twitterHandle}:`, error?.message);
  }
}

module.exports = {
  createNostrAccount,
  getAllAccounts,
  publishProfileIfNotExists,
};
