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

// حماية الكود من الانهيار مفاجئ لأي سبب
process.on('uncaughtException', (err) => {
    console.error('[!] تم تفادي خطأ غير معالج:', err.message);
});

process.on('unhandledRejection', (reason) => {
    console.error('[!] تم تفادي رفض وعد غير معالج:', reason);
});

/**
 * دالة تنفيذ الأوامر مع إجبار الإنهاء في حال التجمّد
 */
function safeExec(command, timeoutMs = 10000) {
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
    } catch (e) {
        console.log(`[!] فشل إرسال رسالة تليجرام: ${e.message}`);
    }
}

/**
 * إرسال صورة ملتقطة لتليجرام مع التقرير النصي
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
 * استخراج دقة الفيديو الحقيقية (Height & Width) عبر ffprobe
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
 * التقاط صورة عالية الجودة من البث
 */
async function captureLiveFrame(streamUrl, outputPath) {
    const cmd = `ffmpeg -y -hide_banner -loglevel error -ss 3 -i "${streamUrl}" -vframes 1 -q:v 2 "${outputPath}"`;
    await safeExec(cmd, 12000);

    if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        if (stats.size > 8000) return true;
    }
    return false;
}

/**
 * تحليل بصري صارم بـ Gemini لقراءة اسم القناة والشعار والدقة بدقة متناهية
 */
