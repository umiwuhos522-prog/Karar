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
        
        // الانتقال للرابط المطلوب الذي أرسلته
        await page.goto('https://www.netflix.com/iq-en/', { waitUntil: 'networkidle' });
        
        // البحث عن خانة الإيميل في الصفحة الرئيسية
        // Netflix تستخدم معرفات مختلفة للـ input في الصفحة الرئيسية
        const emailSelector = 'input[type="email"], input[name="email"]';
        await page.waitForSelector(emailSelector, { timeout: 15000 });
        await page.fill(emailSelector, email);
        
        // الضغط على زر Get Started
        await page.click('button[data-uia="cta-registration"]');
        
        await page.screenshot({ path: 'final.png' });
        await ctx.replyWithPhoto({ source: fs.createReadStream('final.png') }, { caption: "تم إدخال الإيميل والضغط على Get Started بنجاح." });
        
        await browser.close();
    } catch (err) {
        if (browser) await browser.close();
        await ctx.reply("❌ حدث خطأ: " + err.message);
    }
}

bot.on('text', async (ctx) => {
    const email = ctx.message.text;
    if (email.startsWith('/')) return;
    await ctx.reply("🔄 جاري الدخول للرابط المطلوب...");
    await runBrowser(ctx, email);
});

bot.launch();
