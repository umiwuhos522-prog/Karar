import axios from 'axios';
import { exec } from 'child_process';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';

// ==================== الإعدادات الأساسية ====================
const TELEGRAM_BOT_TOKEN = "7932535685:AAFNVyAPfmSCmHeptKAA0xc9779l8EethnQ";
const TELEGRAM_CHAT_ID = "6491999046";

// مفتاح Gemini API
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyDqlfbn5shYklhde9cn3dl_d-UwqPzmSs0";

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

let currentScanningUrl = "";
let currentScanningNum = 0;

process.on('uncaughtException', (err) => {
    console.error('[!] تم تفادي خطأ غير معالج:', err.message);
});

process.on('unhandledRejection', (reason) => {
    console.error('[!] تم تفادي رفض وعد غير معالج:', reason);
});

/**
 * تنفيذ الأوامر بأمان
 */
function safeExec(command, timeoutMs = 12000) {
    return new Promise((resolve) => {
        const child = exec(command, (err, stdout) => {
            if (err) resolve(null);
            else resolve(stdout);
        });

        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            resolve(null);
        }, timeoutMs);

        child.on('exit', () => clearTimeout(timer));
    });
}

/**
 * إرسال رسالة نصية لتليجرام
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
 * إرسال صورة ملتقطة لتليجرام
 */
async function sendTelegramPhoto(imagePath, caption) {
    if (!fs.existsSync(imagePath)) return;
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
    
    try {
        const formData = new FormData();
        formData.append('chat_id', TELEGRAM_CHAT_ID);
        formData.append('photo', fs.createReadStream(imagePath));
        formData.append('caption', caption);
        formData.append('parse_mode', 'HTML');

        await axios.post(url, formData, {
            headers: formData.getHeaders(),
            timeout: 15000
        });
    } catch (e) {
        console.log(`[!] فشل إرسال الصورة: ${e.message}`);
    }
}

/**
 * استخراج دقة الفيديو الحقيقية
 */
async function getStreamResolution(streamUrl) {
    const cmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of json "${streamUrl}"`;
    const stdout = await safeExec(cmd, 8000);
    
    if (stdout) {
        try {
            const data = JSON.parse(stdout);
            if (data.streams && data.streams.length > 0) {
                return {
                    width: data.streams[0].width || 1920,
                    height: data.streams[0].height || 1080
                };
            }
        } catch (e) {}
    }
    return { width: 1920, height: 1080 };
}

/**
 * التقاط صورة البث بسريعة وعالية الدقة
 */
async function captureLiveFrame(streamUrl, outputPath) {
    const cmd = `ffmpeg -y -hide_banner -loglevel error -ss 4 -i "${streamUrl}" -vframes 1 -q:v 1 "${outputPath}"`;
    await safeExec(cmd, 12000);

    if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        if (stats.size > 8000) return true;
    }
    return false;
}

/**
 * تحليل بصري بـ Gemini مع إعادة المحاولة التلقائية عند الوصول للحد الأقصى للحصة (Rate Limit Handling)
 */
async function analyzeScreenshotWithGemini(imagePath) {
    if (!fs.existsSync(imagePath)) return null;

    const prompt = `
    أنت نظام رؤية بصري دقيق جداً ومتخصص في استخراج أسماء قنوات IPTV بالكامل (Visual OCR Specialist).
    افحص صورة الشاشة المرفقة بدقة واقرأ الشعار أو النص الموجود في الزوايا:

    الشروط المطلوبة للرد:
    1. اكتب اسم القناة بالكامل وباللغة العربية مع مراعاة رقم القناة (إذا وجد):
       - مثال: beIN SPORTS 3 -> "بي إن سبورتس 3"
       - مثال: beIN SPORTS 1 -> "بي إن سبورتس 1"
       - مثال: SSC 1 HD -> "إس إس سي 1"
       - مثال: MBC Action -> "إم بي سي أكشن"
       - مثال: Rotana Cinema -> "روتانا سينما"
    2. حدد الفئة المناسبة بناءً على المحتوى وليس عشوائياً:
       (رياضة | مسلسلات وبرامج | أفلام عربية | أفلام أجنبية | أطفال وكرتون | إخبارية | وثائقية وثقافية)
    3. إذا لم يكن اسم القناة واضحاً ومؤكداً 100%، اكتب null في حقل channel_name.

    يجب رد النتيجة بصيغة JSON فقط:
    {
      "channel_name": "اسم القناة بالعربي مع الرقم الفعلي أو null",
      "category": "الفئة بالعربي",
      "language": "العربية"
    }
    `;

    // نظام حلقة لإعادة المحاولة عند حدوث خطأ 429 Quota Exceeded
    for (let attempt = 0; attempt < 3; attempt++) {
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
                config: { responseMimeType: "application/json" }
            });

            let text = response.text.trim().replace(/```json/g, '').replace(/```/g, '').trim();
            const data = JSON.parse(text);

            if (data.channel_name && data.channel_name !== "null" && data.channel_name !== "قناة غير معروفة") {
                return {
                    channel_name: data.channel_name,
                    category: data.category || "عام",
                    language: data.language || "العربية"
                };
            }
            return null;

        } catch (e) {
            if (e.message && e.message.includes('429')) {
                console.log(`⚠️ تجاوز حد الطلبات (429 Quota Exceeded). إيقاف مؤقت لمدة 35 ثانية لتجديد الحصة (المحاولة ${attempt + 1}/3)...`);
                await new Promise(res => setTimeout(res, 35000)); // انتظار 35 ثانية لحين فتح الحصة من جوجل
            } else {
                console.log(`[!] خطأ في Gemini: ${e.message}`);
                break;
            }
        }
    }
    return null;
}

/**
 * تنسيق M3U
 */
function formatM3uEntry(url, channelNameAr, categoryAr, qualityStr) {
    const logoUrl = "https://upload.wikimedia.org/wikipedia/commons/d/d7/Bein_sport_ana_logo.png";
    const groupTitle = `⭐ ${categoryAr} | ${qualityStr} ⭐`;

    return `# ${groupTitle}\n#EXTINF:-1 tvg-logo="${logoUrl}" group-title="${groupTitle}", ${channelNameAr}\n${url}`;
}

