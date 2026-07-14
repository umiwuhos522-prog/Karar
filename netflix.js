const { Telegraf, session } = require('telegraf');
const { chromium } = require('playwright');

// التوكن ومعرف المالك
const TOKEN = "7932535685:AAGvA0gLJI_xXn-nlL5oahKi2xn9YvziQxU";
const OWNER_ID = 6491999046;

// الكوكيز بتنسيق JSON الجاهز للعمل مع Playwright
const COOKIES = [
    { "domain": ".netflix.com", "name": "netflix-sans-normal-3-loaded", "path": "/", "value": "true" },
    { "domain": ".netflix.com", "name": "SecureNetflixId", "path": "/", "value": "v%3D3%26mac%3DAQEAEQABABQ6aF0HZ8DsqIo_PhF7ZqIn4Pnkr9eRfa8.%26dt%3D1783653781333" },
    { "domain": ".netflix.com", "name": "gsid", "path": "/", "value": "e1335f92-02b6-43d9-a5dd-c979841186f3" },
    { "domain": ".netflix.com", "name": "NetflixId", "path": "/", "value": "v%3D3%26ct%3DBgjHlOvcAxK7AQ6aWc332xABBe3_4TFi_GhYz6bu_SppiID9W173968rwXGgBZ5FOguy1o_nypEEzJFpJgmH0c87meJqBoXmkDG-3fRhPBkFJTw4N7FdSlN0L-D1Ihh-QS3KpejkBqY-jawZSvsTk7_j4UywDGYUdSSEksmaOJUWffx0dkqHTtce0mtk26U5ed1HqmdrMIXbF4_wTrJay86xSzumhWvu6NCztzpwtR73CSf9ei3-8Zhv4lR_akcGOLIpWaUYBiIOCgzRZAUwFliOAy-sUmU." },
    { "domain": ".netflix.com", "name": "flwssn", "path": "/", "value": "0c34d834-9769-4f10-8fbe-8ec245d9746f" },
    { "domain": ".netflix.com", "name": "netflix-sans-bold-3-loaded", "path": "/", "value": "true" },
    { "domain": ".netflix.com", "name": "nfvdid", "path": "/", "value": "BQFmAAEBEE9JRlMuhcd1vZeyOZDGNsBgwt3MrI_af3LayzVVer6glzJvVpf97z33DXpKHBq9u0DnX0WJv5EuD1xSVUtIk9HEqcup0dtQ_aPOeD1ClWFBbYusKTD2yuO_aWV8_hyzEbgC_UGa_bLVoE2bGHdkptD2" }
];

const bot = new Telegraf(TOKEN);
bot.use(session());

async function executeNetflixLogic(email) {
    let browser;
    try {
        // 1. فتح المتصفح بخصائص السيرفرات لتجنب الأخطاء
        browser = await chromium.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
        });
        
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
        });
        
        // 2. حقن الكوكيز في المتصفح
        await context.addCookies(COOKIES);
        const page = await context.newPage();
        
        // 3. زيارة موقع نتفليكس أولاً لتهيئة الجلسة (Session)
        await page.goto('https://www.netflix.com/', { waitUntil: 'domcontentloaded' });
        
        // 4. إرسال الطلب من "داخل" سياق المتصفح الحقيقي
        const response = await page.request.post('https://www.netflix.com/signup/registration', {
            data: `email=${encodeURIComponent(email)}`,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': 'https://www.netflix.com/',
                'Origin': 'https://www.netflix.com'
            }
        });
        
        const status = response.status();
        await browser.close();
        return `✅ تمت المحاولة عبر المتصفح. كود الاستجابة: ${status}`;
        
    } catch (error) {
        if (browser) await browser.close();
        return `❌ خطأ في المتصفح: ${error.message}`;
    }
}

bot.command('start_process', (ctx) => {
    if (ctx.from.id !== OWNER_ID) return;
    ctx.session = { waitingForEmail: true };
    ctx.reply("أهلاً مالك البوت. أرسل الإيميل الآن (العملية ستتم عبر متصفح مخفي):");
});

bot.on('text', async (ctx) => {
    if (ctx.session && ctx.session.waitingForEmail) {
        ctx.reply("جاري فتح المتصفح ومعالجة الطلب، يرجى الانتظار ثواني...");
        const result = await executeNetflixLogic(ctx.message.text);
        ctx.reply(result);
        ctx.session.waitingForEmail = false;
    }
});

bot.launch();
console.log("البوت يعمل الآن بوضع المتصفح (Playwright)...");
