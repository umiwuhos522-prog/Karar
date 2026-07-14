const { Telegraf } = require('telegraf');
const { chromium } = require('playwright');
const puppeteer = require('puppeteer-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(stealth());

const bot = new Telegraf("7932535685:AAGvA0gLJI_xXn-nlL5oahKi2xn9YvziQxU");

bot.start((ctx) => ctx.reply("أهلاً بك، أرسل الإيميل الآن للبدء:"));

bot.on('text', async (ctx) => {
    const email = ctx.message.text;
    const statusMsg = await ctx.reply("⏳ جاري المعالجة بوضع التخفي الكامل...");

    let browser;
    try {
        browser = await chromium.launch({ 
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled', // التمويه الأساسي
                '--disable-features=IsolateOrigins,site-per-process',
                '--blink-settings=imagesEnabled=true'
            ]
        });
        
        // إعداد السياق ليبدو كمتصفح ويندوز حقيقي
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            locale: 'en-US',
            timezoneId: 'America/New_York',
            permissions: ['geolocation'],
            geolocation: { latitude: 40.7128, longitude: -74.0060 }
        });

        const page = await context.newPage();
        
        // مسح آثار الأتمتة من الـ JavaScript
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            window.navigator.chrome = { runtime: {} };
        });

        await page.goto('https://www.netflix.com/iq-en/login', { waitUntil: 'networkidle' });

        // إضافة تأخير بشري قبل التفاعل
        await page.waitForTimeout(2000);

        // الضغط على Accept للكوكيز
        try {
            await page.click('button:has-text("Accept")', { timeout: 3000 });
        } catch (e) {}

        // إدخال الإيميل مع تأخير بين الحروف
        const emailInput = page.locator('input[name="userLoginId"]');
        await emailInput.fill(email);
        
        // الانتظار قليلاً قبل الضغط للتمويه
        await page.waitForTimeout(2500); 
        
        // الضغط على Continue
        await page.click('button[type="submit"]');
        
        // انتظار أطول قليلاً بعد الضغط لتجاوز فحص الكابتشا
        await page.waitForTimeout(7000);
        
        await page.screenshot({ path: 'final.png' });
        await ctx.replyWithPhoto({ source: fs.createReadStream('final.png') });
        
        await browser.close();
        await ctx.deleteMessage(statusMsg.message_id);
    } catch (err) {
        if (browser) await browser.close();
        ctx.reply("❌ حدث خطأ: " + err.message);
    }
});

bot.launch();
