const fs = require("fs");
const path = require("path");

const LATEST_TIME_PATH = path.join(__dirname, "logs/latest-fetched-times.json");

function loadTimes() {
  try {
    return JSON.parse(fs.readFileSync(LATEST_TIME_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveTimes(times) {
  fs.writeFileSync(LATEST_TIME_PATH, JSON.stringify(times, null, 2));
}

function getLatestTime(handle) {
  const times = loadTimes();
  const value = times[handle];
  return value ? new Date(value) : null;
}

function maybeUpdateLatestTweetTime(handle, tweetCreatedAt) {
  const times = loadTimes();
  const current = times[handle] ? new Date(times[handle]) : null;
  const incoming = new Date(tweetCreatedAt);

  if (!current || incoming > current) {
    times[handle] = incoming.toISOString();
    saveTimes(times);
  }
}

function maybeUpdateLatestTime(handle) {
  const times = loadTimes();
  const now = new Date().toISOString();
  times[handle] = now;
  saveTimes(times);
}

module.exports = {
  getLatestTime,
  maybeUpdateLatestTime,
  maybeUpdateLatestTweetTime
};
