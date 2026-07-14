const { Telegraf } = require('telegraf');
const { chromium } = require('playwright');
const fs = require('fs');

const TOKEN = "7932535685:AAGvA0gLJI_xXn-nlL5oahKi2xn9YvziQxU";
const bot = new Telegraf(TOKEN);

async function takeScreenshot(page, ctx, caption) {
    const path = `step_${Date.now()}.png`;
    await page.screenshot({ path });
    await ctx.replyWithPhoto({ source: fs.createReadStream(path) }, { caption });
    fs.unlinkSync(path);
}

async function runBrowser(ctx, email) {
    let browser;
    try {
        // تشغيل متصفح ببيانات نظيفة تماماً (بدون كوكيز قديمة)
        browser = await chromium.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        });
        
        // إنشاء سياق جديد تماماً (Empty Context) لضمان عدم وجود بيانات مسجلة
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
        });
        
        const page = await context.newPage();

        await page.goto('https://www.netflix.com/iq-en/login', { waitUntil: 'networkidle' });
        
        // إغلاق رسالة الكوكيز فوراً
        try {
            await page.click('button:has-text("Reject")', { timeout: 3000 });
        } catch (e) {}

        // إفراغ الحقل والتأكد من عدم وجود أي نص افتراضي
        const emailInput = page.locator('input[name="userLoginId"]');
        await emailInput.click();
        
        // مسح الحقل باستخدام الكيبورد بشكل متكرر لضمان النظافة
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
        
        // إدخال الإيميل الجديد كتابةً (كحروف فردية لمحاكاة الإنسان)
        await emailInput.type(email, { delay: 200 }); 
        
        await takeScreenshot(page, ctx, "تم إدخال الإيميل يدوياً.");

        // الضغط على متابعة
        const continueBtn = page.locator('button[type="submit"]');
        await continueBtn.click({ force: true });
        
        await page.waitForTimeout(4000);
        await takeScreenshot(page, ctx, "النتيجة النهائية.");

        await browser.close();
    } catch (err) {
        if (browser) await browser.close();
        await ctx.reply("❌ حدث خطأ: " + err.message);
    }
}

bot.command('start', (ctx) => ctx.reply("أرسل الإيميل ليقوم البوت بكتابته يدوياً."));

bot.on('text', (ctx) => {
    if (ctx.message.text.startsWith('/')) return;
    ctx.reply("⏳ جاري الكتابة اليدوية...");
    runBrowser(ctx, ctx.message.text);
});

bot.launch();
