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
 * استخراج الدقة والانتظار حتى يفتح البث لالتقاط صورة حقيقية واضحة
 */
function captureStreamFrameAndMeta(url, outputPath) {
    return new Promise((resolve) => {
        // 1. استخراج الدقة عبر ffprobe
        const metaCmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of json "${url}"`;
        exec(metaCmd, { timeout: 8000 }, (metaErr, stdout) => {
            let height = 0;
            try {
                const data = JSON.parse(stdout);
                if (data.streams && data.streams.length > 0) {
                    height = data.streams[0].height || 0;
                }
            } catch (e) {}

            // 2. الانتظار 3 ثوانٍ داخل البث (-ss 3) لتخطي اللون الأسود والتقاط صورة الشعار/المحتوى
            const captureCmd = `ffmpeg -y -ss 3 -i "${url}" -vframes 1 -q:v 2 "${outputPath}"`;
            exec(captureCmd, { timeout: 12000 }, (capErr) => {
                let hasValidImage = false;
                if (!capErr && fs.existsSync(outputPath)) {
                    const stats = fs.statSync(outputPath);
                    if (stats.size > 5000) { // التأكد أن حجم الصورة أكبر من 5 كيلوبايت (ليست سوداء أو فارغة)
                        hasValidImage = true;
                    }
                }
                resolve({ height, imageCaptured: hasValidImage });
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
            timeout: 6000,
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
 * تحليل دقيق جداً باستخدام Gemini 2.5 Flash من خلال رؤية الشاشة والشعار
 */
async function analyzeChannelWithGeminiVision(url, height, imagePath) {
    if (!imagePath || !fs.existsSync(imagePath)) {
        return null; // عدم التخمين إذا لم تتوفر صورة واضحة من البث
    }

    const prompt = `
    أنت نظام خبير ذكي جداً في التعرف البصري على شاشات وشعارات قنوات التلفزيون والبث المباشر (IPTV).
    افحص صورة الشاشة المرفقة جيداً (التقطت فوراً من البث) ثم حدد:
    
    1. اسم القناة الحقيقي والدقيق جداً باللغة العربية بناءً على اللوجو أو النص الموجود بالشاشة (مثل: "beIN Sports 1", "MBC 1", "روتانا سينما", "سبيستون", "الجزيرة", "SSC Sports 1", إلخ).
    2. هل القناة عربية أو تبث باللغة العربية أو مترجمة للعربية؟
    3. تصنيف القناة الدقيق جداً باللغة العربية:
       - "رياضية"
       - "مسلسلات"
       - "أفلام عربية"
       - "أفلام أجنبية"
       - "أطفال وكرتون"
       - "إخبارية"
       - "إسلامية"

    يجب أن ترسل الإجابة فقط بصيغة JSON بالنص التالي دون إضافة أي كلام آخر:
    {
      "is_arabic": true or false,
      "channel_name": "اسم القناة الحقيقي بالعربي",
      "category": "التصنيف الدقيق"
    }
    `;

    try {
        const imageBuffer = fs.readFileSync(imagePath);
        const contents = [
            prompt,
            {
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: imageBuffer.toString('base64')
                }
            }
        ];

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
        console.log(`[!] خطأ أثناء التحليل البصري بـ Gemini: ${e.message}`);
        return null;
    }
}

/**
 * تنسيق القناة بصيغة M3U الاحترافية
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
        qualityStr = "جودة عالية";
    }

    const groupTitle = `⭐ ${categoryAr} | ${qualityStr} ⭐`;

    return `# ${groupTitle}\n#EXTINF:-1 tvg-logo="${logoUrl}" group-title="${groupTitle}", ${channelNameAr}\n${url}`;
}

/**
 * دالة التخمين والفحص الرئيسية
 */
async function startScanning(baseUrl, startNum, count = 50) {
    console.log("[-] بدء فحص القنوات والتحقق الدقيق من الشاشة عبر Gemini...\n");
    let foundArabic = 0;

    for (let i = 0; i < count; i++) {
        const currentNum = startNum + i;
        const testUrl = `${baseUrl}${currentNum}.ts`;

        process.stdout.write(`[*] جاري فحص الرابط: ${testUrl} -> `);

        const valid = await isValidStream(testUrl);

        if (valid) {
            console.log("✅ شغال! الانتظار 3 ثوانٍ لالتقاط صورة الشاشة وتحليلها...");

            const tempImgPath = path.join('/tmp', `frame_${currentNum}.jpg`);
            const { height, imageCaptured } = await captureStreamFrameAndMeta(testUrl, tempImgPath);

            if (imageCaptured) {
                // استدعاء Gemini بعد ضمان التقاط الصورة
                const analysis = await analyzeChannelWithGeminiVision(testUrl, height, tempImgPath);

                // مسح الصورة المؤقتة
                if (fs.existsSync(tempImgPath)) {
                    try { fs.unlinkSync(tempImgPath); } catch (e) {}
                }

                if (analysis && analysis.is_arabic) {
                    foundArabic++;
                    const channelName = analysis.channel_name;
                    const category = analysis.category;

                    console.log(`[+] قناة عربية مؤكدة: ${channelName} [${category}] - الجودة: ${height}p`);

                    const m3uEntry = formatM3uEntry(testUrl, channelName, category, height);
                    await sendTelegramMessage(`<code>${m3uEntry}</code>`);
                } else {
                    console.log("[-] ليست قناة عربية أو تعذر التثبت من اللوجو.");
                }
            } else {
                console.log("⚠️ تعذر التقاط صورة البث (فيديو فارغ أو بطيء جداً).");
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
