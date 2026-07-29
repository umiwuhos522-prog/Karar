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
 * تنفيذ الأوامر مع حماية من التجميد
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
            timeout: 12000
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
    const stdout = await safeExec(cmd, 6000);
    
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
 * التقاط الصورة الكاملة + أخذ زاوية واسعة ومكبرة لضمان ألا يخرج الرقم عن الإطار
 */
async function captureLiveFrame(streamUrl, outputPath, cropCornerPath) {
    const cmdFull = `ffmpeg -y -hide_banner -loglevel error -ss 3 -i "${streamUrl}" -vframes 1 -q:v 1 "${outputPath}"`;
    await safeExec(cmdFull, 10000);

    if (fs.existsSync(outputPath)) {
        // اقتطاع واسع للربع العلوي الأيمن كاملاً مع تكبيره لضمان ظهور أي رقم بجوار الشعار
        const cmdCrop = `ffmpeg -y -hide_banner -loglevel error -i "${outputPath}" -vf "crop=in_w*0.5:in_h*0.35:in_w*0.5:0,scale=1000:-1" -q:v 1 "${cropCornerPath}"`;
        await safeExec(cmdCrop, 6000);
        return true;
    }
    return false;
}

/**
 * تحليل دقيق بـ Gemini بإرسال الصورتين معاً لضمان عدم الخلط في الرقم
 */
async function analyzeScreenshotWithGemini(fullImagePath, cropImagePath) {
    if (!fs.existsSync(fullImagePath)) return null;

    const prompt = `
    أنت نظام رؤية بصري دقيق جداً ومتخصص في تحديد وقراءة شعارات قنوات التلفزيون (IPTV Visual OCR).
    مرفق مع الطلب صورتان للحدث المباشر (الصورة الكاملة والصورة المكبرة للزاوية العليا).

    مهمتك الأساسية هي استخراج اسم القناة الدقيق باللغة العربية مع "الرقم الحقيقي" المكتوب بجوار اللوجو:
    1. اقرأ الرقم المكتوب بجانب الشعار بتركيز شديد (1, 2, 3, 4, 5, 6, 7, 8, 9, الإخبارية, Xtra, Premium).
    2. أمثلة دقيقة للتسمية:
       - إذا كان المكتوب 3: "بي إن سبورتس 3"
       - إذا كان المكتوب 2: "بي إن سبورتس 2"
       - إذا كان المكتوب 6: "بي إن سبورتس 6"
       - إذا كانت SSC مع رقم 1: "إس إس سي 1"
       - إذا لم تجد رقماً أبداً مكتوباً اكتب فقط: "بي إن سبورتس" (بدون إضافة رقم 1 تلقائياً!).
    3. حدد الفئة (رياضة | مسلسلات وبرامج | أفلام عربية | أفلام أجنبية | أطفال وكرتون | إخبارية | إسلامية).

    يجب رد النتيجة بصيغة JSON فقط بهذه الحقول:
    {
      "channel_name": "اسم القناة بالعربي مع الرقم الصحيح المكتشف",
      "category": "الفئة بالعربي",
      "language": "العربية"
    }
    `;

    try {
        const fullImageBuffer = fs.readFileSync(fullImagePath);
        const contents = [
            prompt,
            {
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: fullImageBuffer.toString('base64')
                }
            }
        ];

        // إذا كانت الصورة المكبرة موجودة نرفقها كـ Input إضافي لرفع الدقة
        if (fs.existsSync(cropImagePath)) {
            const cropImageBuffer = fs.readFileSync(cropImagePath);
            contents.push({
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: cropImageBuffer.toString('base64')
                }
            });
        }

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: contents,
            config: {
                responseMimeType: "application/json"
            }
        });

        let text = response.text.trim().replace(/```json/g, '').replace(/```/g, '').trim();
        const data = JSON.parse(text);

        if (data.channel_name) {
            return {
                channel_name: data.channel_name,
                category: data.category || "رياضة",
                language: data.language || "العربية"
            };
        }
        return null;
    } catch (e) {
        if (e.message && e.message.includes('429')) {
            console.log("⚠️ وصول للحد الأقصى للطلبات (429)، انتظار 4 ثوانٍ...");
            await new Promise(res => setTimeout(res, 4000));
        } else {
            console.log(`[!] خطأ تحليل Gemini: ${e.message}`);
        }
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
                        let caption = `<b>📊 التقرير المباشر:</b>\n\n`;
                        caption += `🔗 <b>الرابط الحالي:</b> <code>${currentScanningUrl || "جاري البدء..."}</code>\n`;
                        caption += `🔢 <b>الرقم الحالي:</b> <code>${currentScanningNum}</code>\n`;

                        await sendTelegramMessage(caption);
                    }
                }
            }
        } catch (e) {}
        await new Promise(res => setTimeout(res, 2500));
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
 * عملية الفحص الرئيسية
 */
