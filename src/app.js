/*eslint no-constant-condition: 0*/

require('dotenv').config();

import 'babel-polyfill';
import Telegraf from 'telegraf';
import { MACD } from 'technicalindicators';
import request from 'request-promise-native';
import delay from 'timeout-as-promise';
import { MongoClient } from 'mongodb';
import ccxt from 'ccxt';

(async () => {
  let lastValues = {};


  // let gdax = new ccxt.gdax();
  // let markets = await gdax.load_markets();
  // console.log (gdax.id, markets);


  console.log('Bot is starting');

  console.log('Connection to the database');
  const db = await MongoClient.connect(process.env.MONGODB_URL);

  // Initialize Telegraf to connect to Telegram
  const bot = new Telegraf(process.env.TELEGRAM_TOKEN, { username: process.env.TELEGRAM_USERNAME });

  // When a user connects to the bot's chat for the first time
  bot.start((ctx) => {
    console.log('Chat started with: ' + JSON.stringify(ctx.from));
    ctx.reply('Welcome!');
  });

  // When a user type "/values"
  bot.command('values', (ctx) => {
    ctx.reply(`Action: ${lastValues.todo.action}\nLast histogram value: ${lastValues.histogramValue}\nLast candle close price: ${lastValues.lastCandleClosePrice}\n`);
  });

  // Start the bot
  bot.startPolling();


  // const chatId = -1001340775946;
  // Users IDs (Telegram needs those IDs)
  const users = {
    // laurent: 224003278,
    adrien: 170179231
  };

  const market = 'gdax';

  // We want n candles sinces x seconds.
  const candlesSeconds = 60;
  const candles = 480; // x * 60 seconds = ?h

  const actions = await db.collection('actions').find({}).sort({ date: -1 }).toArray();
  let status = actions[0] || {};

  let statusHasChanged = false;
  let histogramValueBefore;

  // Infinite loop
  while (true) {
    try {
      // Get current price
      const priceResult = await request(
        `https://api.cryptowat.ch/markets/${market}/btceur/price`,
        { json: true }
      );
      const currentPrice = priceResult.result.price;


      // Get trades from Cryptowat's API
      const trades = await request(
        `https://api.cryptowat.ch/markets/${market}/btceur/ohlc`,
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
      const datas = trades.result['60']
        .map(e => e[4])
        // .map((e, i) => { if (!i) { console.log(i); } return e; })
        .filter(e => e !== 0);

      // Get MACD statistics
      const result = MACD.calculate({
        values: datas,
        fastPeriod: 4, // 10
        slowPeriod: 10, // 26
        signalPeriod: 9, // 9
        SimpleMAOscillator: false,
        SimpleMASignal: false
      });

      const histogramValue = result[result.length - 1].histogram;
      const macdIs = histogramValueBefore < histogramValue ? 'growing' : 'declining';

      const gain = status.action === 'buy' ? currentPrice - status.price : 0;

      console.log(`${new Date()} - Price ${currentPrice.toFixed(2)} - Last ${status.action}@${status.price} - macdIs ${macdIs.padStart(9)} - Histogram ${Math.round(histogramValue).toString().padStart(5)} - gain ${Math.round(gain).toString().padStart(5)}`);

      // Set action to buy if the last histogram value if positive, sell if negative
      if (status.action === 'buy') {
        if (macdIs === 'declining' && gain > 0) {
          status = {
            action: 'sell',
            price: currentPrice,
            gainPercent: (gain / status.price) * 100,
            gain,
            reason: 'Top of gain (winner mode)'
          };
          statusHasChanged = true;
        }
        else if (histogramValue <= 2 && gain > 0) {
          status = {
            action: 'sell',
            price: currentPrice,
            gainPercent: (gain / status.price) * 100,
            gain,
            reason: 'MACD is low (security mode)'
          };
          statusHasChanged = true;
        }
        else if (histogramValue <= 0) {
          status = {
            action: 'sell',
            price: currentPrice,
            gainPercent: (gain / status.price) * 100,
            gain,
            reason: 'MACD negative (panic mode)'
          };
          statusHasChanged = true;
        }
      }
      else if (!status.action || status.action === 'sell') {
        if (histogramValue > 0 && histogramValue <= 10 && macdIs !== 'declining') {
          status = {
            action: 'buy',
            price: currentPrice,
            reason: 'Market is growing'
          };
          statusHasChanged = true;
        }
      }


      // Send a message if action is different from the last action we defined
      if (statusHasChanged) {
        await db.collection('actions').insert({ ...status, date: new Date() });

        let message = '';
        if (status.action === 'buy') {
          message = `Buy at ${status.price}€: ${status.reason}`;
        }
        else {
          // const gainPercent;
          message = `Sell at ${status.price}€: ${status.reason}, gain is ${Math.round(status.gainPercent * 100) / 100}% (${Math.round(status.gain * 100) / 100}€)`;
        }

        console.log(message);
        console.log('-----------------------------------------------------');

        // Send the message to every user in "users"
        for (const nick in users) {
          bot.telegram.sendMessage(users[nick], message);
        }
      }

      statusHasChanged = false;
      histogramValueBefore = histogramValue;
    }
    catch (error) {
      console.warn(error);
    }

    // Waiting x seconds until we start over the loop (while)
    await delay(30 * 1000);
  }
})();