/**
 * مستمع أمر /start المباشر
 */
async function startTelegramBotListener() {
    let lastUpdateId = 0;
    while (true) {
        try {
            const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=5`;
            const response = await axios.get(url, { timeout: 10000 });

            if (response.data && response.data.result) {
                for (const update of response.data.result) {
                    lastUpdateId = update.update_id;
                    if (update.message && update.message.text === '/start') {
                        let caption = `<b>📊 الحالة المباشرة للفحص:</b>\n\n`;
                        caption += `🔗 <b>الرابط الحالي:</b> <code>${currentScanningUrl || "جاري البدء..."}</code>\n`;
                        caption += `🔢 <b>الرقم الحالي:</b> <code>${currentScanningNum}</code>\n`;

                        await sendTelegramMessage(caption);
                    }
                }
            }
        } catch (e) {}
        await new Promise(res => setTimeout(res, 3000));
    }
}

/**
 * فحص استجابة الرابط
 */
async function isValidStream(url) {
    try {
        const response = await axios.get(url, {
            timeout: 3500,
            responseType: 'stream',
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36' }
        });
        if (response.status !== 200) return false;
        response.data.destroy();
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * عملية الفحص المتسلسلة والمستقرة مع إدارة حكيمة لـ API Quota
 */
async function startScanning(baseUrl, startNum, count = 100000) {
    console.log("🟢 بدء عملية الفحص والتحليل الذكي دون توقف...");

    for (let i = 0; i < count; i++) {
        try {
            currentScanningNum = startNum + i;
            currentScanningUrl = `${baseUrl}${currentScanningNum}.ts`;

            process.stdout.write(`[*] فحص ${currentScanningNum} -> `);

            const valid = await isValidStream(currentScanningUrl);

            if (valid) {
                console.log("✅ شغال! الالتقاط والتحليل بـ Gemini...");

                const tempImgPath = path.join('/tmp', `frame_${currentScanningNum}.jpg`);
                const captured = await captureLiveFrame(currentScanningUrl, tempImgPath);

                if (captured) {
                    const res = await getStreamResolution(currentScanningUrl);
                    const qualityStr = res.height >= 1080 ? `${res.height}p FHD` : `${res.height}p HD`;

                    // تحليل الصورة بواسطة Gemini مع حماية السكريبت
                    const analysis = await analyzeScreenshotWithGemini(tempImgPath);

                    if (analysis && analysis.channel_name) {
                        const channelName = analysis.channel_name;
                        const category = analysis.category;
                        const language = analysis.language;

                        console.log(`[+] اسم القناة المؤكد: ${channelName} | ${category} | ${qualityStr}`);

                        const m3uEntry = formatM3uEntry(currentScanningUrl, channelName, category, qualityStr);

                        let caption = `✅ <b>قناة جديدة مكتشفة بـ Gemini!</b>\n\n`;
                        caption += `📺 <b>اسم القناة:</b> ${channelName}\n`;
                        caption += `🏷️ <b>الفئة:</b> ${category}\n`;
                        caption += `🗣️ <b>اللغة:</b> ${language}\n`;
                        caption += `📐 <b>الدقة:</b> ${qualityStr} (${res.width}x${res.height})`;

                        await sendTelegramPhoto(tempImgPath, caption);
                        await sendTelegramMessage(`<code>${m3uEntry}</code>`);
                    } else {
                        console.log("⚠️ تم يتجاوز القناة لعدم ثقة Gemini الكاملة بالشعار لتجنب الإرسال الخاطئ.");
                    }

                    if (fs.existsSync(tempImgPath)) {
                        try { fs.unlinkSync(tempImgPath); } catch (e) {}
                    }
                } else {
                    console.log("⚠️ تعذر التقاط الصورة.");
                }

                // فاصل زمن قدره 4 ثوانٍ بين الطلبات الشغالة للحفاظ على حصة API
                await new Promise(res => setTimeout(res, 4000));
            } else {
                console.log("❌ غير شغال");
            }
        } catch (loopError) {
            console.log(`[!] خطأ في الفحص: ${loopError.message}`);
        }
    }
}

// ==================== التشغيل ====================
(async () => {
    startTelegramBotListener();

    const BASE_URL = "http://xvip.pro/live/hend0815/08152023/";
    const START_NUMBER = 340315;
    await startScanning(BASE_URL, START_NUMBER, 100000);
})();
