const { getEventHash, getSignature } = require("nostr-tools");
const { fetchTweetsFromTwitterAPI } = require("./twitterapi-fetcher");
const {
  createNostrAccount,
  publishProfileIfNotExists,
  publishToRelay,
  buildNostrNote
} = require("./nostr-utils");
const { RELAY_URL, VERSION } = require("./config");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

global.WebSocket = WebSocket;

let isJobRunning = false;

const today = new Date().toISOString().slice(0, 10);
const TWEETS_LOG_FILE = path.join(__dirname, `tweet_logs/log-${today}.json`);
if (!fs.existsSync("tweet_logs")) fs.mkdirSync("tweet_logs");
if (!fs.existsSync(TWEETS_LOG_FILE)) fs.writeFileSync(TWEETS_LOG_FILE, "");

const LOG_FILE = path.join(__dirname, "logs/posted-log.json");
if (!fs.existsSync("logs")) fs.mkdirSync("logs");
if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, "[]");

function loadPostedLog() {
  try {
    const raw = JSON.parse(fs.readFileSync(LOG_FILE));
    const map = new Map();
    for (const entry of raw) {
      if (entry?.tweetId) map.set(entry.tweetId, entry);
    }
    return map;
  } catch (e) {
    return new Map();
  }
}

function savePostedLog(postedMap) {
  const arr = Array.from(postedMap.values());
  fs.writeFileSync(LOG_FILE, JSON.stringify(arr, null, 2));
}

async function runBot() {
  if (isJobRunning) {
    console.log("🔴 Job already running. Skipping...");
    return;
  }

  isJobRunning = true;

  const postedLog = loadPostedLog();
  const tweets = await fetchTweetsFromTwitterAPI();

  const sorted = tweets.sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  ); // Shuffle the tweets
  console.log(sorted.length);

  for (const tweet of sorted) {
    // if(tweet?.isReply || tweet?.retweeted_tweet || tweet?.isQuote || tweet?.lang !== 'en' || tweet?.extendedEntities?.media?.length > 0 || tweet?.card) {
    if (
      tweet?.isReply ||
      tweet?.retweeted_tweet ||
      tweet?.lang !== "en" ||
      // tweet?.extendedEntities?.media?.length > 0 ||
      tweet?.card
    ) {
      console.log(
        `⏩ Skipping Intentionally reply/retweet/media/language: ${tweet.id}`
      );
      continue;
    }

    const tweetId = tweet.id;
    if (postedLog.has(tweetId)) {
      console.log(`⏩ Already posted: ${tweetId}`);
      continue;
    }

    const handle = tweet.author?.userName;
    const profileData = {
      name: tweet.author?.name,
      profile_image_url_https: tweet.author?.profilePicture,
    };

    const nostrAccount = createNostrAccount(handle, profileData);
    await publishProfileIfNotExists(nostrAccount, RELAY_URL);
    const event = buildNostrNote(tweet, nostrAccount.pubkey);
    event.id = getEventHash(event);
    event.sig = getSignature(event, nostrAccount.privkey);

    try {
      await publishToRelay(event, RELAY_URL);
      postedLog.set(tweetId, {
        tweetId,
        eventId: event.id,
        pubkey: nostrAccount.pubkey,
        privkey: nostrAccount.privkey,
        version: VERSION,
        flag: 0
      });

      fs.appendFileSync(TWEETS_LOG_FILE, JSON.stringify(tweet) + "\n");

    } catch (err) {
      console.error(`❌ Failed to post tweet ${tweetId}:`, err);
    }
  }
  savePostedLog(postedLog);

  isJobRunning = false;
}

module.exports = { runBot };
