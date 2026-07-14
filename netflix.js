const { Telegraf } = require('telegraf');
const { chromium } = require('playwright');
const fs = require('fs');

const TOKEN = "7932535685:AAGvA0gLJI_xXn-nlL5oahKi2xn9YvziQxU";
const bot = new Telegraf(TOKEN);

// دالة لالتقاط صورة وإرسالها للتليجرام
async function capture(page, filename, caption, ctx) {
    await page.screenshot({ path: filename });
    await ctx.replyWithPhoto({ source: fs.createReadStream(filename) }, { caption: caption });
}

async function runBrowser(ctx, email) {
    let browser;
    try {
        // إعداد المتصفح بمحاكاة متصفح حقيقي
        browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const context = await browser.newContext({ 
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' 
        });
        const page = await context.newPage();

        // 1. الدخول للموقع
        await page.goto('https://www.netflix.com/iq-en/', { waitUntil: 'domcontentloaded' });
        await capture(page, 'step1.png', "الخطوة 1: تم فتح الصفحة الرئيسية", ctx);

        // 2. البحث عن خانة الإيميل
        const emailInput = 'input[type="email"], input[name="email"], input[placeholder*="Email"]';
        await page.waitForSelector(emailInput);
        await page.fill(emailInput, email);
        await capture(page, 'step2.png', "الخطوة 2: تم وضع الإيميل", ctx);

        // 3. الانتظار 3 ثوانٍ قبل الضغط (محاكاة بشرية لتجنب الحظر)
        await ctx.reply("⏳ أنتظر 3 ثوانٍ لتجاوز الحظر...");
        await page.waitForTimeout(3000); 

        // 4. الضغط على زر المتابعة
        const submitButton = 'button[type="submit"], button[data-uia="cta-registration"], button:has-text("Get Started"), button:has-text("Next")';
        await page.click(submitButton);
        
        // انتظار النتيجة
        await page.waitForTimeout(3000);
        await capture(page, 'step3.png', "الخطوة 3: النتيجة بعد الضغط", ctx);

        await browser.close();
        await ctx.reply("✅ تمت العملية، تفقد الصورة أعلاه لرؤية النتيجة.");

    } catch (err) {
        if (browser) await browser.close();
        await ctx.reply("❌ حدث خطأ: " + err.message);
    }
}

bot.on('text', async (ctx) => {
    const email = ctx.message.text;
    if (email.startsWith('/')) return;
    await ctx.reply("🔄 جاري التتبع والتصوير لكل خطوة...");
    await runBrowser(ctx, email);
});

bot.launch();
console.log("البوت يعمل الآن...");
