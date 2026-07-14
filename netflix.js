const { Telegraf, session } = require('telegraf');
const { chromium } = require('playwright');

const TOKEN = "7932535685:AAGvA0gLJI_xXn-nlL5oahKi2xn9YvziQxU";
const bot = new Telegraf(TOKEN);
bot.use(session());

async function runBrowser(email) {
    let browser;
    try {
        browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const context = await browser.newContext();
        const page = await context.newPage();
        
        // 1. الدخول للرابط الرئيسي
        await page.goto('https://www.netflix.com', { waitUntil: 'domcontentloaded', timeout: 60000 });

        // 2. البحث عن حقل الإيميل (أي حقل بريد إلكتروني في الصفحة)
        const emailSelector = 'input[type="email"]';
        await page.waitForSelector(emailSelector, { timeout: 20000 });
        await page.fill(emailSelector, email);

        // 3. الضغط على زر المتابعة (البحث عن الزر الذي يحتوي على نص "Get Started" أو ما يشابهه)
        // نستخدم XPath للبحث عن أي زر يحتوي على كلمة متابعة أو ما يعادلها في الصفحة
        const buttonSelector = 'button[type="submit"]';
        await page.click(buttonSelector);

        await browser.close();
        return "✅ تم إدخال الإيميل والضغط على زر المتابعة بنجاح.";
        
    } catch (err) {
        if (browser) await browser.close();
        return "❌ فشل: لم أجد حقل الإيميل أو زر المتابعة. الخطأ: " + err.message;
    }
}

bot.start((ctx) => ctx.reply("البوت يعمل. أرسل الإيميل الآن:"));

bot.on('text', async (ctx) => {
    const email = ctx.message.text;
    ctx.reply("🔄 جاري المعالجة من الصفحة الرئيسية...");
    const result = await runBrowser(email);
    ctx.reply(result);
});

bot.launch();
