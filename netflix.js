const { Telegraf } = require('telegraf');
// استخدام مكتبة التخفي بدلاً من المتصفح العادي
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

// تفعيل إضافة التخفي لمنع الكشف
chromium.use(stealth());

const bot = new Telegraf("7932535685:AAGvA0gLJI_xXn-nlL5oahKi2xn9YvziQxU");

async function runBrowser(ctx, email) {
    let browser;
    try {
        // تشغيل المتصفح بوضع التخفي التلقائي
        browser = await chromium.launch({
            headless: true, // ضروري للعمل على Railway
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        });

        const page = await context.newPage();
        
        await page.goto('https://www.netflix.com/iq-en/login', { waitUntil: 'networkidle' });

        // إدخال الإيميل بأسلوب بشري
        const emailInput = page.locator('input[name="userLoginId"]');
        await emailInput.click();
        await page.keyboard.type(email, { delay: 300 }); 
        
        // انتظار 3 ثواني كما طلبت
        await page.waitForTimeout(3000); 
        
        // الضغط على استمرار
        await page.click('button[type="submit"]');
        
        // انتظار النتيجة
        await page.waitForTimeout(5000);
        
        // التقاط الصورة
        await page.screenshot({ path: 'final.png' });
        await ctx.replyWithPhoto({ source: fs.createReadStream('final.png') });

        await browser.close();
    } catch (err) {
        if (browser) await browser.close();
        ctx.reply("❌ حدث خطأ: " + err.message);
    }
}

// ربط البوت لاستقبال الإيميل
bot.command('start', (ctx) => ctx.reply("يرجى إرسال الإيميل للبدء:"));
bot.on('text', (ctx) => runBrowser(ctx, ctx.message.text));

bot.launch();
