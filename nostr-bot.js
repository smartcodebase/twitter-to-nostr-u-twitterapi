const { relayInit, getEventHash, getSignature } = require("nostr-tools");
const { fetchTweetsFromTwitterAPI } = require("./twitterapi-fetcher");
const {
  createNostrAccount,
  publishProfileIfNotExists,
} = require("./nostr-utils");
const { RELAY_URL, INFLUENCERS } = require("./config");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

global.WebSocket = WebSocket;

let isJobRunning = false;

const My_LOG_FILE = path.join(__dirname, "rcm_logs/my-log.json");
if (!fs.existsSync("rcm_logs")) fs.mkdirSync("rcm_logs");
if (!fs.existsSync(My_LOG_FILE)) fs.writeFileSync(My_LOG_FILE, "");

const LOG_FILE = path.join(__dirname, "logs/posted-log.json");
if (!fs.existsSync("logs")) fs.mkdirSync("logs");
if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, "[]");

function loadPostedLog() {
  return new Set(JSON.parse(fs.readFileSync(LOG_FILE)));
}

function savePostedLog(postedIds) {
  fs.writeFileSync(LOG_FILE, JSON.stringify([...postedIds], null, 2));
}

async function publishToRelay(event) {
  const relay = relayInit(RELAY_URL);
  return new Promise(async (resolve, reject) => {
    try {
      await relay.connect();

      relay.on("error", (err) => {
        console.error("❌ Relay connection failed:", err.message);
        reject(err);
      });

      relay.on("connect", async () => {
        console.log(`🔌 Connected to ${RELAY_URL}`);
        await relay.publish(event);
        console.log(`🚀 Published: ${event.content.slice(0, 10)}...`);
        setTimeout(() => {
          relay.close();
          resolve();
        }, 1500);
      });

      setTimeout(() => {
        relay.close();
        reject(new Error("Timeout"));
      }, 5000);
    } catch (e) {
      console.error("❌ Unexpected error:", e);
      reject(e);
    }
  });
}

function buildNostrNote(tweet, nostrAccount) {
  const tweetTimestamp = Math.floor(new Date(tweet.createdAt).getTime() / 1000);
  const now = Math.floor(Date.now() / 1000);
  let mediaUrl = null;
  if (
    tweet.extendedEntities &&
    Array.isArray(tweet.extendedEntities.media) &&
    tweet.extendedEntities.media.length > 0
  ) {
    const media = tweet.extendedEntities.media[0];

    if (media.type === "photo" && media.media_url_https) {
      mediaUrl = media.media_url_https;
    }

    if (
      (media.type === "video" || media.type === "animated_gif") &&
      media.video_info &&
      Array.isArray(media.video_info.variants)
    ) {
      const mp4 = media.video_info.variants
        .filter((v) => v.content_type === "video/mp4")
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      if (mp4?.url) {
        mediaUrl = mp4.url;
      }
    }
  }

  const content = `${tweet.text}${mediaUrl ? `\n\n📸 ${mediaUrl}` : ""}\n\n🔗 ${
    tweet.url
  }`;

  return {
    kind: 1,
    pubkey: nostrAccount.pubkey,
    created_at: tweetTimestamp < now - 600 ? now : tweetTimestamp,
    tags: [
      ["r", tweet.url],
      ["t", "toastr"],
      ["client", "twitter"],
    ],
    // content: `${tweet.text}\n\n🔗 ${tweet.url}`,
    content,
    id: null,
    sig: null,
  };
}

async function runBot() {
  if (isJobRunning) {
    console.log("🔴 Job already running. Skipping...");
    return; // Don't run if the previous job is still in progress
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
        `⏩ Skipping manually reply/retweet/media/language: ${tweet.id}`
      );
      continue;
    }

    const tweetId = tweet.id;
    if (postedLog.has(tweetId)) {
      console.log(`⏩ Already posted: ${tweetId}`);
      continue;
    }

    console.log("🔴🔴🔴🔴🔴 tweet from Apify 🔴🔴🔴🔴");
    fs.appendFileSync(My_LOG_FILE, JSON.stringify(tweet, null, 2) + "\n");

    const handle = tweet.author?.userName;
    const profileData = {
      name: tweet.author?.name,
      profile_image_url_https: tweet.author?.profilePicture,
    };

    const nostrAccount = createNostrAccount(handle, profileData);
    await publishProfileIfNotExists(nostrAccount, RELAY_URL);
    const event = buildNostrNote(tweet, nostrAccount);
    event.id = getEventHash(event);
    event.sig = getSignature(event, nostrAccount.privkey);

    try {
      await publishToRelay(event);
      postedLog.add(tweetId);
    } catch (err) {
      console.error(`❌ Failed to post tweet ${tweetId}:`, err);
    }
  }

  savePostedLog(postedLog);

  isJobRunning = false;
}

module.exports = { runBot };
