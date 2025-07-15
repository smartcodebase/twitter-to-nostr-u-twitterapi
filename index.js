const cron = require('node-cron');
const { runBot } = require('./nostr-bot');
const { RUN_INTERVAL_CRON } = require('./config');

console.log('🕒 Twitter-to-Nostr bot is running...');
runBot(); // Run once immediately

cron.schedule(RUN_INTERVAL_CRON, async () => {
  console.log('\n🔄 Scheduled run starting...');
  await runBot();
});
