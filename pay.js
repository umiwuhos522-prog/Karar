import axios from 'axios';
import { exec } from 'child_process';
import { GoogleGenAI } from '@google/genai';

// ==================== الإعدادات الأساسية ====================
const TELEGRAM_BOT_TOKEN = "7932535685:AAFNVyAPfmSCmHeptKAA0xc9779l8EethnQ";
const TELEGRAM_CHAT_ID = "6491999046";

// مفتاح Gemini API
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyDqlfbn5shYklhde9cn3dl_d-UwqPzmSs0";

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

let currentScanningUrl = "";
let currentScanningNum = 0;

/**
 * إرسال رسالة لتليجرام
 */
async function sendTelegramMessage(message) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: "HTML"
        }, { timeout: 8000 });
    } catch (e) {}
}

/**
 * مستمع أمر /start
 */
async function startTelegramBotListener() {
    let lastUpdateId = 0;
    setInterval(async () => {
        try {
            const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=5`;
            const response = await axios.get(url, { timeout: 10000 });

            if (response.data && response.data.result) {
                for (const update of response.data.result) {
                    lastUpdateId = update.update_id;
                    if (update.message && update.message.text === '/start') {
                        let msg = `<b>📊 تقرير الفحص المباشر:</b>\n\n`;
                        msg += `🔗 <b>الرابط الحالي:</b> <code>${currentScanningUrl || "جاري البدء..."}</code>\n`;
                        msg += `🔢 <b>الرقم الحالي:</b> <code>${currentScanningNum}</code>\n`;
                        msg += `✨ <i>البوت متصل بالذكاء الاصطناعي ويقوم بفحص البث تلقائياً...</i>`;
                        await sendTelegramMessage(msg);
                    }
                }
            }
        } catch (e) {}
    }, 2500);
}

/**
 * فحص هيدر البث واستخراج معلومات المشغل
 */
function getStreamMetadata(url) {
    return new Promise((resolve) => {
        const cmd = `ffprobe -v error -select_streams v:0 -show_entries stream=height,width,codec_name -of json "${url}"`;
        exec(cmd, { timeout: 7000 }, (err, stdout) => {
            if (err) return resolve({ height: 1080, valid: false });
            try {
                const data = JSON.parse(stdout);
                if (data.streams && data.streams.length > 0) {
                    return resolve({
                        height: data.streams[0].height || 1080,
                        valid: true
                    });
                }
            } catch (e) {}
            resolve({ height: 1080, valid: true });
        });
    });
}

/**
 * استخدام Gemini الذكي للتعرف على القناة
 */
async function analyzeStreamWithGemini(url, num) {
    const prompt = `
    You are an expert IPTV channel finder.
    Analyze the following stream URL from an Arab IPTV provider:
    URL: ${url}
    Channel Index Number: ${num}

    Based on IPTV server structures in Middle East (like xvip, cobra, etc.), infer the Arabic TV Channel name and category.
    Examples of Arabic channels: "beIN Sports 1 HD", "MBC 1", "روتانا سينما", "سبيستون", "الجزيرة HD", "SSC Sports 1 HD", "MBC Drama".

    Strictly return valid JSON only:
    {
      "is_arabic": true,
      "channel_name": "اسم القناة بالعربي",
      "category": "اختر فقط: (رياضة | مسلسلات وبرامج | أفلام عربية | أفلام أجنبية ورعب | أطفال وكرتون | إخبارية | إسلامية)"
    }
    `;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });

        let text = response.text.trim();
        if (text.includes("```json")) {
            text = text.split("```json")[1].split("```")[0].trim();
        } else if (text.includes("```")) {
            text = text.split("```")[1].split("```")[0].trim();
        }

        return JSON.parse(text);
    } catch (e) {
        return null;
    }
}

/**
 * تنسيق M3U
 */
function formatM3uEntry(url, channelNameAr, categoryAr, height) {
    const logoUrl = "https://upload.wikimedia.org/wikipedia/commons/d/d7/Bein_sport_ana_logo.png";
    const groupTitle = `⭐ ${categoryAr} | ${height}p FHD ⭐`;

    return `# ${groupTitle}\n#EXTINF:-1 tvg-logo="${logoUrl}" group-title="${groupTitle}", ${channelNameAr}\n${url}`;
}

/**
 * فحص الاستجابة
 */
async function isValidStream(url) {
    try {
        const response = await axios.get(url, {
            timeout: 5000,
            responseType: 'stream',
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36' 
            }
        });
        if (response.status !== 200) return false;
        response.data.destroy();
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * دورة الفحص
 */
async function startScanning(baseUrl, startNum, count = 500) {
    await sendTelegramMessage("🟢 <b>تم تشغيل نظام فحص البث المباشر الذكي بنجاح!</b>");

    for (let i = 0; i < count; i++) {
        currentScanningNum = startNum + i;
        currentScanningUrl = `${baseUrl}${currentScanningNum}.ts`;

        process.stdout.write(`[*] فحص ${currentScanningNum} -> `);

        const valid = await isValidStream(currentScanningUrl);

        if (valid) {
            console.log("✅ شغال! جاري تحليل البيانات بـ Gemini...");

            const meta = await getStreamMetadata(currentScanningUrl);
            const analysis = await analyzeStreamWithGemini(currentScanningUrl, currentScanningNum);

            if (analysis && analysis.is_arabic) {
                const channelName = analysis.channel_name;
                const category = analysis.category;

                console.log(`[+] اكتشاف: ${channelName} [${category}]`);

                const m3uEntry = formatM3uEntry(currentScanningUrl, channelName, category, meta.height);
                await sendTelegramMessage(`<code>${m3uEntry}</code>`);
            }
        } else {
            console.log("❌ غير شغال");
        }
    }
}

// ==================== التشغيل ====================
(async () => {
    startTelegramBotListener();

    const BASE_URL = "http://xvip.pro/live/hend0815/08152023/";
    const START_NUMBER = 340315;
    await startScanning(BASE_URL, START_NUMBER, 500);
})();
