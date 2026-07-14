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
    const statusMsg = await ctx.reply("⏳ جاري المحاولة (قد يستغرق الأمر عدة ثوانٍ)...");

    let browser;
    try {
        browser = await chromium.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
        });
        
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();

        await page.goto('https://www.netflix.com/iq-en/login', { waitUntil: 'networkidle' });

        // ضغط Accept إذا وجدت
        try { await page.click('button:has-text("Accept")', { timeout: 3000 }); } catch (e) {}

        let success = false;
        let attempts = 0;
        const maxAttempts = 10; // عدد محاولات التكرار

        while (!success && attempts < maxAttempts) {
            attempts++;
            const emailInput = page.locator('input[name="userLoginId"]');
            await emailInput.fill(email);
            await page.waitForTimeout(1000);
            await page.click('button[type="submit"]');
            
            await page.waitForTimeout(3000); // الانتظار لرؤية النتيجة

            // التحقق هل ظهر الخطأ؟
            const errorElement = await page.locator('text="Something went wrong"').count();
            
            if (errorElement === 0) {
                success = true; // لا يوجد خطأ
            } else {
                await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, `⏳ المحاولة ${attempts} فشلت، جاري إعادة المحاولة...`);
            }
        }

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
