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
 * التقاط صورة عالية الجودة وواضحة جداً المعالم
 */
async function captureLiveFrame(streamUrl, outputPath, seekTime = 5) {
    // تم زيادة الجودة واستخدام الفلترة لرفع حدة اللوجو وحوافه
    const cmd = `ffmpeg -y -hide_banner -loglevel error -ss ${seekTime} -i "${streamUrl}" -vframes 1 -vf "unsharp=5:5:1.0:5:5:0.0" -q:v 1 "${outputPath}"`;
    await safeExec(cmd, 15000);

    if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        if (stats.size > 8000) return true;
    }
    return false;
}

/**
 * تحليل بصري بـ Gemini مع التركيز الشديد على قنوات beIN والشعارات الرياضية
 */
async function analyzeScreenshotWithGemini(imagePath) {
    if (!fs.existsSync(imagePath)) return null;

    const prompt = `
    أنت خبير محترف في التعرف على شعارات وقنوات التلفزيون المباشرة (IPTV TV Channel & Logo OCR).
    افحص صورة الشاشة المرفقة بدقة عالية:
    1. ابحث في الزوايا الأربع (خاصة الزاوية العليا اليمنى والشرائط العلوية/السفلية) عن اسم القناة أو اللوجو.
    2. القنوات الرياضية الشائعة هي: beIN SPORTS (1 to 9, News, Xtra), SSC (1 to 8), Abu Dhabi Sports, Alkass, OnTime Sports.
    3. إذا كان المشهد يحتوي على ملعب كرة قدم، أو مباراة، أو نتيجة مباراة، فالفئة تلقائياً هي "رياضة".
    4. إذا رأيت مسلسلاً أو دراما، فالفئة "مسلسلات وبرامج".
    5. إذا كان فيلم فحدد هل هو "أفلام عربية" أو "أفلام أجنبية".

    قم بالرد حصراً بصيغة JSON التالية:
    {
      "channel_name": "اسم القناة بالضبط (مثال: beIN SPORTS 1 HD, MBC 1, SSC 1 HD)",
      "category": "إحدى الفئات التالية فقط: (رياضة | مسلسلات وبرامج | أفلام عربية | أفلام أجنبية | أطفال وكرتون | إخبارية | إسلامية)",
      "language": "العربية أو الإنجليزية"
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

        let text = response.text.trim();
        // تنظيف الاستجابة لو حوت markdown
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();

        const data = JSON.parse(text);

        if (data.channel_name && data.channel_name !== "قناة غير معروفة") {
            return {
                channel_name: data.channel_name,
                category: data.category || "رياضة",
                language: data.language || "العربية"
            };
        }
        return null;
    } catch (e) {
        console.log(`[!] خطأ في تحليل Gemini: ${e.message}`);
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
                        let caption = `<b>📊 تقرير الفحص المباشر الحظي:</b>\n\n`;
                        caption += `🔗 <b>الرابط قيد الفحص:</b> <code>${currentScanningUrl || "جاري البدء..."}</code>\n`;
                        caption += `🔢 <b>الرقم الحالي:</b> <code>${currentScanningNum}</code>\n`;

                        await sendTelegramMessage(caption);

                        if (currentScanningUrl) {
                            const instantImgPath = path.join('/tmp', `instant_${currentScanningNum}.jpg`);
                            const success = await captureLiveFrame(currentScanningUrl, instantImgPath, 4);

                            if (success && fs.existsSync(instantImgPath)) {
                                const res = await getStreamResolution(currentScanningUrl);
                                let analysis = await analyzeScreenshotWithGemini(instantImgPath);

                                const qualityStr = res.height >= 1080 ? `${res.height}p FHD` : `${res.height}p HD`;
                                const channelName = analysis ? analysis.channel_name : "قناة غير محددة";
                                const category = analysis ? analysis.category : "عام";

                                let infoMsg = `✅ <b>تقرير البث الحالي:</b>\n\n`;
                                infoMsg += `📺 <b>اسم القناة:</b> ${channelName}\n`;
                                infoMsg += `🏷️ <b>الفئة:</b> ${category}\n`;
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
        await new Promise(res => setTimeout(res, 2000));
    }
}

/**
 * فحص هل الرابط شغال
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
 * عملية الفحص المتسلسلة مع إعادة المحاولة لتأكيد اسم القناة
 */
async function startScanning(baseUrl, startNum, count = 100000) {
    await sendTelegramMessage("🟢 <b>تم تفعيل الفحص والتدقيق العالي بـ Gemini!</b>");

    for (let i = 0; i < count; i++) {
        try {
            currentScanningNum = startNum + i;
            currentScanningUrl = `${baseUrl}${currentScanningNum}.ts`;

            process.stdout.write(`[*] فحص ${currentScanningNum} -> `);

            const valid = await isValidStream(currentScanningUrl);

            if (valid) {
                console.log("✅ شغال! جاري التقاط الصورة والتحليل...");

                const tempImgPath = path.join('/tmp', `frame_${currentScanningNum}.jpg`);
                let captured = await captureLiveFrame(currentScanningUrl, tempImgPath, 3);

                if (captured) {
                    const res = await getStreamResolution(currentScanningUrl);
                    const qualityStr = res.height >= 1080 ? `${res.height}p FHD` : `${res.height}p HD`;

                    // المحاولة الأولى للتحليل
                    let analysis = await analyzeScreenshotWithGemini(tempImgPath);

                    // إذا لم يكتشف Gemini القناة، نحاول إعادة الالتقاط بعد ثانيتين ثافيتين للحصول على فريم أوضح
                    if (!analysis) {
                        console.log("⚠️ المحاولة الأولى لم تكتشف الاسم، جاري إعادة الالتقاط بلقطة أوضح...");
                        captured = await captureLiveFrame(currentScanningUrl, tempImgPath, 7);
                        if (captured) {
                            analysis = await analyzeScreenshotWithGemini(tempImgPath);
                        }
                    }

                    const channelName = analysis ? analysis.channel_name : "قناة غير محددة";
                    const category = analysis ? analysis.category : "عام";
                    const language = analysis ? analysis.language : "العربية";

                    console.log(`[+] النتيجة: ${channelName} [${category}] - الدقة: ${res.height}p`);

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
                    console.log("⚠️ تعذر التقاط صورة الفيديو.");
                }
            } else {
                console.log("❌ الرابط مغلق/غير شغال");
            }
        } catch (loopError) {
            console.log(`[!] خطأ مؤقت: ${loopError.message}`);
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
