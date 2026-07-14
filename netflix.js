const { Telegraf } = require('telegraf');
const { chromium } = require('playwright');
const puppeteer = require('puppeteer-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(stealth());

const bot = new Telegraf("7932535685:AAGvA0gLJI_xXn-nlL5oahKi2xn9YvziQxU");

bot.start((ctx) => ctx.reply("أهلاً بك، أرسل الإيميل الآن:"));

bot.on('text', async (ctx) => {
    const email = ctx.message.text;
    const statusMsg = await ctx.reply("⏳ جاري العمل...");

    try {
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();
        
        await page.goto('https://www.netflix.com/iq-en/login', { waitUntil: 'domcontentloaded' });

        const emailInput = page.locator('input[name="userLoginId"]');
        await emailInput.fill(email);
        await page.waitForTimeout(3000);
        await page.click('button[type="submit"]');
        
        await page.waitForTimeout(5000);
        await page.screenshot({ path: 'final.png' });
        
        await ctx.replyWithPhoto({ source: fs.createReadStream('final.png') });
        await browser.close();
    } catch (err) {
        ctx.reply("❌ حدث خطأ: " + err.message);
    }
});

bot.launch();
