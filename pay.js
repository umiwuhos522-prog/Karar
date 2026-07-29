import axios from 'axios';
import { GoogleGenAI } from '@google/genai';

// ==================== الإعدادات الأساسية ====================
const TELEGRAM_BOT_TOKEN = "7932535685:AAFNVyAPfmSCmHeptKAA0xc9779l8EethnQ";
const TELEGRAM_CHAT_ID = "6491999046";

// مفتاح Gemini API
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyDqlfbn5shYklhde9cn3dl_d-UwqPzmSs0";

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

/**
 * إرسال النتيجة إلى تليجرام بصيغة HTML
 */
async function sendTelegramMessage(message) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const payload = {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "HTML"
    };
    try {
        await axios.post(url, payload, { timeout: 5000 });
    } catch (error) {
        console.log(`[!] فشل إرسال الرسالة لتليجرام: ${error.message}`);
    }
}

/**
 * فحص سريعة وفعالة للبث بدون تجميد السكربت
 */
async function inspectStream(url) {
    try {
        const response = await axios.get(url, {
            timeout: 6000,
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Connection': 'keep-alive'
            }
        });

        if (response.status !== 200) return { valid: false };

        const contentType = (response.headers['content-type'] || '').toLowerCase();
        if (contentType.includes('text/html')) return { valid: false };

        // أخذ العينة الأولى للتأكد أن الملف فيديو وليس HTML
        const chunk = await new Promise((resolve) => {
            const timer = setTimeout(() => resolve(Buffer.from('')), 3000);
            response.data.once('data', (data) => {
                clearTimeout(timer);
                resolve(data.slice(0, 512));
            });
            response.data.once('error', () => resolve(Buffer.from('')));
        });

        response.data.destroy();

        const chunkText = chunk.toString().toLowerCase();
        if (chunkText.includes('<html') || chunkText.includes('<!doctype') || chunk.length === 0) {
            return { valid: false };
        }

        return { valid: true, serverHeaders: response.headers };
    } catch (error) {
        return { valid: false };
    }
}

/**
 * تحليل ذكي وسريع عبر Gemini لمعرفة تفاصيل القناة وتصنيفها
 */
async function analyzeStreamWithGemini(url, streamIndex) {
    const prompt = `
    أنت محترف متخصص في خوادم قنوات IPTV وشبكات البث العربية (مثل MBC, beIN Sports, SSC, Shahid, OSN, Rotana).
    لدينا رابط بث مباشر شغال IPTV:
    URL: ${url}
    رقم القناة في السيرفر: ${streamIndex}

    المطلوب منك:
    1. استنتاج وتحديد اسم القناة العربية الأكثر احتمالاً لهذا الرقم بناءً على ترتيب قنوات السيرفرات الشهيرة (مثلاً: "beIN Sports 1 HD", "MBC 1", "روتانا سينما", "SSC 1 HD", "سبيستون", "قناة المجد", "MBC Drama").
    2. التأكد هل هي قناة عربية أم لا (is_arabic).
    3. تحديد تصنيف القناة بالضبط من بين التصنيفات التالية فقط:
       - "رياضة"
       - "مسلسلات وبرامج"
       - "أفلام عربية"
       - "أفلام أجنبية ورعب"
       - "أطفال وكرتون"
       - "إخبارية وثائقية"
       - "إسلامية"

    أجب بصيغة JSON فقط بهذا الشكل وبدون أي مقدمات:
    {
      "is_arabic": true,
      "channel_name": "اسم القناة بالعربي",
      "category": "التصنيف"
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
        console.log(`[!] خطأ في تحليل Gemini: ${e.message}`);
        return {
            is_arabic: true,
            channel_name: `قناة عربية HD (${streamIndex})`,
            category: "قنوات عامة"
        };
    }
}

/**
 * تنسيق M3U احترافي
 */
function formatM3uEntry(url, channelNameAr, categoryAr) {
    const logoUrl = "https://upload.wikimedia.org/wikipedia/commons/d/d7/Bein_sport_ana_logo.png";
    const groupTitle = `⭐ ${categoryAr} | 1080p FHD ⭐`;

    return `# ${groupTitle}\n#EXTINF:-1 tvg-logo="${logoUrl}" group-title="${groupTitle}", ${channelNameAr}\n${url}`;
}

/**
 * عملية الفحص الرئيسية
 */
async function startScanning(baseUrl, startNum, count = 100) {
    console.log("🚀 بدء فحص القنوات والتحليل الفوري مع Gemini...\n");

    for (let i = 0; i < count; i++) {
        const currentNum = startNum + i;
        const testUrl = `${baseUrl}${currentNum}.ts`;

        console.log(`[*] جاري فحص الرابط رقم ${currentNum}...`);

        const result = await inspectStream(testUrl);

        if (result.valid) {
            console.log(`✅ القناة رقم ${currentNum} شغالة! جاري تحليل البيانات بـ Gemini...`);

            // استدعاء الذكاء الاصطناعي لتشخيص القناة ورقمها
            const analysis = await analyzeStreamWithGemini(testUrl, currentNum);

            if (analysis && analysis.is_arabic) {
                const channelName = analysis.channel_name;
                const category = analysis.category;

                console.log(`[+] تم الاكتشاف: ${channelName} [التصنيف: ${category}]`);

                const m3uEntry = formatM3uEntry(testUrl, channelName, category);
                await sendTelegramMessage(`<code>${m3uEntry}</code>`);
            } else {
                console.log("[-] القناة غير عربية، تم التجاوز.");
            }
        } else {
            console.log(`❌ القناة رقم ${currentNum} لا تعمل.`);
        }
    }
}

// ==================== التشغيل ====================
(async () => {
    const BASE_URL = "http://xvip.pro/live/hend0815/08152023/";
    const START_NUMBER = 340315;
    await startScanning(BASE_URL, START_NUMBER, 200);
})();
