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
 * التقاط صورة من البث مع وجود مهلة أمان لمنع التجمد
 */
function captureStreamFrameAndMeta(url, outputPath) {
    return new Promise((resolve) => {
        let isResolved = false;

        // مهلة أمان عامة 10 ثوانٍ
        const timer = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                resolve({ height: 1080, imageCaptured: false });
            }
        }, 10000);

        const captureCmd = `ffmpeg -y -ss 2 -i "${url}" -vframes 1 -q:v 3 "${outputPath}"`;
        exec(captureCmd, { timeout: 8000 }, (capErr) => {
            if (isResolved) return;
            clearTimeout(timer);
            isResolved = true;

            let hasValidImage = false;
            if (!capErr && fs.existsSync(outputPath)) {
                const stats = fs.statSync(outputPath);
                if (stats.size > 3000) {
                    hasValidImage = true;
                }
            }
            resolve({ height: 1080, imageCaptured: hasValidImage });
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
 * تحليل دقيق عبر Gemini 2.5 Flash من خلال رؤية الصورة
 */
async function analyzeChannelWithGeminiVision(url, height, imagePath) {
    const prompt = `
    أنت نظام خبير ذكي في التعرف البصري على شعارات وقنوات البث المباشر (IPTV).
    افحص صورة الشاشة المرفقة جيداً وحدد:
    
    1. اسم القناة الحقيقي والدقيق باللغة العربية (مثل: "beIN Sports 1", "MBC 1", "روتانا سينما", "سبيستون", "الجزيرة", "SSC Sports 1").
    2. هل القناة عربية أو مترجمة للعربية؟
    3. تصنيف القناة: ("رياضة", "مسلسلات", "أفلام عربية", "أفلام أجنبية ورعب", "أطفال وكرتون", "إخبارية", "إسلامية").

    أرسل الإجابة فقط بصيغة JSON دون أي نص آخر:
    {
      "is_arabic": true,
      "channel_name": "اسم القناة بالعربي",
      "category": "التصنيف"
    }
    `;

    try {
        let contents = [prompt];

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
        return null;
    }
}

/**
 * تنسيق M3U
 */
function formatM3uEntry(url, channelNameAr, categoryAr, height) {
    const logoUrl = "https://upload.wikimedia.org/wikipedia/commons/d/d7/Bein_sport_ana_logo.png";
    const groupTitle = `⭐ ${categoryAr} | 1080p FHD ⭐`;

    return `# ${groupTitle}\n#EXTINF:-1 tvg-logo="${logoUrl}" group-title="${groupTitle}", ${channelNameAr}\n${url}`;
}

/**
 * دالة التخمين الرئيسية
 */
async function startScanning(baseUrl, startNum, count = 100) {
    console.log("[-] بدء فحص القنوات والتحقق الدقيق عبر Gemini...\n");
    let foundArabic = 0;

    for (let i = 0; i < count; i++) {
        const currentNum = startNum + i;
        const testUrl = `${baseUrl}${currentNum}.ts`;

        process.stdout.write(`[*] فحص الرابط: ${testUrl} -> `);

        const valid = await isValidStream(testUrl);

        if (valid) {
            console.log("✅ شغال! جاري التقاط الشاشة والتحليل...");

            const tempImgPath = path.join('/tmp', `frame_${currentNum}.jpg`);
            const { height, imageCaptured } = await captureStreamFrameAndMeta(testUrl, tempImgPath);

            const analysis = await analyzeChannelWithGeminiVision(testUrl, height, imageCaptured ? tempImgPath : null);

            if (fs.existsSync(tempImgPath)) {
                try { fs.unlinkSync(tempImgPath); } catch (e) {}
            }

            if (analysis && analysis.is_arabic) {
                foundArabic++;
                const channelName = analysis.channel_name || `قناة عربية ${foundArabic}`;
                const category = analysis.category || "قنوات عامة";

                console.log(`[+] مكتشفة: ${channelName} [${category}]`);

                const m3uEntry = formatM3uEntry(testUrl, channelName, category, height);
                await sendTelegramMessage(`<code>${m3uEntry}</code>`);
            } else {
                console.log("[-] ليست قناة عربية أو تعذر التعرف عليها.");
            }
        } else {
            console.log("❌ غير شغال");
        }
    }
}

// ==================== التشغيل ====================
(async () => {
    const BASE_URL = "http://xvip.pro/live/hend0815/08152023/";
    const START_NUMBER = 340315;
    await startScanning(BASE_URL, START_NUMBER, 100);
})();
