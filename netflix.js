const { Telegraf } = require('telegraf');
const bot = new Telegraf("7932535685:AAGvA0gLJI_xXn-nlL5oahKi2xn9YvziQxU");

bot.start((ctx) => ctx.reply('✅ البوت يعمل بنجاح!'));
bot.on('text', (ctx) => ctx.reply('وصلت رسالتك: ' + ctx.message.text));

bot.launch().then(() => console.log("البوت جاهز للاستجابة"));