async function analyzeScreenshotWithGemini(imagePath) {
    if (!fs.existsSync(imagePath)) return null;

    const prompt = `
    أنت نظام رؤية حاسوبية وخبير متخصص جداً في تحليل وقراءة شعارات قنوات التلفزيون (IPTV Visual OCR).
    افحص صورة شاشة البث المباشر المرفقة جيداً وركز على الزوايا والشعارات وشريط العرض.

    ركز بشكل خاص على:
    - الشعارات الشهيرة مثل (beIN SPORTS 1, beIN SPORTS 2, MBC 1, MBC ACTION, SSC 1, Rotana Cinema, Al Jazeera, Spacetoon, إلخ).
    - إذا كانت مباريات كرة قدم أو رياضة، تأكد من اسم القناة الناقلة المعروض في الشاشة.

    يجب أداء التحليل وإرجاع نتيجة بصيغة JSON فقط بهذه الحقول المحددة:
    {
      "channel_name": "اسم القناة الحقيقي بالعربي والإنجليزي بدقة متناهية",
      "category": "اختر فقط تصنيف واحد مناسب: (رياضة | مسلسلات وبرامج | أفلام عربية | أفلام أجنبية ورعب | أطفال وكرتون | إخبارية وثائقية | إسلامية)",
      "language": "اللغة المستخدمة (العربية / الإنجليزية / مترجم للعربية)",
      "is_arabic": true
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

        const text = response.text.trim();
        const data = JSON.parse(text);

        return {
            channel_name: data.channel_name || "قناة غير معروفة",
            category: data.category || "عام",
            language: data.language || "العربية",
            is_arabic: data.is_arabic !== undefined ? data.is_arabic : true
        };
    } catch (e) {
        console.log(`[!] خطأ تحليل Gemini: ${e.message}`);
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
 * مستمع أمر /start المباشر بشكل آمن لا يسبّب تجميد الكود
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
                        let caption = `<b>📊 تقرير الفحص المباشر الحظي:</b>\n\n`;
                        caption += `🔗 <b>الرابط قيد الفحص:</b> <code>${currentScanningUrl || "جاري البدء..."}</code>\n`;
                        caption += `🔢 <b>الرقم الحالي:</b> <code>${currentScanningNum}</code>\n`;
                        caption += `📸 <i>جاري التقاط الشاشة وتحليل الشعار بـ Gemini...</i>`;

                        await sendTelegramMessage(caption);

                        if (currentScanningUrl) {
                            const instantImgPath = path.join('/tmp', `instant_${currentScanningNum}.jpg`);
                            const success = await captureLiveFrame(currentScanningUrl, instantImgPath);

                            if (success && fs.existsSync(instantImgPath)) {
                                const res = await getStreamResolution(currentScanningUrl);
                                const analysis = await analyzeScreenshotWithGemini(instantImgPath);

                                const qualityStr = res.height >= 1080 ? `${res.height}p FHD` : `${res.height}p HD`;
                                const channelName = analysis ? analysis.channel_name : "قناة غير معروفة";
                                const category = analysis ? analysis.category : "عام";
                                const language = analysis ? analysis.language : "العربية";

                                let infoMsg = `✅ <b>تقرير Gemini الحقيقي للبث:</b>\n\n`;
                                infoMsg += `📺 <b>اسم القناة:</b> ${channelName}\n`;
                                infoMsg += `🏷️ <b>الفئة:</b> ${category}\n`;
                                infoMsg += `🗣️ <b>اللغة:</b> ${language}\n`;
                                infoMsg += `📐 <b>الدقة:</b> ${qualityStr} (${res.width}x${res.height})\n`;

                                const m3uEntry = formatM3uEntry(currentScanningUrl, channelName, category, qualityStr);

                                await sendTelegramPhoto(instantImgPath, infoMsg);
                                await sendTelegramMessage(`<code>${m3uEntry}</code>`);

                                try { fs.unlinkSync(instantImgPath); } catch (e) {}
                            }
                        }
                    }
                }
            }
        } catch (e) {}
        
        // الانتظار ثانيتين قبل الطلب التالي لتجنب ضغط الشبكة
        await new Promise(res => setTimeout(res, 2000));
    }
}

/**
 * فحص الاستجابة الأولية
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
 * عملية الفحص المتسلسلة المضمنة بحماية كاملة من التوقف
 */
async function startScanning(baseUrl, startNum, count = 10000) {
    await sendTelegramMessage("🟢 <b>تم تفعيل الفحص الدقيق والتحليل البصري المستمر بـ Gemini!</b>");

    for (let i = 0; i < count; i++) {
        try {
            currentScanningNum = startNum + i;
            currentScanningUrl = `${baseUrl}${currentScanningNum}.ts`;

            process.stdout.write(`[*] فحص ${currentScanningNum} -> `);

            const valid = await isValidStream(currentScanningUrl);

            if (valid) {
                console.log("✅ شغال! جاري استخراج الصورة والدقة...");

                const tempImgPath = path.join('/tmp', `frame_${currentScanningNum}.jpg`);
                const captured = await captureLiveFrame(currentScanningUrl, tempImgPath);

                if (captured) {
                    const res = await getStreamResolution(currentScanningUrl);
                    const qualityStr = res.height >= 1080 ? `${res.height}p FHD` : `${res.height}p HD`;

                    console.log("📸 تم التقاط الصورة! جاري التحليل بـ Gemini...");
                    const analysis = await analyzeScreenshotWithGemini(tempImgPath);

                    const channelName = analysis ? analysis.channel_name : "قناة غير محددة";
                    const category = analysis ? analysis.category : "عام";
                    const language = analysis ? analysis.language : "العربية";

                    console.log(`[+] مكتشفة: ${channelName} [${category}] - الدقة: ${res.height}p`);

                    const m3uEntry = formatM3uEntry(currentScanningUrl, channelName, category, qualityStr);

                    let caption = `✅ <b>قناة جديدة مكتشفة بـ Gemini!</b>\n\n`;
                    caption += `📺 <b>اسم القناة:</b> ${channelName}\n`;
                    caption += `🏷️ <b>الفئة:</b> ${category}\n`;
                    caption += `🗣️ <b>اللغة:</b> ${language}\n`;
                    caption += `📐 <b>الدقة:</b> ${qualityStr} (${res.width}x${res.height})`;

                    await sendTelegramPhoto(tempImgPath, caption);
                    await sendTelegramMessage(`<code>${m3uEntry}</code>`);

                    if (fs.existsSync(tempImgPath)) {
                        try { fs.unlinkSync(tempImgPath); } catch (e) {}
                    }
                } else {
                    console.log("⚠️ تعذر التقاط صورة ملونة من الفيديو.");
                }
            } else {
                console.log("❌ الرابط مغلق/غير شغال");
            }
        } catch (loopError) {
            console.log(`[!] خطأ مؤقت في الدورة الحاليّة (تم تجاوزه): ${loopError.message}`);
        }
    }
}

// ==================== التشغيل ====================
(async () => {
    // تشغيل مستمع البوت في الخلفية
    startTelegramBotListener();

    const BASE_URL = "http://xvip.pro/live/hend0815/08152023/";
    const START_NUMBER = 340315;
    
    // عدد الفحوصات زاد إلى 100,000 ليستمر لفترات طويلة جداً
    await startScanning(BASE_URL, START_NUMBER, 100000);
})();
