const { Telegraf } = require('telegraf');
const { chromium } = require('playwright');
const fs = require('fs');

const TOKEN = "7932535685:AAGvA0gLJI_xXn-nlL5oahKi2xn9YvziQxU";
const bot = new Telegraf(TOKEN);

async function runBrowser(ctx, email) {
    let browser;
    try {
        browser = await chromium.launch({ args: ['--no-sandbox'] });
        const page = await browser.newPage();

        await page.setViewportSize({ width: 1280, height: 720 }); // حجم ثابت لتحديد الإحداثيات
        await page.goto('https://www.netflix.com/iq-en/', { waitUntil: 'domcontentloaded' });

        // إيجاد الإحداثيات
        const emailBox = await page.$('input[type="email"]');
        const box = await emailBox.boundingBox();
        
        const button = await page.$('button[data-uia="cta-registration"]');
        const btnBox = await button.boundingBox();

        // إرسال الإحداثيات لك
        await ctx.reply(`📍 الإحداثيات المكتشفة:\nالإيميل: X=${box.x}, Y=${box.y}\nالزر: X=${btnBox.x}, Y=${btnBox.y}`);
        
        await page.screenshot({ path: 'debug.png' });
        await ctx.replyWithPhoto({ source: fs.createReadStream('debug.png') });

        // الضغط باستخدام الإحداثيات (محاكاة لمس)
        await page.mouse.click(box.x + 10, box.y + 10);
        await page.keyboard.type(email);
        
        await page.waitForTimeout(2000);
        await page.mouse.click(btnBox.x + 10, btnBox.y + 10);

        await page.waitForTimeout(3000);
        await page.screenshot({ path: 'final.png' });
        await ctx.replyWithPhoto({ source: fs.createReadStream('final.png') });

        await browser.close();
    } catch (err) {
        if (browser) await browser.close();
        await ctx.reply("❌ خطأ: " + err.message);
    }
}

bot.on('text', async (ctx) => {
    const email = ctx.message.text;
    if (email.startsWith('/')) return;
    await runBrowser(ctx, email);
});

bot.launch();
