const { Telegraf, session } = require('telegraf');
const { chromium } = require('playwright');

const TOKEN = "7932535685:AAGvA0gLJI_xXn-nlL5oahKi2xn9YvziQxU";
// تأكد من تحديث الكوكيز بانتظام إذا توقفت عن العمل
const COOKIES = [
    { "domain": ".netflix.com", "name": "SecureNetflixId", "path": "/", "value": "v%3D3%26mac%3DAQEAEQABABQ6aF0HZ8DsqIo_PhF7ZqIn4Pnkr9eRfa8.%26dt%3D1783653781333" },
    { "domain": ".netflix.com", "name": "NetflixId", "path": "/", "value": "v%3D3%26ct%3DBgjHlOvcAxK7AQ6aWc332xABBe3_4TFi_GhYz6bu_SppiID9W173968rwXGgBZ5FOguy1o_nypEEzJFpJgmH0c87meJqBoXmkDG-3fRhPBkFJTw4N7FdSlN0L-D1Ihh-QS3KpejkBqY-jawZSvsTk7_j4UywDGYUdSSEksmaOJUWffx0dkqHTtce0mtk26U5ed1HqmdrMIXbF4_wTrJay86xSzumhWvu6NCztzpwtR73CSf9ei3-8Zhv4lR_akcGOLIpWaUYBiIOCgzRZAUwFliOAy-sUmU." }
];

const bot = new Telegraf(TOKEN);
bot.use(session());

async function runBrowser(email) {
    let browser;
    try {
        browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const context = await browser.newContext();
        await context.addCookies(COOKIES);
        
        const page = await context.newPage();
        
        // 1. الانتقال لصفحة التسجيل
        await page.goto('https://www.netflix.com/signup/registration', { 
            waitUntil: 'networkidle', 
            timeout: 60000 
        });

        // 2. إدخال الإيميل
        await page.fill('input[name="email"]', email);
        await page.click('button[type="submit"]');

        // 3. الانتظار حتى تكتمل عملية المعالجة أو التوجيه
        // سننتظر تحميل الصفحة التالية للتأكد من أن الطلب تم
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(7000); // إضافية لضمان استقرار السيرفر

        // 4. الحصول على الرابط النهائي لمعرفة أين وصل البوت
        const finalUrl = page.url();
        
        await browser.close();
        
        return `✅ تمت العملية بنجاح.\n\n🔗 الرابط النهائي الذي وصل إليه المتصفح:\n${finalUrl}\n\nيرجى التحقق من الإيميل الآن.`;
        
    } catch (err) {
        if (browser) await browser.close();
        return "❌ فشل في إتمام العملية: " + err.message;
    }
}

bot.start((ctx) => ctx.reply("البوت يعمل. أرسل الإيميل للبدء:"));

bot.on('text', async (ctx) => {
    const email = ctx.message.text;
    ctx.reply("🔄 جاري المعالجة عبر المتصفح، يرجى الانتظار...");
    const result = await runBrowser(email);
    ctx.reply(result);
});

bot.launch();
