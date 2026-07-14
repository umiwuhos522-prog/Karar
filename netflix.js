const { Telegraf } = require('telegraf');
const { chromium } = require('playwright');
const fs = require('fs');

const TOKEN = "7932535685:AAGvA0gLJI_xXn-nlL5oahKi2xn9YvziQxU";
const bot = new Telegraf(TOKEN);

// الكوكيز الخاصة بك
const cookies = [
    { "domain": ".netflix.com", "name": "netflix-sans-normal-3-loaded", "value": "true", "path": "/", "httpOnly": false, "secure": false },
    { "domain": ".netflix.com", "name": "SecureNetflixId", "value": "v%3D3%26mac%3DAQEAEQABABQ6aF0HZ8DsqIo_PhF7ZqIn4Pnkr9eRfa8.%26dt%3D1783653781333", "path": "/", "httpOnly": false, "secure": true },
    { "domain": ".netflix.com", "name": "gsid", "value": "e1335f92-02b6-43d9-a5dd-c979841186f3", "path": "/", "httpOnly": true, "secure": true },
    { "domain": ".netflix.com", "name": "NetflixId", "value": "v%3D3%26ct%3DBgjHlOvcAxK7AQ6aWc332xABBe3_4TFi_GhYz6bu_SppiID9W173968rwXGgBZ5FOguy1o_nypEEzJFpJgmH0c87meJqBoXmkDG-3fRhPBkFJTw4N7FdSlN0L-D1Ihh-QS3KpejkBqY-jawZSvsTk7_j4UywDGYUdSSEksmaOJUWffx0dkqHTtce0mtk26U5ed1HqmdrMIXbF4_wTrJay86xSzumhWvu6NCztzpwtR73CSf9ei3-8Zhv4lR_akcGOLIpWaUYBiIOCgzRZAUwFliOAy-sUmU.", "path": "/", "httpOnly": false, "secure": true },
    { "domain": ".netflix.com", "name": "flwssn", "value": "0c34d834-9769-4f10-8fbe-8ec245d9746f", "path": "/", "httpOnly": false, "secure": false },
    { "domain": ".netflix.com", "name": "netflix-sans-bold-3-loaded", "value": "true", "path": "/", "httpOnly": false, "secure": false },
    { "domain": ".netflix.com", "name": "nfvdid", "value": "BQFmAAEBEE9JRlMuhcd1vZeyOZDGNsBgwt3MrI_af3LayzVVer6glzJvVpf97z33DXpKHBq9u0DnX0WJv5EuD1xSVUtIk9HEqcup0dtQ_aPOeD1ClWFBbYusKTD2yuO_aWV8_hyzEbgC_UGa_bLVoE2bGHdkptD2", "path": "/", "httpOnly": false, "secure": false }
];

async function runBrowser(ctx, email) {
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
        });

        await context.addCookies(cookies);
        const page = await context.newPage();

        await page.goto('https://www.netflix.com/iq-en/', { waitUntil: 'networkidle' });
        await ctx.reply("⏳ تم الدخول، جاري البحث عن الحقول...");

        // استخدام الانتظار حتى يظهر العنصر بدون محاولة قراءة الإحداثيات
        const emailInput = 'input[type="email"][name="email"]';
        await page.waitForSelector(emailInput, { timeout: 20000 });
        await page.fill(emailInput, email);
        
        // تأخير بشري عشوائي
        await page.waitForTimeout(2000 + Math.random() * 2000);

        // الضغط المباشر على الزر باستخدام محدد قوي
        const submitBtn = 'button[data-uia="cta-registration"]';
        await page.click(submitBtn);

        await page.waitForTimeout(5000);
        await page.screenshot({ path: 'result.png' });
        await ctx.replyWithPhoto({ source: fs.createReadStream('result.png') }, { caption: "✅ تمت العملية!" });

        await browser.close();
    } catch (err) {
        if (browser) await browser.close();
        await ctx.reply("❌ حدث خطأ: " + err.message + "\nنصيحة: تأكد أن الرابط يعمل أو أنك لست محظوراً من نتفليكس.");
    }
}

bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return;
    await runBrowser(ctx, text);
});

bot.launch();
console.log("البوت يعمل...");
