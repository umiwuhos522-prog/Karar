import axios from 'axios';
import { exec } from 'child_process';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';

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
 * استخراج دقة الفيديو والتقاط فريم (صورة) من البث المباشر
 */
function captureStreamFrameAndMeta(url, outputPath) {
    return new Promise((resolve) => {
        // 1. أخذ الدقة عبر ffprobe
        const metaCmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of json "${url}"`;
        exec(metaCmd, { timeout: 6000 }, (metaErr, stdout) => {
            let height = 0;
            try {
                const data = JSON.parse(stdout);
                if (data.streams && data.streams.length > 0) {
                    height = data.streams[0].height || 0;
                }
            } catch (e) {}

            // 2. التقاط صورة واحدة من البث عبر ffmpeg
            const captureCmd = `ffmpeg -y -i "${url}" -vframes 1 -q:v 2 "${outputPath}"`;
            exec(captureCmd, { timeout: 8000 }, (capErr) => {
                const hasImage = !capErr && fs.existsSync(outputPath);
                resolve({ height, imageCaptured: hasImage });
            });
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
 * تحليل البث والصورة باستخدام Gemini 2.5 Flash للتعرف البصري الدقيق على القناة ومحتواها
 */
async function analyzeChannelWithGeminiVision(url, height, imagePath) {
    const prompt = `
    أنك خبير محترف في تحليل قنوات البث المباشر (IPTV). 
    قم بفرز وتحليل هذه القناة من خلال الصورة المرفقة للبث المباشر ورابط البث (${url}) بدقة ${height}p.

    المطلوب منك بدقة عالية:
    1. التعرف على اسم القناة الحقيقي والكامل باللغة العربية (مثل: "beIN Sports 1 HD", "MBC 1", "روتانا سينما", "سبيستون", "MBC اكشن", "الجزيرة الإخبارية"، إلخ).
    2. التثبت هل القناة موجهة للجمهور العربي أو تبث محتوى عربي/مترجم بالعربية؟ (is_arabic).
    3. تحديد تصنيف القناة الدقيق جداً باللغة العربية، مثل:
       - "رياضة" (مباريات، كرة قدم)
       - "مسلسلات وبرامج"
       - "أفلام عربية"
       - "أفلام أجنبية ورعب"
       - "أطفال وكرتون"
       - "إخبارية وثائقية"
       - "إسلامية ودينية"

    يجب أن يكون ردك بصيغة JSON فقط بهذه السطور وبدون أي مقدمات:
    {
      "is_arabic": true or false,
      "channel_name": "اسم القناة بالعربي",
      "category": "التصنيف الدقيق",
      "description": "وصف قصير للمحتوى المعروض"
    }
    `;

    try {
        let contents = [prompt];

        // إذا تم التوصل لصورة البث، نرفعها لـ Gemini ليتعرف عليها بصرياً
        if (imagePath && fs.existsSync(imagePath)) {
            const imageBuffer = fs.readFileSync(imagePath);
            contents.push({
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: imageBuffer.toString('base64')
                }
            });
        }

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: contents,
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
 * تنسيق القناة بصيغة M3U احترافية وذكية
 */
function formatM3uEntry(url, channelNameAr, categoryAr, height) {
    const logoUrl = "https://upload.wikimedia.org/wikipedia/commons/d/d7/Bein_sport_ana_logo.png";
    let qualityStr = "";

    if (height >= 1080) {
        qualityStr = "1080p FHD";
    } else if (height >= 720) {
        qualityStr = "720p HD";
    } else if (height >= 480) {
        qualityStr = "480p SD";
    } else if (height > 0) {
        qualityStr = `${height}p`;
    } else {
        qualityStr = "جودة غير معروفة";
    }

    const groupTitle = `⭐ ${categoryAr} | ${qualityStr} ⭐`;

    return `# ${groupTitle}\n#EXTINF:-1 tvg-logo="${logoUrl}" group-title="${groupTitle}", ${channelNameAr}\n${url}`;
}

/**
 * دالة التخمين والفحص الرئيسية
 */
async function startScanning(baseUrl, startNum, count = 50) {
    console.log("[-] بدء فحص القنوات والتحقق منها عبر ذكاء Gemini الاصطناعي (البصري)...\n");
    let foundArabic = 0;

    for (let i = 0; i < count; i++) {
        const currentNum = startNum + i;
        const testUrl = `${baseUrl}${currentNum}.ts`;

        process.stdout.write(`[*] فحص الرابط: ${testUrl} -> `);

        const valid = await isValidStream(testUrl);

        if (valid) {
            console.log("✅ شغال! جاري التقاط صورة البث وتحليل القناة بالذكاء الاصطناعي...");

            const tempImgPath = path.join('/tmp', `frame_${currentNum}.jpg`);
            const { height } = await captureStreamFrameAndMeta(testUrl, tempImgPath);

            // استدعاء Gemini لتحليل الصورة والبث
            const analysis = await analyzeChannelWithGeminiVision(testUrl, height, tempImgPath);

            // مسح الصورة المؤقتة بعد التحليل
            if (fs.existsSync(tempImgPath)) {
                try { fs.unlinkSync(tempImgPath); } catch (e) {}
            }

            if (analysis.is_arabic) {
                foundArabic++;
                const channelName = analysis.channel_name || `قناة عربية ${foundArabic}`;
                const category = analysis.category || "قنوات عامة";

                console.log(`[+] قناة عربية مكتشفة: ${channelName} [تصنيف: ${category}] - الدقة: ${height}p`);

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
    await startScanning(BASE_URL, START_NUMBER, 50);
})();
