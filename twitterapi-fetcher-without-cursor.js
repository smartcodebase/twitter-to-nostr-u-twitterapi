const fetch = require("node-fetch");
const { INFLUENCERS } = require("./config");
const { getLatestTime, maybeUpdateLatestTime } = require("./latest-time-store");

const API_KEY = "8cabc448c25947318fd6115939a9282d";
const BASE_URL = "https://api.twitterapi.io/twitter/tweet/advanced_search";

function toTwitterUTCFormat(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}_` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}_UTC`
  );
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
      const query = `from:${influencer} since:${since}`;
      const url = `${BASE_URL}?queryType=Latest&query=${encodeURIComponent(query)}`;

      console.log(`🔍 [${i + 1}] Fetching: ${url}`);

      const res = await fetch(url, {
        method: "GET",
        headers: {
          "X-API-Key": API_KEY,
        },
      });

      const json = await res.json();

      if (!res.ok) {
        console.warn(`⚠️ [${i + 1}] HTTP ${res.status} for ${influencer}: ${json?.message || "Unknown error"}`);
        return [];
      }

      if (!Array.isArray(json.tweets)) {
        console.warn(`⚠️ [${i + 1}] Invalid format: no tweets[] returned for ${influencer}`);
        return [];
      }

      const tweets = json.tweets;

      maybeUpdateLatestTime(influencer);

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
  return allTweets;
}

module.exports = { fetchTweetsFromTwitterAPI };
