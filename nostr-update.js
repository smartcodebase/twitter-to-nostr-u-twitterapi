const fs = require("fs");
const path = require("path");
const { getEventHash, getSignature } = require("nostr-tools");

const { RELAY_URL, VERSION } = require("./config");
const {
  publishToRelay,
  buildNostrNote
} = require("./nostr-utils");

// Get optional flag from CLI args (e.g. `npm run update-version -- --flag=0`)
const argv = process.argv.slice(2);
let flag = null;


for (const arg of argv) {
  if (arg.startsWith("--flag=")) {
    flag = parseInt(arg.split("=")[1], 10);
    if (isNaN(flag)) {
      console.error("❌ Invalid flag value");
      process.exit(1);
    }
  }
}

const LOG_FILE = path.join(__dirname, "logs", "posted-log.json");
const TWEETS_LOG_DIR = path.join(__dirname, "tweet_logs");

async function updateOutdatedEvents(outdatedItems, tweetMap) {
  for (const item of outdatedItems) {
    const { tweetId, eventId, pubkey, privkey } = item;

    const tweet = tweetMap.get(tweetId);
    if (!tweet) {
      console.warn(`⚠️ Skipping: tweetId ${tweetId} not found in TWEETS_LOG_FILE`);
      continue;
    }

    const deleteEvent = {
      kind: 5,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["e", eventId]],
      content: "Deleting outdated tweet version",
      pubkey: pubkey,
    };
    deleteEvent.id = getEventHash(deleteEvent);
    deleteEvent.sig = getSignature(deleteEvent, privkey);

    console.log(`🗑 Deleting event with id: ${eventId}`);
    await publishToRelay(deleteEvent, RELAY_URL);

    const newEvent = buildNostrNote(tweet, pubkey);
    newEvent.id = getEventHash(newEvent);
    newEvent.sig = getSignature(newEvent, privkey);
    console.log(`🆕 Republishing tweetId: ${tweetId}`);
    await publishToRelay(newEvent, RELAY_URL);

    const updatedLogEntry = {
      tweetId,
      eventId: newEvent.id,
      version: VERSION,
      flag: flag ?? 0,
      pubkey,
      privkey
    };

    const index = allPublishedTweets.findIndex(entry => entry.tweetId === tweetId);
    if (index !== -1) {
      allPublishedTweets[index] = updatedLogEntry;
    } else {
      allPublishedTweets.push(updatedLogEntry);
    }

    fs.writeFileSync(LOG_FILE, JSON.stringify(allPublishedTweets, null, 2), "utf-8");

  }
}


let allPublishedTweets = [];
try {
  const fileContent = fs.readFileSync(LOG_FILE, "utf8");
  allPublishedTweets = JSON.parse(fileContent);
} catch (err) {
  console.error("❌ Failed to read or parse posted-log.json:", err.message);
  process.exit(1);
}

const outdatedItems = allPublishedTweets.filter(item => {
  if (flag !== null) {
    return item.version < VERSION && item.flag === flag;
  } else {
    return item.version < VERSION;
  }
});

console.log(`✅ Found ${outdatedItems.length} items (version < ${VERSION}${flag !== null ? ` && flag == ${flag}` : ""})`);

for (const item of outdatedItems) {
  console.log(`- tweetId: ${item.tweetId}, version: ${item.version}, flag: ${item.flag}`);
}

const tweetMap = new Map();


const files = fs.readdirSync(TWEETS_LOG_DIR);

for (const file of files) {
  if (!file.endsWith(".json")) continue; // skip non-JSON files

  const filePath = path.join(TWEETS_LOG_DIR, file);
  const content = fs.readFileSync(filePath, "utf-8");

  content
    .split("\n")
    .filter(Boolean)
    .forEach(line => {
      try {
        const tweet = JSON.parse(line);
        if (tweet?.id) {
          tweetMap.set(tweet.id, tweet);
        }
      } catch (e) {
        console.warn(`⚠️ Failed to parse line in ${file}:`, e.message);
      }
    });
}

updateOutdatedEvents(outdatedItems, tweetMap);

