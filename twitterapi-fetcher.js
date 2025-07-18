const fetch = require("node-fetch");
const { INFLUENCERS, TWITTER_API_KEY, TWITTER_API__URL } = require("./config");
const { getLatestTime, maybeUpdateLatestTime } = require("./latest-time-store");

function toTwitterUTCFormat(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}_` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}_UTC`
  );
}

async function fetchAllTweets(influencer, since, i) {
  const tweets = [];
  let hasNextPage = true;
  let nextCursor = null;

  while (hasNextPage) {
    const baseParams = `queryType=Latest&query=${encodeURIComponent(`from:${influencer} since:${since} -filter:replies -filter:retweets`)}`
    + (nextCursor ? `&cursor=${encodeURIComponent(nextCursor)}` : "");

    const url = `${TWITTER_API__URL}?${baseParams}`;
    console.log(`🔁 [${i + 1}] Fetching page → ${url}`);

    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "X-API-Key": TWITTER_API_KEY,
        },
      });

      const json = await res.json();

      if (!res.ok) {
        console.warn(`⚠️ [${i + 1}] HTTP ${res.status} for ${influencer}: ${json?.message || "Unknown error"}`);
        break;
      }

      
      if (!Array.isArray(json.tweets)) {
        console.warn(`⚠️ [${i + 1}] Unexpected format for ${influencer}`);
        break;
      }
        
      maybeUpdateLatestTime(influencer);

      tweets.push(...json.tweets);

      hasNextPage = json.has_next_page;
      nextCursor = json.next_cursor;
    } catch (err) {
      console.error(`❌ [${i + 1}] Error for ${influencer}:`, err.message);
      break;
    }
  }

  return tweets;
}

async function fetchTweetsFromTwitterAPI(concurrency = 5) {
  const runWithConcurrencyLimit = async (tasks, limit) => {
    const results = [];
    let running = 0;
    let index = 0;

    return new Promise((resolve, reject) => {
      const next = () => {
        if (index === tasks.length && running === 0) {
          return resolve(results.flat());
        }

        while (running < limit && index < tasks.length) {
          const currentIndex = index++;
          const task = tasks[currentIndex];

          running++;
          task()
            .then((result) => {
              results[currentIndex] = result;
              running--;
              next();
            })
            .catch((err) => reject(err));
        }
      };

      next();
    });
  };

  const tasks = INFLUENCERS.map((influencer, i) => async () => {
    try {

      const now = new Date();
      const lastFetched = getLatestTime(influencer) || new Date(now.getTime() - 60 * 60 * 1000);
      const since = toTwitterUTCFormat(lastFetched);
      const tweets = await fetchAllTweets(influencer, since, i);
      console.log(`✅ [${i + 1}] Got ${tweets.length} tweets for ${influencer}`);

      return tweets;
    } catch (err) {
      console.error(`❌ [${i + 1}] Error for ${influencer}:`, err.message);
      return [];
    }
  });

  const all = await runWithConcurrencyLimit(tasks, concurrency);
  const allTweets = all.flat();

  console.log(`🎯 Total tweets fetched: ${allTweets.length}`);

  // const fs = require("fs");
  // const path = require("path");

  // const TMP_LOG_FILE = path.join(__dirname, "tmp-logs/fetched-tweets-log.json");
  // if (!fs.existsSync("tmp-logs")) fs.mkdirSync("tmp-logs");
  // if (!fs.existsSync(TMP_LOG_FILE)) fs.writeFileSync(TMP_LOG_FILE, "[]");
  // fs.writeFileSync(TMP_LOG_FILE, JSON.stringify(allTweets, null, 2));


  return allTweets;
}

module.exports = { fetchTweetsFromTwitterAPI };
