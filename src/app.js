/*eslint no-constant-condition: 0*/

require('dotenv').config();

import 'babel-polyfill';
import Telegraf from 'telegraf';
// import macd from 'macd';
import { MACD } from 'technicalindicators';
import request from 'request-promise-native';
import delay from 'timeout-as-promise';


(async () => {

  let lastValues = {};


  // Initialize Telegraf to connect to Telegram
  const bot = new Telegraf(process.env.TELEGRAM_TOKEN, { username: process.env.TELEGRAM_USERNAME });

  // When a user connects to the bot's chat for the first time
  bot.start((ctx) => {
    console.log('Chat started with: ' + JSON.stringify(ctx.from));
    ctx.reply('Welcome!');
  });

  // When a user type "/values"
  bot.command('values', (ctx) => {
    ctx.reply(`Action: ${lastValues.action}\nLast histogram value: ${lastValues.lastHistogramValue}\nLast candle close price: ${lastValues.lastCandleClosePrice}\n`);
  });

  // Start the bot
  bot.startPolling();


  // const chatId = -1001340775946;
  // Users IDs (Telegram needs those IDs)
  const users = {
    laurent: 224003278,
    adrien: 170179231
  };


  // We want n candles sinces x seconds.
  const candlesSeconds = 60;
  const candles = 480; // 480 * 60 seconds = 8h

  // Infinite loop
  while (true) {

    // Get trades from Cryptowat's API
    const trades = await request(
      'https://api.cryptowat.ch/markets/kraken/btceur/ohlc',
      {
        json: true,
        qs: {
          periods: candlesSeconds, // number of seconds
          after: Math.round(Date.now() / 1000) - candlesSeconds * candles, // since this unixtime
          before: Math.round(Date.now() / 1000), // until this unixtime (current time)
        }
      });


    // Format the trades received
    // [ CloseTime, OpenPrice, HighPrice, LowPrice, ClosePrice, Volume ]
    const datas = trades.result['60'].map(e => e[4]);

    // Get MACD statistics
    // const result = macd(datas, 10, 26, 9);
    const result = MACD.calculate({
      values: datas,
      fastPeriod: 10,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });

    // Get the last candle close price
    const lastCandleClosePrice = datas[datas.length - 1];

    // Get the last histogram value
    const lastResult = result[result.length - 1];
    const lastHistogramValue = lastResult.histogram;

    // Set action to buy if the last histogram value if positive, sale if negative
    const action = lastHistogramValue > 0 ? 'buy' : 'sale';

    // Send a message if action is different from the last action we defined
    if (lastValues.action && lastValues.action !== action) {
      const message = `${new Date()} - ${lastCandleClosePrice.toFixed(2).toString().padStart(8)} - ${action}`;
      console.log(message);

      // Send the message to every user in "users"
      for (const nick in users) {
        bot.telegram.sendMessage(users[nick], message);
      }
    }

    // Save the last values we received
    lastValues = { action, lastCandleClosePrice, lastHistogramValue };

    // Waiting 60 seconds until we start over the loop (while)
    await delay(60 * 1000);
  }
})();
