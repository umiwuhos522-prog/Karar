import axios from 'axios';
import { exec } from 'child_process';
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
 * استخراج دقة الفيديو وأي بيانات وصفية عبر ffprobe
 */
function getStreamHeightAndMeta(url) {
    return new Promise((resolve) => {
        const cmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,codec_name -of json "${url}"`;
        exec(cmd, { timeout: 6000 }, (error, stdout) => {
            if (error) return resolve({ height: 0, width: 0, codec: '' });
            try {
                const data = JSON.parse(stdout);
                if (data.streams && data.streams.length > 0) {
                    const stream = data.streams[0];
                    return resolve({
                        height: stream.height || 0,
                        width: stream.width || 0,
                        codec: stream.codec_name || ''
                    });
                }
            } catch (e) {
                return resolve({ height: 0, width: 0, codec: '' });
            }
            resolve({ height: 0, width: 0, codec: '' });
        });
    });
}

/**
 * فحص أن البث حقيقي ويعمل
 */
async function isValidStream(url) {
    try {
        const response = await axios.get(url, {
            timeout: 5000,
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (response.status !== 200) return false;

        const contentType = (response.headers['content-type'] || '').toLowerCase();
        if (contentType.includes('text/html')) return false;

        const chunk = await new Promise((resolve) => {
            response.data.once('data', (data) => resolve(data.slice(0, 512)));
            response.data.once('error', () => resolve(Buffer.from('')));
        });

        response.data.destroy();

        const chunkText = chunk.toString().toLowerCase();
        if (chunkText.includes('<html') || chunkText.includes('<!doctype')) {
            return false;
        }

        return true;
    } catch (error) {
        return false;
    }
}

/**
 * استخدام Gemini الذكي لتحليل وتحديد اسم القناة، وهل هي عربية أم لا وتصنيفها
 */
async function analyzeChannelWithGemini(url, height) {
    const prompt = `
    You are an expert IPTV stream analyzer. I have an active video stream URL: ${url} with video height ${height}p.
    Based on common IPTV naming structures and stream patterns for Arab/Middle Eastern television networks (like beIN Sports, MBC, OSN, Rotana, Shahid, SSC, etc.), analyze what kind of channel this typically is or infer its identity based on the URL index/pattern, or provide a smart professional classification.
    
    You must respond strictly in valid JSON format with the following keys:
    - "is_arabic": true or false (Only true if it is an Arabic channel or broadcasting in Arabic)
    - "channel_name": Professional name of the channel in Arabic (e.g. "beIN Sports 1 HD", "MBC 1", "سبيستون", etc.)
    - "category": Category in Arabic (e.g. "قنوات الرياضة", "مسلسلات وبرامج", "أطفال وكرتون", "أفلام", "إخبارية", etc.)
    - "description": Brief description in Arabic.

    If you cannot determine the exact channel, give it a smart generic Arabic IPTV title based on its resolution and context, but ensure "is_arabic" is true only if it's clearly an Arabic content stream.
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
            channel_name: "قناة منوعة",
            category: "قنوات عامة",
            description: "بث مباشر"
        };
    }
}

/**
 * تنسيق القناة بصيغة M3U احترافية
 */
function formatM3uEntry(url, channelNameAr, categoryAr, height) {
    const logoUrl = "https://upload.wikimedia.org/wikipedia/commons/d/d7/Bein_sport_ana_logo.png";
    let qualityStr = "";

    if (height >= 1080) {
        qualityStr = "بدقة عالية جداً 1080p";
    } else if (height >= 720) {
        qualityStr = "بدقة عالية 720p";
    } else if (height >= 480) {
        qualityStr = "بدقة متوسطة 480p";
    } else if (height > 0) {
        qualityStr = `بدقة ${height}p`;
    } else {
        qualityStr = "بدقة غير معروفة";
    }

    const groupTitle = `⭐ ${categoryAr} | ${qualityStr} ⭐`;

    return `# ${groupTitle}\n#EXTINF:-1 tvg-logo="${logoUrl}" group-title="${groupTitle}", ${channelNameAr}\n${url}`;
}

/**
 * دالة التخمين والفحص الرئيسية
 */
async function startScanning(baseUrl, startNum, count = 50) {
    console.log("[-] بدء فحص القنوات والتحقق منها عبر ذكاء Gemini الاصطناعي...\n");
    let foundArabic = 0;

    for (let i = 0; i < count; i++) {
        const currentNum = startNum + i;
        const testUrl = `${baseUrl}${currentNum}.ts`;

        process.stdout.write(`[*] فحص الرابط: ${testUrl} -> `);

        const valid = await isValidStream(testUrl);

        if (valid) {
            console.log("✅ شغال! جاري فحص الجودة والتحليل بالذكاء الاصطناعي...");
            const { height } = await getStreamHeightAndMeta(testUrl);

            // استدعاء Gemini لتحليل البث
            const analysis = await analyzeChannelWithGemini(testUrl, height);

            if (analysis.is_arabic) {
                foundArabic++;
                const channelName = analysis.channel_name || `قناة عربية ${foundArabic}`;
                const category = analysis.category || "قنوات عامة";

                console.log(`[+] قناة عربية مكتشفة: ${channelName} [${category}] - الدقة: ${height}p`);

                const m3uEntry = formatM3uEntry(testUrl, channelName, category, height);
                await sendTelegramMessage(`<code>${m3uEntry}</code>`);
            } else {
                console.log("[-] القناة غير عربية، تم تخطيها.");
            }
        } else {
            console.log("❌ لا يعمل");
        }
    }
}

// ==================== التشغيل ====================
(async () => {
    const BASE_URL = "http://xvip.pro/live/hend0815/08152023/";
    const START_NUMBER = 340315;
    await startScanning(BASE_URL, START_NUMBER, 20);
})();
