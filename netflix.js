const { Telegraf } = require('telegraf');
const { chromium } = require('playwright');
const fs = require('fs');

const TOKEN = "7932535685:AAGvA0gLJI_xXn-nlL5oahKi2xn9YvziQxU";
const bot = new Telegraf(TOKEN);

// الكوكيز المحدثة
const cookies = [
    { "name": "netflix-sans-bold-3-loaded", "value": "true", "domain": ".netflix.com", "path": "/", "expirationDate": 1791815251.6186, "httpOnly": false, "secure": false, "sameSite": "Lax" },
    { "name": "netflix-sans-normal-3-loaded", "value": "true", "domain": ".netflix.com", "path": "/", "expirationDate": 1791815251.61852, "httpOnly": false, "secure": false, "sameSite": "Lax" },
    { "name": "NetflixId", "value": "v%3D3%26ct%3DBgjHlOvcAxLWAeL6G7gNHjC0RSukL5P5ai7X5N4yBdQENkILmkq-xu5WsvfoU1AgWLFFnSsWCugtuj1j41wEOX_WK3Vzah5U7HzBsLEH13RkpzOfo31E0ei-MMUcSJXkF3AlYW8iijtrWQMM_q3tKc143bwMAyutAnH_WVQzhBy0mNLvVybJzKSi7B8wkzzSgCTQX5E8b7y4RIwj-9Wbg1bcO9IaNaNURmA5e0u2D0r520fZNZ6_SNxabeh6-EFjRgj1bZCjW-dhGMs6Y6qFF8a4A0sJyz2BSAkVgKKmJzEYBiIOCgzTPeesDAJEJgHpsBw.", "domain": ".netflix.com", "path": "/", "expirationDate": 1815574947.900658, "httpOnly": false, "secure": true, "sameSite": "Lax" },
    { "name": "nfvdid", "value": "BQFmAAEBEE9JRlMuhcd1vZeyOZDGNsBgwt3MrI_af3LayzVVer6glzJvVpf97z33DXpKHBq9u0DnX0WJv5EuD1xSVUtIk9HEqcup0dtQ_aPOeD1ClWFBbYusKTD2yuO_aWV8_hyzEbgC_UGa_bLVoE2bGHdkptD2", "domain": ".netflix.com", "path": "/", "expirationDate": 1799122686.025479, "httpOnly": false, "secure": false, "sameSite": "Lax" },
    { "name": "nkufi-bold-4-loaded", "value": "true", "domain": ".netflix.com", "path": "/", "expirationDate": 1791815251.618416, "httpOnly": false, "secure": false, "sameSite": "Lax" },
    { "name": "nkufi-normal-4-loaded", "value": "true", "domain": ".netflix.com", "path": "/", "expirationDate": 1791815251.618218, "httpOnly": false, "secure": false, "sameSite": "Lax" },
    { "name": "OptanonConsent", "value": "consentId=2ab03ed8-9c9d-4c80-925b-d16af32ad47d&datestamp=Tue+Jul+14+2026+17%3A27%3A33+GMT%2B0300+(Arabian+Standard+Time)&version=202604.2.0&interactionCount=1&isAnonUser=1&prevHadToken=0&crTime=1784032869575&isGpcEnabled=0&browserGpcFlag=0&isDntEnabled=0&isIABGlobal=false&hosts=&landingPath=NotLandingPage&groups=C0001%3A1%2CC0002%3A1%2CC0003%3A1%2CC0004%3A1&AwaitingReconsent=false", "domain": ".netflix.com", "path": "/", "expirationDate": 1815575253, "httpOnly": false, "secure": false, "sameSite": "Lax" },
    { "name": "OTSessionTracking", "value": "87b6a5c0-0104-4e96-a291-092c11350111", "domain": "www.netflix.com", "path": "/", "expirationDate": 1784119199, "httpOnly": false, "secure": false, "sameSite": "Lax" },
    { "name": "SecureNetflixId", "value": "v%3D3%26mac%3DAQEAEQABABS8CAhRYEmIuvmNn6BmBWXfWWbnrArwqrc.%26dt%3D1784038947590", "domain": ".netflix.com", "path": "/", "expirationDate": 1815574947.900542, "httpOnly": false, "secure": true, "sameSite": "Strict" }
];

let userState = {};

bot.command('start', (ctx) => {
    ctx.reply("يرجى إرسال الإيميل:");
    userState[ctx.chat.id] = 'waiting_for_email';
});

bot.on('text', async (ctx) => {
    if (userState[ctx.chat.id] === 'waiting_for_email') {
        const email = ctx.message.text;
        const msg = await ctx.reply("⏳ جاري المعالجة... يرجى الانتظار.");
        
        let browser;
        try {
            browser = await chromium.launch({ headless: true });
            const context = await browser.newContext();
            await context.addCookies(cookies);
            const page = await context.newPage();
            
            await page.goto('https://www.netflix.com/iq-en/login', { waitUntil: 'networkidle' });

            // الكتابة مع الضغط على Enter لإرسال النموذج
            const emailInput = page.locator('input[name="userLoginId"]');
            await emailInput.fill(email); 
            await page.screenshot({ path: 'step1.png' });
            await ctx.replyWithPhoto({ source: fs.createReadStream('step1.png') }, { caption: "تمت الكتابة." });

            await page.click('button[type="submit"]');
            await page.waitForTimeout(5000); // انتظر 5 ثواني كاملة
            
            await page.screenshot({ path: 'step2.png' });
            await ctx.replyWithPhoto({ source: fs.createReadStream('step2.png') }, { caption: "النتيجة النهائية." });
            
            await browser.close();
            ctx.deleteMessage(msg.message_id);
            userState[ctx.chat.id] = null;
        } catch (err) {
            if (browser) await browser.close();
            ctx.reply("❌ حدث خطأ تقني: " + err.message);
            userState[ctx.chat.id] = null;
        }
    }
});

bot.launch();
