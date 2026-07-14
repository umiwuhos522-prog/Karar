const { Telegraf } = require('telegraf');
const { Camoufox } = require('camoufox'); // إضافة مكتبة التمويه
const fs = require('fs');

const TOKEN = "7932535685:AAGvA0gLJI_xXn-nlL5oahKi2xn9YvziQxU";
const bot = new Telegraf(TOKEN);

// الكوكيز
const rawCookies = [
    { "domain": ".netflix.com", "name": "netflix-sans-normal-3-loaded", "value": "true", "path": "/", "sameSite": "Lax" },
    { "domain": ".netflix.com", "name": "SecureNetflixId", "value": "v%3D3%26mac%3DAQEAEQABABQ6aF0HZ8DsqIo_PhF7ZqIn4Pnkr9eRfa8.%26dt%3D1783653781333", "path": "/", "sameSite": "Strict", "secure": true },
    { "domain": ".netflix.com", "name": "gsid", "value": "e1335f92-02b6-43d9-a5dd-c979841186f3", "path": "/", "sameSite": "Lax", "secure": true },
    { "domain": ".netflix.com", "name": "NetflixId", "value": "v%3D3%26ct%3DBgjHlOvcAxK7AQ6aWc332xABBe3_4TFi_GhYz6bu_SppiID9W173968rwXGgBZ5FOguy1o_nypEEzJFpJgmH0c87meJqBoXmkDG-3fRhPBkFJTw4N7FdSlN0L-D1Ihh-QS3KpejkBqY-jawZSvsTk7_j4UywDGYUdSSEksmaOJUWffx0dkqHTtce0mtk26U5ed1HqmdrMIXbF4_wTrJay86xSzumhWvu6NCztzpwtR73CSf9ei3-8Zhv4lR_akcGOLIpWaUYBiIOCgzRZAUwFliOAy-sUmU.", "path": "/", "sameSite": "Lax", "secure": true },
    { "domain": ".netflix.com", "name": "flwssn", "value": "0c34d834-9769-4f10-8fbe-8ec245d9746f", "path": "/", "sameSite": "Lax" },
    { "domain": ".netflix.com", "name": "netflix-sans-bold-3-loaded", "value": "true", "path": "/", "sameSite": "Lax" },
    { "domain": ".netflix.com", "name": "nfvdid", "value": "BQFmAAEBEE9JRlMuhcd1vZeyOZDGNsBgwt3MrI_af3LayzVVer6glzJvVpf97z33DXpKHBq9u0DnX0WJv5EuD1xSVUtIk9HEqcup0dtQ_aPOeD1ClWFBbYusKTD2yuO_aWV8_hyzEbgC_UGa_bLVoE2bGHdkptD2", "path": "/", "sameSite": "Lax" }
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
        // استخدام Camoufox للتمويه
        browser = await Camoufox.launch({ headless: true });
        const context = await browser.newContext();
        await context.addCookies(rawCookies);
        const page = await context.newPage();

        await page.goto('https://www.netflix.com/iq-en/login?serverState=Bgjru%2BvcAxK1AapIBJLLmHm4oDPemeREfZrfJF0tyEhjXYgZwR79d8QKCaThZSSqCguL%2F6IyygJYqySE0i0EpUgSL3IXD6Z71UE1Rj9mXIvDXuU6ObrvB26ROPtLjo3KZC%2F%2BV3d88OWaROCwJPsS1eAkBHcSDvAozz6oA8iWO13S9mUrwBMnK72UPioQlZ8YaoezC9aD1178Pjfpggly0qTyNZUczFrPHQTAp%2FOCNiIhZE6KT4tSJEDBUNW%2FRhwYBiIOCgygNHAeqqHxVQlRJKw%3D', { waitUntil: 'networkidle' });
        await takeScreenshot(page, ctx, "الخطوة 1: تم الدخول للرابط.");

        // كتابة الإيميل
        const emailInput = page.locator('input[name="userLoginId"]');
        await emailInput.click();
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
        await emailInput.type(email, { delay: 150 });
        await takeScreenshot(page, ctx, "الخطوة 2: تم إدخال الإيميل.");

        // الضغط على المتابعة (محدد شامل للزر الأحمر)
        const continueBtn = page.locator('button[type="submit"]');
        await page.waitForTimeout(2000); // تأخير لضمان استقرار الصفحة
        await continueBtn.click({ force: true });
        
        await page.waitForTimeout(5000);
        await takeScreenshot(page, ctx, "الخطوة 3: تم الضغط على Continue.");

        await browser.close();
    } catch (err) {
        if (browser) await browser.close();
        await ctx.reply("❌ حدث خطأ: " + err.message);
    }
}

bot.command('start', (ctx) => {
    ctx.reply("أهلاً بك! أرسل الإيميل الآن.");
});

bot.on('text', (ctx) => {
    if (ctx.message.text.startsWith('/')) return;
    ctx.reply("⏳ جاري المعالجة بوضع التمويه...");
    runBrowser(ctx, ctx.message.text);
});

bot.launch();
