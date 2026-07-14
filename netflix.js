const { Telegraf } = require('telegraf');
const { chromium } = require('playwright');
const fs = require('fs');

const TOKEN = "7932535685:AAGvA0gLJI_xXn-nlL5oahKi2xn9YvziQxU";
const bot = new Telegraf(TOKEN);

// بيانات البروكسي الخاصة بك
const proxy = {
  server: 'http://145.223.51.199:6732',
  username: 'vyfyaxdf',
  password: 'u4iuxhiqu2fe'
};

async function capture(page, filename, caption, ctx) {
    await page.screenshot({ path: filename });
    await ctx.replyWithPhoto({ source: fs.createReadStream(filename) }, { caption: caption });
}

async function runBrowser(ctx, email) {
    let browser;
    try {
        // تشغيل المتصفح مع البروكسي
        browser = await chromium.launch({ args: ['--no-sandbox'] });
        const context = await browser.newContext({
            proxy: {
                server: proxy.server,
                username: proxy.username,
                password: proxy.password
            },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        });
        
        const page = await context.newPage();

        await page.goto('https://www.netflix.com/iq-en/', { waitUntil: 'domcontentloaded' });
        await capture(page, 'step1.png', "تم الاتصال عبر البروكسي وفتح الصفحة", ctx);

        const emailInput = 'input[type="email"], input[name="email"]';
        await page.waitForSelector(emailInput);
        await page.fill(emailInput, email);
        
        // محاكاة بشرية قبل الضغط
        await page.waitForTimeout(3000); 
        await page.click('button[type="submit"], button[data-uia="cta-registration"]');
        
        await page.waitForTimeout(4000);
        await capture(page, 'step2.png', "النتيجة بعد استخدام البروكسي:", ctx);

        await browser.close();
    } catch (err) {
        if (browser) await browser.close();
        await ctx.reply("❌ حدث خطأ مع البروكسي: " + err.message);
    }
}

bot.on('text', async (ctx) => {
    const email = ctx.message.text;
    if (email.startsWith('/')) return;
    await ctx.reply("🔄 جاري المحاولة باستخدام البروكسي الجديد...");
    await runBrowser(ctx, email);
});

bot.launch();
