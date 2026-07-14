const { Telegraf } = require('telegraf');
const { chromium } = require('playwright');
const fs = require('fs');

const TOKEN = "7932535685:AAGvA0gLJI_xXn-nlL5oahKi2xn9YvziQxU";
const bot = new Telegraf(TOKEN);

// الكوكيز كما هي
const cookies = [
    { "domain": ".netflix.com", "expirationDate": 1791437690.300262, "hostOnly": false, "httpOnly": false, "name": "netflix-sans-normal-3-loaded", "path": "/", "sameSite": "Lax", "secure": false, "value": "true" },
    { "domain": ".netflix.com", "expirationDate": 1799205781.715754, "hostOnly": false, "httpOnly": false, "name": "SecureNetflixId", "path": "/", "sameSite": "Strict", "secure": true, "value": "v%3D3%26mac%3DAQEAEQABABQ6aF0HZ8DsqIo_PhF7ZqIn4Pnkr9eRfa8.%26dt%3D1783653781333" },
    { "domain": ".netflix.com", "expirationDate": 1783740185.228777, "hostOnly": false, "httpOnly": true, "name": "gsid", "path": "/", "sameSite": "Lax", "secure": true, "value": "e1335f92-02b6-43d9-a5dd-c979841186f3" },
    { "domain": ".netflix.com", "expirationDate": 1799205781.71589, "hostOnly": false, "httpOnly": false, "name": "NetflixId", "path": "/", "sameSite": "Lax", "secure": true, "value": "v%3D3%26ct%3DBgjHlOvcAxK7AQ6aWc332xABBe3_4TFi_GhYz6bu_SppiID9W173968rwXGgBZ5FOguy1o_nypEEzJFpJgmH0c87meJqBoXmkDG-3fRhPBkFJTw4N7FdSlN0L-D1Ihh-QS3KpejkBqY-jawZSvsTk7_j4UywDGYUdSSEksmaOJUWffx0dkqHTtce0mtk26U5ed1HqmdrMIXbF4_wTrJay86xSzumhWvu6NCztzpwtR73CSf9ei3-8Zhv4lR_akcGOLIpWaUYBiIOCgzRZAUwFliOAy-sUmU." },
    { "domain": ".netflix.com", "expirationDate": 1783672490.302061, "hostOnly": false, "httpOnly": false, "name": "flwssn", "path": "/", "sameSite": "Lax", "secure": false, "value": "0c34d834-9769-4f10-8fbe-8ec245d9746f" },
    { "domain": ".netflix.com", "expirationDate": 1791437690.301787, "hostOnly": false, "httpOnly": false, "name": "netflix-sans-bold-3-loaded", "path": "/", "sameSite": "Lax", "secure": false, "value": "true" },
    { "domain": ".netflix.com", "expirationDate": 1799122686.025479, "hostOnly": false, "httpOnly": false, "name": "nfvdid", "path": "/", "sameSite": "Lax", "secure": false, "value": "BQFmAAEBEE9JRlMuhcd1vZeyOZDGNsBgwt3MrI_af3LayzVVer6glzJvVpf97z33DXpKHBq9u0DnX0WJv5EuD1xSVUtIk9HEqcup0dtQ_aPOeD1ClWFBbYusKTD2yuO_aWV8_hyzEbgC_UGa_bLVoE2bGHdkptD2" }
];

async function runBrowser(ctx, email) {
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' });
        await context.addCookies(cookies);
        const page = await context.newPage();

        // حقن الإيميل قبل التحميل لضمان عدم ظهور أي إيميل آخر
        await page.route('**/login*', (route) => {
            route.continue();
        });

        await page.goto('https://www.netflix.com/iq-en/login');

        // تنفيذ كود إدخال قسري
        await page.evaluate((email) => {
            const input = document.querySelector('input[name="userLoginId"]');
            input.value = email;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }, email);

        await page.click('button[type="submit"]');
        
        await page.waitForTimeout(3000);
        const path = `final.png`;
        await page.screenshot({ path });
        await ctx.replyWithPhoto({ source: fs.createReadStream(path) });
        fs.unlinkSync(path);

        await browser.close();
    } catch (err) {
        if (browser) await browser.close();
        await ctx.reply("❌ خطأ: " + err.message);
    }
}

bot.on('text', (ctx) => runBrowser(ctx, ctx.message.text));
bot.launch();
