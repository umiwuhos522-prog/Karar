const { Telegraf } = require('telegraf');
const { chromium } = require('playwright');
const fs = require('fs');

const TOKEN = "7932535685:AAGvA0gLJI_xXn-nlL5oahKi2xn9YvziQxU";
const bot = new Telegraf(TOKEN);

async function runBrowser(ctx, email) {
    let browser;
    try {
        browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
        
        const page = await context.newPage();
        await page.goto('https://www.netflix.com/signup/registration', { waitUntil: 'domcontentloaded' });

        // التقاط صورة فورية
        await page.screenshot({ path: 'debug.png' });
        await ctx.replyWithPhoto({ source: fs.createReadStream('debug.png') }, { caption: "هذه الصورة توضح ما يراه المتصفح الآن:" });

        // محاولة الإدخال
        await page.fill('input[name="email"]', email);
        await page.click('button[type="submit"]');
        
        await browser.close();
        await ctx.reply("✅ تم الإدخال بنجاح.");
    } catch (err) {
        if (browser) await browser.close();
        await ctx.reply("❌ حدث خطأ، الصورة توضح السبب:");
        await ctx.replyWithPhoto({ source: fs.createReadStream('debug.png') });
        await ctx.reply("تفاصيل الخطأ: " + err.message);
    }
}

bot.on('text', async (ctx) => {
    const email = ctx.message.text;
    if (email === '/start') return;
    await ctx.reply("🔄 جاري المعالجة والتقاط صورة...");
    await runBrowser(ctx, email);
});

bot.launch();
