const { Telegraf } = require('telegraf');
const { chromium } = require('playwright');
const fs = require('fs');

const TOKEN = "7932535685:AAGvA0gLJI_xXn-nlL5oahKi2xn9YvziQxU";
const bot = new Telegraf(TOKEN);

// الكوكيز
const rawCookies = [
    { "domain": ".netflix.com", "name": "netflix-sans-normal-3-loaded", "value": "true", "path": "/", "sameSite": null },
    { "domain": ".netflix.com", "name": "SecureNetflixId", "value": "v%3D3%26mac%3DAQEAEQABABQ6aF0HZ8DsqIo_PhF7ZqIn4Pnkr9eRfa8.%26dt%3D1783653781333", "path": "/", "sameSite": "strict", "secure": true },
    { "domain": ".netflix.com", "name": "gsid", "value": "e1335f92-02b6-43d9-a5dd-c979841186f3", "path": "/", "sameSite": "no_restriction", "secure": true },
    { "domain": ".netflix.com", "name": "NetflixId", "value": "v%3D3%26ct%3DBgjHlOvcAxK7AQ6aWc332xABBe3_4TFi_GhYz6bu_SppiID9W173968rwXGgBZ5FOguy1o_nypEEzJFpJgmH0c87meJqBoXmkDG-3fRhPBkFJTw4N7FdSlN0L-D1Ihh-QS3KpejkBqY-jawZSvsTk7_j4UywDGYUdSSEksmaOJUWffx0dkqHTtce0mtk26U5ed1HqmdrMIXbF4_wTrJay86xSzumhWvu6NCztzpwtR73CSf9ei3-8Zhv4lR_akcGOLIpWaUYBiIOCgzRZAUwFliOAy-sUmU.", "path": "/", "sameSite": "lax", "secure": true },
    { "domain": ".netflix.com", "name": "flwssn", "value": "0c34d834-9769-4f10-8fbe-8ec245d9746f", "path": "/", "sameSite": null },
    { "domain": ".netflix.com", "name": "netflix-sans-bold-3-loaded", "value": "true", "path": "/", "sameSite": null },
    { "domain": ".netflix.com", "name": "nfvdid", "value": "BQFmAAEBEE9JRlMuhcd1vZeyOZDGNsBgwt3MrI_af3LayzVVer6glzJvVpf97z33DXpKHBq9u0DnX0WJv5EuD1xSVUtIk9HEqcup0dtQ_aPOeD1ClWFBbYusKTD2yuO_aWV8_hyzEbgC_UGa_bLVoE2bGHdkptD2", "path": "/", "sameSite": null }
];

const cookies = rawCookies.map(cookie => ({
    ...cookie,
    sameSite: ['Strict', 'Lax', 'None'].includes(cookie.sameSite) ? cookie.sameSite : 'Lax'
}));

// دالة تصوير وارسال الصور
async function takeScreenshot(page, ctx, caption) {
    const path = `step_${Date.now()}.png`;
    await page.screenshot({ path });
    await ctx.replyWithPhoto({ source: fs.createReadStream(path) }, { caption });
    fs.unlinkSync(path);
}

async function runBrowser(ctx, email) {
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/126.0.0.0'
        });

        await context.addCookies(cookies);
        const page = await context.newPage();

        await page.goto('https://www.netflix.com/iq-en/', { waitUntil: 'networkidle' });

        // 1. الضغط على الشريط في الأعلى (البحث عن النص وتحديده)
        const topBanner = page.getByText('Try 30 days for €0').first();
        await topBanner.waitFor({ state: 'visible', timeout: 15000 });
        await topBanner.click();

        // ننتظر قليلاً في حال انتقلت الصفحة لمكان جديد أو حملت عناصر جديدة
        await page.waitForTimeout(3000); 

        // 2. التقاط صورة بعد الضغط على العرض
        await takeScreenshot(page, ctx, "الخطوة 1: تم الضغط على (Try 30 days) في الأعلى.");

        // 3. مسح الإيميل وكتابته يدوياً
        // نستخدم محددات عامة تعمل سواء كنا في نفس الصفحة أو صفحة جديدة
        const emailInputSelector = 'input[type="email"], input[name="email"], input[data-uia="field-email"]';
        await page.waitForSelector(emailInputSelector, { state: 'visible' });
        
        const emailInput = page.locator(emailInputSelector).first();
        await emailInput.click();
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
        await emailInput.type(email, { delay: 200 });

        // 4. التقاط صورة بعد كتابة الإيميل
        await takeScreenshot(page, ctx, "الخطوة 2: تم مسح الخانة وكتابة الإيميل يدوياً.");

        await page.waitForTimeout(2000);

        // 5. الضغط على المتابعة (Next أو Get Started حسب الصفحة)
        // هذا السطر يبحث عن أي زر يحمل كلمة Next أو Get Started أو المحدّد الخاص بالمتابعة
        const nextBtn = page.locator('button:has-text("Next"), button:has-text("Get Started"), button[data-uia="cta-registration"], button[data-uia="btn-continue"]').first();
        await nextBtn.click({ force: true });
        
        await page.waitForTimeout(5000); // انتظار لمعرفة النتيجة بعد الضغط

        // 6. التقاط صورة نهائية
        await takeScreenshot(page, ctx, "الخطوة 3: تم الضغط على زر المتابعة (Next).");

        await browser.close();
    } catch (err) {
        if (browser) await browser.close();
        await ctx.reply("❌ حدث خطأ: " + err.message);
    }
}

bot.command('start', (ctx) => {
    ctx.reply("أهلاً بك! يرجى إرسال الإيميل لبدء العملية.");
});

bot.on('text', (ctx) => {
    if (ctx.message.text.startsWith('/')) return;
    ctx.reply("⏳ جاري البدء بالمسار الجديد...");
    runBrowser(ctx, ctx.message.text);
});

bot.launch();
