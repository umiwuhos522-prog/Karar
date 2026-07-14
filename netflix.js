const { Telegraf } = require('telegraf');
const { chromium } = require('playwright');
const puppeteer = require('puppeteer-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

// تفعيل إضافة التخفي الأساسية
puppeteer.use(stealth());

const bot = new Telegraf("7932535685:AAGvA0gLJI_xXn-nlL5oahKi2xn9YvziQxU");

bot.start((ctx) => ctx.reply("أهلاً بك، أرسل الإيميل الآن للبدء:"));

bot.on('text', async (ctx) => {
    const email = ctx.message.text;
    const statusMsg = await ctx.reply("⏳ جاري المعالجة بوضع التخفي...");

    let browser;
    try {
        // تشغيل المتصفح بإعدادات تخفي احترافية تناسب Railway
        browser = await chromium.launch({
            headless: true, 
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled', // يمنع كشف الأتمتة
                '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
            ]
        });

        const context = await browser.newContext({
            viewport: { width: 1280, height: 800 }
        });

        const page = await context.newPage();
        
        // مسح بصمة الأتمتة برمجياً
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });

        await page.goto('https://www.netflix.com/iq-en/login', { waitUntil: 'domcontentloaded' });

        // الكتابة بأسلوب إنساني
        const emailInput = page.locator('input[name="userLoginId"]');
        await emailInput.fill(email);
        
        await page.waitForTimeout(3000); // انتظار 3 ثواني
        await page.click('button[type="submit"]');
        
        await page.waitForTimeout(6000); // انتظار ظهور النتيجة
        await page.screenshot({ path: 'final.png' });
        
        await ctx.replyWithPhoto({ source: fs.createReadStream('final.png') });
        await browser.close();
        await ctx.deleteMessage(statusMsg.message_id);
    } catch (err) {
        if (browser) await browser.close();
        ctx.reply("❌ حدث خطأ تقني: " + err.message);
    }
});

bot.launch();