async function startScanning(baseUrl, startNum, count = 100000) {
    await sendTelegramMessage("🟢 <b>تم تفعيل الفحص وتعريب أسماء القنوات وقراءة الأرقام بدقة متناهية!</b>");

    for (let i = 0; i < count; i++) {
        try {
            currentScanningNum = startNum + i;
            currentScanningUrl = `${baseUrl}${currentScanningNum}.ts`;

            process.stdout.write(`[*] فحص ${currentScanningNum} -> `);

            const valid = await isValidStream(currentScanningUrl);

            if (valid) {
                console.log("✅ شغال! جاري الالتقاط بزاويتين وتحليل الرقم بـ Gemini...");

                const tempImgPath = path.join('/tmp', `frame_${currentScanningNum}.jpg`);
                const cropImgPath = path.join('/tmp', `crop_${currentScanningNum}.jpg`);

                const captured = await captureLiveFrame(currentScanningUrl, tempImgPath, cropImgPath);

                if (captured) {
                    const res = await getStreamResolution(currentScanningUrl);
                    const qualityStr = res.height >= 1080 ? `${res.height}p FHD` : `${res.height}p HD`;

                    // تحليل الشعار بواسطة Gemini مع إرسال الصورتين
                    const analysis = await analyzeScreenshotWithGemini(tempImgPath, cropImgPath);

                    const channelName = analysis ? analysis.channel_name : "بي إن سبورتس";
                    const category = analysis ? analysis.category : "رياضة";
                    const language = analysis ? analysis.language : "العربية";

                    console.log(`[+] القناة المكتشفة: ${channelName} | ${category} | ${qualityStr}`);

                    const m3uEntry = formatM3uEntry(currentScanningUrl, channelName, category, qualityStr);

                    let caption = `✅ <b>قناة جديدة مكتشفة بـ Gemini!</b>\n\n`;
                    caption += `📺 <b>اسم القناة:</b> ${channelName}\n`;
                    caption += `🏷️ <b>الفئة:</b> ${category}\n`;
                    caption += `🗣️ <b>اللغة:</b> ${language}\n`;
                    caption += `📐 <b>الدقة:</b> ${qualityStr} (${res.width}x${res.height})`;

                    await sendTelegramPhoto(tempImgPath, caption);
                    await sendTelegramMessage(`<code>${m3uEntry}</code>`);

                    // تنظيف الصور المؤقتة
                    try { if (fs.existsSync(tempImgPath)) fs.unlinkSync(tempImgPath); } catch (e) {}
                    try { if (fs.existsSync(cropImgPath)) fs.unlinkSync(cropImgPath); } catch (e) {}
                } else {
                    console.log("⚠️ تعذر التقاط صورة البث.");
                }

                // انتظار 3 ثوانٍ لتفادي حظر الحصة
                await new Promise(res => setTimeout(res, 3000));
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
