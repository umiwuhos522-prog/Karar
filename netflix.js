const { Telegraf } = require('telegraf');
const { chromium } = require('playwright');
const fs = require('fs');

const TOKEN = "7932535685:AAGvA0gLJI_xXn-nlL5oahKi2xn9YvziQxU";
const bot = new Telegraf(TOKEN);

// الكوكيز مع معالجة حقل sameSite
const rawCookies = [
    { "domain": ".netflix.com", "name": "netflix-sans-normal-3-loaded", "value": "true", "path": "/", "sameSite": null },
    { "domain": ".netflix.com", "name": "SecureNetflixId", "value": "v%3D3%26mac%3DAQEAEQABABQ6aF0HZ8DsqIo_PhF7ZqIn4Pnkr9eRfa8.%26dt%3D1783653781333", "path": "/", "sameSite": "strict", "secure": true },
    { "domain": ".netflix.com", "name": "gsid", "value": "e1335f92-02b6-43d9-a5dd-c979841186f3", "path": "/", "sameSite": "no_restriction", "secure": true },
    { "domain": ".netflix.com", "name": "NetflixId", "value": "v%3D3%26ct%3DBgjHlOvcAxK7AQ6aWc332xABBe3_4TFi_GhYz6bu_SppiID9W173968rwXGgBZ5FOguy1o_nypEEzJFpJgmH0c87meJqBoXmkDG-3fRhPBkFJTw4N7FdSlN0L-D1Ihh-QS3KpejkBqY-jawZSvsTk7_j4UywDGYUdSSEksmaOJUWffx0dkqHTtce0mtk26U5ed1HqmdrMIXbF4_wTrJay86xSzumhWvu6NCztzpwtR73CSf9ei3-8Zhv4lR_akcGOLIpWaUYBiIOCgzRZAUwFliOAy-sUmU.", "path": "/", "sameSite": "lax", "secure": true },
    { "domain": ".netflix.com", "name": "flwssn", "value": "0c34d834-9769-4f10-8fbe-8ec245d9746f", "path": "/", "sameSite": null },
    { "domain": ".netflix.com", "name": "netflix-sans-bold-3-loaded", "value": "true", "path": "/", "sameSite": null },
    { "domain": ".netflix.com", "name": "nfvdid", "value": "BQFmAAEBEE9JRlMuhcd1vZeyOZDGNsBgwt3MrI_af3LayzVVer6glzJvVpf97z33DXpKHBq9u0DnX0WJv5EuD1xSVUtIk9HEqcup0dtQ_aPOeD1ClWFBbYusKTD2yuO_aWV8_hyzEbgC_UGa_bLVoE2bGHdkptD2", "path": "/", "sameSite": null }
];

// تصحيح الكوكيز برمجياً لتجنب خطأ sameSite
const cookies = rawCookies.map(cookie => ({
    ...cookie,
    sameSite: ['Strict', 'Lax', 'None'].includes(cookie.sameSite) ? cookie.sameSite : 'Lax'
}));

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
        await page.screenshot({ path: 'step1.png' });
        await ctx.replyWithPhoto({ source: fs.createReadStream('step1.png') }, { caption: "تم الدخول للموقع." });

        const emailInput = page.locator('input[type="email"]');
        await emailInput.waitFor({ state: 'visible', timeout: 30000 });
        await emailInput.fill(email);
        await page.screenshot({ path: 'step2.png' });
        await ctx.replyWithPhoto({ source: fs.createReadStream('step2.png') }, { caption: "تم وضع الإيميل." });

        const submitBtn = page.locator('button[data-uia="cta-registration"]');
        await submitBtn.waitFor({ state: 'visible', timeout: 30000 });
        await submitBtn.click();

        await page.waitForTimeout(5000);
        await page.screenshot({ path: 'step3.png' });
        await ctx.replyWithPhoto({ source: fs.createReadStream('step3.png') }, { caption: "تمت العملية." });

        await browser.close();
    } catch (err) {
        if (browser) await browser.close();
        await ctx.reply("❌ حدث خطأ: " + err.message);
    }
}

bot.on('text', (ctx) => {
    if (ctx.message.text.startsWith('/')) return;
    runBrowser(ctx, ctx.message.text);
});

bot.launch();
