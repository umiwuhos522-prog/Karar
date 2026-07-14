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
    const statusMsg = await ctx.reply("⏳ جاري المعالجة عبر البروكسي...");

    let browser;
    try {
        // إعداد البروكسي داخل الـ launch
        browser = await chromium.launch({ 
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled'
            ],
            proxy: {
                server: 'http://145.223.51.199:6732',
                username: 'vyfyaxdf',
                password: 'u4iuxhiqu2fe'
            }
        });
        
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
        });

        const page = await context.newPage();
        
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });

        await page.goto('https://www.netflix.com/iq-en/login', { waitUntil: 'networkidle' });

        await page.waitForTimeout(2000);

        // الضغط على Accept
        try {
            await page.click('button:has-text("Accept")', { timeout: 3000 });
        } catch (e) {}

        // إدخال الإيميل
        const emailInput = page.locator('input[name="userLoginId"]');
        await emailInput.fill(email);
        
        await page.waitForTimeout(2000); 
        await page.click('button[type="submit"]');
        
        await page.waitForTimeout(7000);
        
        await page.screenshot({ path: 'final.png' });
        await ctx.replyWithPhoto({ source: fs.createReadStream('final.png') });
        
        await browser.close();
        await ctx.deleteMessage(statusMsg.message_id);
    } catch (err) {
        if (browser) await browser.close();
        ctx.reply("❌ خطأ بالبروكسي أو الاتصال: " + err.message);
    }
});

bot.launch();
