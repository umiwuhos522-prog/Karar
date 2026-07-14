const { Telegraf } = require('telegraf');
const { chromium } = require('playwright');
const fs = require('fs');

const TOKEN = "7932535685:AAGvA0gLJI_xXn-nlL5oahKi2xn9YvziQxU";
const bot = new Telegraf(TOKEN);

async function capture(page, filename, caption, ctx) {
    await page.screenshot({ path: filename });
    await ctx.replyWithPhoto({ source: fs.createReadStream(filename) }, { caption: caption });
}

async function runBrowser(ctx, email) {
    let browser;
    let attempts = 0;
    const maxAttempts = 3;

    try {
        browser = await chromium.launch({ args: ['--no-sandbox'] });
        const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' });
        const page = await context.newPage();

        while (attempts < maxAttempts) {
            attempts++;
            await page.goto('https://www.netflix.com/iq-en/', { waitUntil: 'domcontentloaded' });
            
            const emailInput = 'input[type="email"], input[name="email"]';
            await page.waitForSelector(emailInput);
            await page.fill(emailInput, email);
            await capture(page, 'step1.png', `الخطوة ${attempts}: تم وضع الإيميل`, ctx);

            // محاكاة بشرية: تحريك الماوس قبل الضغط
            await page.mouse.move(100, 100);
            await page.waitForTimeout(3000); 
            await page.mouse.click(500, 500); // ضغط في مكان عشوائي للمحاكاة

            const submitButton = 'button[type="submit"], button[data-uia="cta-registration"]';
            await page.click(submitButton);
            
            await page.waitForTimeout(4000); // انتظار النتيجة
            
            // التحقق من وجود رسالة خطأ
            const content = await page.content();
            if (content.includes("Something went wrong")) {
                await ctx.reply(`⚠️ محاولة ${attempts}: ظهر خطأ، سأعيد المحاولة...`);
                await page.waitForTimeout(5000); // انتظر قليلاً قبل الإعادة
            } else {
                await capture(page, 'final.png', "✅ تم تجاوز الصفحة بنجاح!", ctx);
                break; // نجحنا، نخرج من الحلقة
            }
        }

        await browser.close();
    } catch (err) {
        if (browser) await browser.close();
        await ctx.reply("❌ حدث خطأ تقني: " + err.message);
    }
}

bot.on('text', async (ctx) => {
    const email = ctx.message.text;
    if (email.startsWith('/')) return;
    await ctx.reply("🔄 جاري محاولة التسجيل (سأحاول حتى 3 مرات)...");
    await runBrowser(ctx, email);
});

bot.launch();
