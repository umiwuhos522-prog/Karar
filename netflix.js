const { Telegraf } = require('telegraf');
const { chromium } = require('playwright');
const puppeteer = require('puppeteer-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(stealth());

const bot = new Telegraf("7932535685:AAGvA0gLJI_xXn-nlL5oahKi2xn9YvziQxU");

bot.start((ctx) => ctx.reply("أهلاً بك، أرسل الإيميل للبدء:"));

bot.on('text', async (ctx) => {
    const email = ctx.message.text;
    
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();
        
        await page.goto('https://www.netflix.com/iq-en/login', { waitUntil: 'networkidle' });
        try { await page.click('button:has-text("Accept")', { timeout: 3000 }); } catch (e) {}

        let success = false;
        let waitTime = 4000; 

        for (let i = 1; i <= 8; i++) {
            const emailInput = page.locator('input[name="userLoginId"]');
            await emailInput.fill(email);
            await page.click('button[type="submit"]');
            await page.waitForTimeout(waitTime); 
            
            // المنطق الجديد: هل ظهر حقل كلمة المرور؟ (هذا يعني نجاح الانتقال)
            const passwordField = await page.locator('input[name="password"]').count();
            // هل ما زالت رسالة الخطأ موجودة؟
            const errorVisible = await page.locator('text="Something went wrong"').isVisible();
            
            if (passwordField > 0 && !errorVisible) {
                success = true;
                await ctx.reply("✅ تم الانتقال لصفحة كلمة المرور بنجاح!");
                break; 
            } else {
                await page.screenshot({ path: `attempt_${i}.png` });
                await ctx.replyWithPhoto({ source: fs.createReadStream(`attempt_${i}.png`) }, { caption: `المحاولة ${i}: لا يزال الخطأ موجوداً.` });
            }
            waitTime += 1000; 
        }

        if (!success) await ctx.reply("❌ لم يتم تجاوز الخطأ بعد 8 محاولات.");
        await browser.close();
    } catch (err) {
        if (browser) await browser.close();
        ctx.reply("❌ حدث خطأ: " + err.message);
    }
});

bot.launch();
