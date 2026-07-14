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
        browser = await chromium.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
        });
        
        const context = await browser.newContext();
        const page = await context.newPage();
        
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });

        await page.goto('https://www.netflix.com/iq-en/login', { waitUntil: 'networkidle' });
        try { await page.click('button:has-text("Accept")', { timeout: 3000 }); } catch (e) {}

        let success = false;
        // سنبدأ الانتظار من 3 ثواني ونزيد في كل محاولة
        let waitTime = 3000; 

        for (let i = 1; i <= 8; i++) {
            const emailInput = page.locator('input[name="userLoginId"]');
            await emailInput.fill(email);
            await page.click('button[type="submit"]');
            
            // انتظار ديناميكي يتزايد مع كل محاولة
            await page.waitForTimeout(waitTime); 
            
            // التقاط صورة بعد كل محاولة
            await page.screenshot({ path: `attempt_${i}.png` });
            await ctx.replyWithPhoto({ source: fs.createReadStream(`attempt_${i}.png`) }, { caption: `المحاولة ${i} (انتظار ${waitTime/1000} ثانية)` });
            
            // فحص هل ظهر الخطأ؟
            const errorElement = await page.locator('text="Something went wrong"').count();
            if (errorElement === 0) {
                success = true;
                await ctx.reply("✅ تم تجاوز الخطأ بنجاح!");
                break; 
            }
            
            // زيادة وقت الانتظار للمحاولة القادمة
            waitTime += 1000; 
        }

        if (!success) await ctx.reply("❌ انتهت المحاولات وما زال الخطأ يظهر.");
        await browser.close();
    } catch (err) {
        if (browser) await browser.close();
        ctx.reply("❌ حدث خطأ: " + err.message);
    }
});

bot.launch();
