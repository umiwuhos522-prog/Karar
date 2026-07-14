const { Telegraf } = require('telegraf');
const { chromium } = require('playwright');
const fs = require('fs');

const TOKEN = "7932535685:AAGvA0gLJI_xXn-nlL5oahKi2xn9YvziQxU";
const bot = new Telegraf(TOKEN);

const cookies = [
    { "domain": ".netflix.com", "expirationDate": 1791437690.300262, "hostOnly": false, "httpOnly": false, "name": "netflix-sans-normal-3-loaded", "path": "/", "sameSite": "Lax", "secure": false, "value": "true" },
    { "domain": ".netflix.com", "expirationDate": 1799205781.715754, "hostOnly": false, "httpOnly": false, "name": "SecureNetflixId", "path": "/", "sameSite": "Strict", "secure": true, "value": "v%3D3%26mac%3DAQEAEQABABQ6aF0HZ8DsqIo_PhF7ZqIn4Pnkr9eRfa8.%26dt%3D1783653781333" },
    { "domain": ".netflix.com", "expirationDate": 1783740185.228777, "hostOnly": false, "httpOnly": true, "name": "gsid", "path": "/", "sameSite": "Lax", "secure": true, "value": "e1335f92-02b6-43d9-a5dd-c979841186f3" },
    { "domain": ".netflix.com", "expirationDate": 1799205781.71589, "hostOnly": false, "httpOnly": false, "name": "NetflixId", "path": "/", "sameSite": "Lax", "secure": true, "value": "v%3D3%26ct%3DBgjHlOvcAxK7AQ6aWc332xABBe3_4TFi_GhYz6bu_SppiID9W173968rwXGgBZ5FOguy1o_nypEEzJFpJgmH0c87meJqBoXmkDG-3fRhPBkFJTw4N7FdSlN0L-D1Ihh-QS3KpejkBqY-jawZSvsTk7_j4UywDGYUdSSEksmaOJUWffx0dkqHTtce0mtk26U5ed1HqmdrMIXbF4_wTrJay86xSzumhWvu6NCztzpwtR73CSf9ei3-8Zhv4lR_akcGOLIpWaUYBiIOCgzRZAUwFliOAy-sUmU." },
    { "domain": ".netflix.com", "expirationDate": 1783672490.302061, "hostOnly": false, "httpOnly": false, "name": "flwssn", "path": "/", "sameSite": "Lax", "secure": false, "value": "0c34d834-9769-4f10-8fbe-8ec245d9746f" },
    { "domain": ".netflix.com", "expirationDate": 1791437690.301787, "hostOnly": false, "httpOnly": false, "name": "netflix-sans-bold-3-loaded", "path": "/", "sameSite": "Lax", "secure": false, "value": "true" },
    { "domain": ".netflix.com", "expirationDate": 1799122686.025479, "hostOnly": false, "httpOnly": false, "name": "nfvdid", "path": "/", "sameSite": "Lax", "secure": false, "value": "BQFmAAEBEE9JRlMuhcd1vZeyOZDGNsBgwt3MrI_af3LayzVVer6glzJvVpf97z33DXpKHBq9u0DnX0WJv5EuD1xSVUtIk9HEqcup0dtQ_aPOeD1ClWFBbYusKTD2yuO_aWV8_hyzEbgC_UGa_bLVoE2bGHdkptD2" }
];

async function takeScreenshot(page, ctx, caption) {
    const path = `step_${Date.now()}.png`;
    await page.screenshot({ path });
    await ctx.replyWithPhoto({ source: fs.createReadStream(path) }, { caption });
    fs.unlinkSync(path);
}

async function runBrowser(ctx, email) {
    let browser;
    try {
        browser = await chromium.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'] 
        });
        
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 720 }
        });
        
        await context.addCookies(cookies);
        const page = await context.newPage();

        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });

        await page.goto('https://www.netflix.com/iq-en/login', { waitUntil: 'networkidle' });
        
        // مسح أي نص مسبقاً باستخدام أمر برمجي مباشر
        await page.evaluate(() => {
            const input = document.querySelector('input[name="userLoginId"]');
            if (input) input.value = '';
        });

        const emailInput = page.locator('input[name="userLoginId"]');
        await emailInput.click();
        await emailInput.fill(email); 
        
        await takeScreenshot(page, ctx, "تم إدخال الإيميل الجديد ومسح التلقائي.");

        // البحث عن الزر بالانجليزي وتغيير المحاولة إلى الضغط المباشر
        const continueBtn = page.locator('button:has-text("Continue")');
        await continueBtn.click({ force: true });
        
        await page.waitForTimeout(5000);
        await takeScreenshot(page, ctx, "النتيجة النهائية بعد الضغط على Continue.");

        await browser.close();
    } catch (err) {
        if (browser) await browser.close();
        await ctx.reply("❌ حدث خطأ: " + err.message);
    }
}

bot.command('start', (ctx) => ctx.reply("أهلاً بك! أرسل الإيميل الآن."));
bot.on('text', (ctx) => {
    if (ctx.message.text.startsWith('/')) return;
    ctx.reply("⏳ جاري التنفيذ بدون بيانات تلقائية...");
    runBrowser(ctx, ctx.message.text);
});

bot.launch();
