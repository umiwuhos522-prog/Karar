const { Telegraf, session } = require('telegraf');
const axios = require('axios');

// التوكن الجديد
const TOKEN = "7932535685:AAGvA0gLJI_xXn-nlL5oahKi2xn9YvziQxU";
const OWNER_ID = 6491999046;

// الكوكيز
const COOKIES = "netflix-sans-normal-3-loaded=true; SecureNetflixId=v%3D3%26mac%3DAQEAEQABABQ6aF0HZ8DsqIo_PhF7ZqIn4Pnkr9eRfa8.%26dt%3D1783653781333; gsid=e1335f92-02b6-43d9-a5dd-c979841186f3; NetflixId=v%3D3%26ct%3DBgjHlOvcAxK7AQ6aWc332xABBe3_4TFi_GhYz6bu_SppiID9W173968rwXGgBZ5FOguy1o_nypEEzJFpJgmH0c87meJqBoXmkDG-3fRhPBkFJTw4N7FdSlN0L-D1Ihh-QS3KpejkBqY-jawZSvsTk7_j4UywDGYUdSSEksmaOJUWffx0dkqHTtce0mtk26U5ed1HqmdrMIXbF4_wTrJay86xSzumhWvu6NCztzpwtR73CSf9ei3-8Zhv4lR_akcGOLIpWaUYBiIOCgzRZAUwFliOAy-sUmU.; flwssn=0c34d834-9769-4f10-8fbe-8ec245d9746f; netflix-sans-bold-3-loaded=true; nfvdid=BQFmAAEBEE9JRlMuhcd1vZeyOZDGNsBgwt3MrI_af3LayzVVer6glzJvVpf97z33DXpKHBq9u0DnX0WJv5EuD1xSVUtIk9HEqcup0dtQ_aPOeD1ClWFBbYusKTD2yuO_aWV8_hyzEbgC_UGa_bLVoE2bGHdkptD2";

const bot = new Telegraf(TOKEN);

bot.use(session());

async function executeNetflixLogic(email) {
    try {
        const response = await axios.post("https://www.netflix.com/signup/registration", 
            `email=${encodeURIComponent(email)}`, {
            headers: {
                "Cookie": COOKIES,
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
                "Referer": "https://www.netflix.com/signup/registration",
                "Origin": "https://www.netflix.com"
            }
        });
        return `تمت المحاولة. كود الاستجابة: ${response.status}`;
    } catch (error) {
        // إرجاع تفاصيل الخطأ في حال وجودها
        return `خطأ: ${error.response ? error.response.status : error.message}`;
    }
}

bot.command('start_process', (ctx) => {
    if (ctx.from.id !== OWNER_ID) return;
    ctx.session = { waitingForEmail: true };
    ctx.reply("أهلاً مالك البوت. أرسل الإيميل:");
});

bot.on('text', async (ctx) => {
    if (ctx.session && ctx.session.waitingForEmail) {
        ctx.reply("جاري المعالجة...");
        const result = await executeNetflixLogic(ctx.message.text);
        ctx.reply(result);
        ctx.session.waitingForEmail = false;
    }
});

bot.launch();
console.log("البوت يعمل الآن بالتوكن الجديد...");
