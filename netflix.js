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
        
        // الخطوة 1: الدخول
        await page.goto('https://www.netflix.com/signup/registration', { waitUntil: 'networkidle' });
        await page.screenshot({ path: 'step1.png' });
        await ctx.replyWithPhoto({ source: fs.createReadStream('step1.png') }, { caption: "الخطوة 1: الصفحة الأولى" });

        // الخطوة 2: محاولة الضغط على Next
        const nextButton = 'button:has-text("Next")';
        if (await page.isVisible(nextButton)) {
            await page.click(nextButton);
            await page.waitForTimeout(3000);
            await page.screenshot({ path: 'step2.png' });
            await ctx.replyWithPhoto({ source: fs.createReadStream('step2.png') }, { caption: "الخطوة 2: بعد الضغط على Next" });
        }

        // الخطوة 3: إدخال الإيميل
        const emailSelector = 'input[name="email"]';
        await page.waitForSelector(emailSelector, { timeout: 15000 });
        await page.fill(emailSelector, email);
        await page.screenshot({ path: 'step3.png' });
        await ctx.replyWithPhoto({ source: fs.createReadStream('step3.png') }, { caption: "الخطوة 3: تم إدخال الإيميل" });
        
        await browser.close();
        await ctx.reply("✅ تمت العملية بنجاح.");

    } catch (err) {
        if (browser) await browser.close();
        // التقاط صورة أخيرة لمعرفة أين توقف بالضبط
        await page.screenshot({ path: 'error.png' });
        await ctx.replyWithPhoto({ source: fs.createReadStream('error.png') }, { caption: "❌ توقف البوت هنا:" });
        await ctx.reply("تفاصيل الخطأ: " + err.message);
    }
}

bot.on('text', async (ctx) => {
    const email = ctx.message.text;
    if (email.startsWith('/')) return;
    await ctx.reply("🔄 جاري التتبع خطوة بخطوة...");
    await runBrowser(ctx, email);
});

bot.launch();
