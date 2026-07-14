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

        // 1. الضغط على زر Next إذا ظهر في صفحة اختيار الخطة
        const nextButton = 'button:has-text("Next")';
        if (await page.isVisible(nextButton)) {
            await page.click(nextButton);
            await page.waitForTimeout(3000); // انتظار التحميل بعد الضغط
        }

        // 2. إدخال الإيميل بعد الضغط على Next
        const emailSelector = 'input[name="email"]';
        await page.waitForSelector(emailSelector, { timeout: 15000 });
        await page.fill(emailSelector, email);
        
        // 3. الضغط على زر المتابعة (سواء كان مكتوباً عليه Continue أو متابعة)
        await page.click('button[type="submit"]');
        
        await page.screenshot({ path: 'final.png' });
        await ctx.replyWithPhoto({ source: fs.createReadStream('final.png') }, { caption: "تمت العملية! هذه صورة الصفحة الحالية:" });
        
        await browser.close();
    } catch (err) {
        if (browser) await browser.close();
        await ctx.reply("❌ حدث خطأ: " + err.message);
    }
}

bot.on('text', async (ctx) => {
    const email = ctx.message.text;
    if (email.startsWith('/')) return;
    await ctx.reply("🔄 جاري الضغط على Next وإدخال الإيميل...");
    await runBrowser(ctx, email);
});

bot.launch();
