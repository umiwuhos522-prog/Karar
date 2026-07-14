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
    const statusMsg = await ctx.reply("⏳ جاري المعالجة...");

    let browser;
    try {
        browser = await chromium.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
        });
        
        const context = await browser.newContext();
        const page = await context.newPage();
        
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });

        await page.goto('https://www.netflix.com/iq-en/login', { waitUntil: 'domcontentloaded' });

        // 1. الضغط على Accept إذا ظهرت نافذة الكوكيز
        try {
            await page.waitForSelector('button:has-text("Accept")', { timeout: 5000 });
            await page.click('button:has-text("Accept")');
        } catch (e) {
            // تجاهل إذا لم تظهر النافذة
        }

        // 2. إدخال الإيميل
        const emailInput = page.locator('input[name="userLoginId"]');
        await emailInput.fill(email);
        
        // 3. الضغط على استمرار (Continue)
        await page.click('button[type="submit"]');
        
        // 4. انتظار النتيجة والتقاط صورة
        await page.waitForTimeout(5000);
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
