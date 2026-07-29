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
 * تنفيذ الأوامر مع حماية من التعليق
 */
function safeExec(command, timeoutMs = 15000) {
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
 * التقاط صورة عالية الجودة عند ثوانٍ مختلفة لضمان وضوح الشعار
 */
async function captureLiveFrame(streamUrl, outputPath, seekSeconds = 6) {
    const cmd = `ffmpeg -y -hide_banner -loglevel error -ss ${seekSeconds} -i "${streamUrl}" -vframes 1 -vf "unsharp=5:5:1.0:5:5:0.0" -q:v 1 "${outputPath}"`;
    await safeExec(cmd, 15000);

    if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        if (stats.size > 8000) return true;
    }
    return false;
}

/**
 * تحليل بصري دقيق جداً بـ Gemini مع التأكد التام من هوية القناة
 */
async function analyzeScreenshotWithGemini(imagePath) {
    if (!fs.existsSync(imagePath)) return null;

    const prompt = `
    أنت نظام رؤية ذكي متقدم جداً ومخصص للتعرف على شعارات قنوات التلفزيون المباشرة (IPTV OCR & Channel Identification).
    افحص صورة الشاشة المرفقة بدقة فائقة:

    - ابحث في الزوايا الأربع (خاصة الزاوية العليا اليمنى واليسرى، والشريط السفلي).
    - ابحث عن شعارات شهيرة مثل: beIN SPORTS (1..9, News, Global), SSC, MBC, Abu Dhabi Sports, Alkass, Rotana, Al Jazeera, OnTime Sports.
    - إذا كانت الصورة تعبر عن مباراة كرة قدم أو رياضة، تأكد من اسم القناة الناقلة المعروضة على الشاشة واستنتج الفئة كـ "رياضة".

    تعليمات صارمة:
    إذا لم تتمكن من تحديد اسم القناة بشكل مؤكد 100%، اترك حقل "channel_name" فارغاً أو اكتب null. لا تقم بتأليف أو تخمين اسم إذا لم يكن واضحاً.

    قم بالرد حصراً بصيغة JSON التالية:
    {
      "channel_name": "اسم القناة المؤكد فقط أو null",
      "category": "اختر إحدى الفئات: (رياضة | مسلسلات وبرامج | أفلام عربية | أفلام أجنبية | أطفال وكرتون | إخبارية وثائقية | إسلامية)",
      "language": "اللغة (العربية / الإنجليزية)"
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
            config: {
                responseMimeType: "application/json"
            }
        });

        let text = response.text.trim().replace(/```json/g, '').replace(/```/g, '').trim();
        const data = JSON.parse(text);

        // التحقق من صحة القناة المكتشفة وعدم قبول الإجابات المبهمة
        if (data.channel_name && 
            data.channel_name !== "null" && 
            !data.channel_name.includes("غير محددة") && 
            !data.channel_name.includes("غير معروفة")) {
            
            return {
                channel_name: data.channel_name,
                category: data.category || "رياضة",
                language: data.language || "العربية"
            };
        }
        return null;
    } catch (e) {
        return null;
    }
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
                        let caption = `<b>📊 حالة الفحص الحالي:</b>\n\n`;
                        caption += `🔗 <b>الرابط:</b> <code>${currentScanningUrl || "جاري البدء..."}</code>\n`;
                        caption += `🔢 <b>الرقم:</b> <code>${currentScanningNum}</code>\n`;

                        await sendTelegramMessage(caption);
                    }
                }
            }
        } catch (e) {}
        await new Promise(res => setTimeout(res, 2000));
    }
}

/**
 * فحص استجابة الرابط
 */
async function isValidStream(url) {
    try {
        const response = await axios.get(url, {
            timeout: 4000,
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
 * عملية التدقيق والانتظار قبل الإرسال
 */
async function startScanning(baseUrl, startNum, count = 100000) {
    await sendTelegramMessage("🟢 <b>تم تفعيل نظام التمييز الصارم بـ Gemini! (لن يتم إرسال أي قناة إلا بعد التأكد التام من اسمها وفئتها)</b>");

    for (let i = 0; i < count; i++) {
        try {
            currentScanningNum = startNum + i;
            currentScanningUrl = `${baseUrl}${currentScanningNum}.ts`;

            process.stdout.write(`[*] فحص ${currentScanningNum} -> `);

            const valid = await isValidStream(currentScanningUrl);

            if (valid) {
                console.log("✅ شغال! جاري بدء عملية التدقيق والتحليل...");

                const tempImgPath = path.join('/tmp', `frame_${currentScanningNum}.jpg`);
                let verifiedAnalysis = null;
                
                // أوقات لالتقاط صور متتابعة في حال كانت لقطة معينة غير واضحة
                const seekTimes = [5, 10, 15];

                for (const seekSec of seekTimes) {
                    console.log(`📸 جاري الالتقاط عند الثانية (${seekSec}) للتدقيق...`);
                    const captured = await captureLiveFrame(currentScanningUrl, tempImgPath, seekSec);

                    if (captured) {
                        // طلب تحليل من Gemini
                        const analysis = await analyzeScreenshotWithGemini(tempImgPath);

                        if (analysis) {
                            verifiedAnalysis = analysis;
                            console.log(`🎯 تم التعرف بدقة على القناة: ${analysis.channel_name}`);
                            break; // تم التأكد بنجاح، اخرج من حلقة إعادة المحاولات
                        } else {
                            console.log(`⏳ لم يتأكد Gemini من الشعار، سيتم التأخير وإعادة الالتقاط...`);
                            await new Promise(res => setTimeout(res, 3000)); // تأخير 3 ثوانٍ قبل المحاولة التالية
                        }
                    }
                }

                // شرط حاسم: إرسال النتيجة للبوت فقط وفقط إذا تم التعرف التام على القناة
                if (verifiedAnalysis) {
                    const res = await getStreamResolution(currentScanningUrl);
                    const qualityStr = res.height >= 1080 ? `${res.height}p FHD` : `${res.height}p HD`;

                    const channelName = verifiedAnalysis.channel_name;
                    const category = verifiedAnalysis.category;
                    const language = verifiedAnalysis.language;

                    const m3uEntry = formatM3uEntry(currentScanningUrl, channelName, category, qualityStr);

                    let caption = `✅ <b>تم اكتشاف قناة وتدقيقها بـ Gemini!</b>\n\n`;
                    caption += `📺 <b>اسم القناة:</b> ${channelName}\n`;
                    caption += `🏷️ <b>الفئة:</b> ${category}\n`;
                    caption += `🗣️ <b>اللغة:</b> ${language}\n`;
                    caption += `📐 <b>الدقة:</b> ${qualityStr} (${res.width}x${res.height})`;

                    await sendTelegramPhoto(tempImgPath, caption);
                    await sendTelegramMessage(`<code>${m3uEntry}</code>`);
                } else {
                    console.log(`❌ تم التجاوز: لم يتم التأكد من هوية القناة بعد عدة محاولات (لتفادي إرسال بيانات خاطئة).`);
                }

                if (fs.existsSync(tempImgPath)) {
                    try { fs.unlinkSync(tempImgPath); } catch (e) {}
                }

            } else {
                console.log("❌ الرابط غير شغال");
            }
        } catch (loopError) {
            console.log(`[!] خطأ في الفحص (تم تجاوزه): ${loopError.message}`);
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
