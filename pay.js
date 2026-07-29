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
            timeout: 12000
        });
    } catch (e) {
        console.log(`[!] فشل إرسال الصورة: ${e.message}`);
    }
}

/**
 * استخراج دقة الفيديو الحقيقية (Height & Width) عبر ffprobe
 */
function getStreamResolution(streamUrl) {
    return new Promise((resolve) => {
        const cmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of json "${streamUrl}"`;
        exec(cmd, { timeout: 8000 }, (err, stdout) => {
            if (!err) {
                try {
                    const data = JSON.parse(stdout);
                    if (data.streams && data.streams.length > 0) {
                        return resolve({
                            width: data.streams[0].width || 1920,
                            height: data.streams[0].height || 1080
                        });
                    }
                } catch (e) {}
            }
            resolve({ width: 1920, height: 1080 });
        });
    });
}

/**
 * التقاط صورة من البث المباشر
 */
function captureLiveFrame(streamUrl, outputPath) {
    return new Promise((resolve) => {
        const cmd = `ffmpeg -y -hide_banner -loglevel error -ss 3 -i "${streamUrl}" -vframes 1 -q:v 2 "${outputPath}"`;

        exec(cmd, { timeout: 15000 }, (error) => {
            if (fs.existsSync(outputPath)) {
                const stats = fs.statSync(outputPath);
                if (stats.size > 8000) {
                    return resolve(true);
                }
            }
            resolve(false);
        });
    });
}

/**
 * قراءة وتحليل لقطة الشاشة بـ Gemini بطريقة مرنة ومباشرة
 */
async function analyzeScreenshotWithGemini(imagePath) {
    if (!fs.existsSync(imagePath)) return null;

    const prompt = `
    شاهد صورة شاشة البث المباشر المرفقة بتمعن واستخرج المعلومات التالية فقط باللغة العربية:
    1. اسم القناة الحقيقي والواضح في اللوجو أو الشاشة (مثلاً: beIN Sports 1, beIN Sports 2, MBC 1, روتانا, سبيستون, SSC 1, إلخ).
    2. الفئة والتصنيف (اختر واحد فقط: رياضة | مسلسلات وبرامج | أفلام عربية | أفلام أجنبية ورعب | أطفال وكرتون | إخبارية | إسلامية).
    3. اللغة (مثل: العربية, الإنجليزية, مترجم للعربية).

    اكتب الرد بهذه الصيغة البسيطة بدون أي كود أو رموز إضافية:
    اسم القناة: [اسم القناة هنا]
    الفئة: [الفئة هنا]
    اللغة: [اللغة هنا]
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

        const text = response.text.trim();
        
        // استخراج المعلومات بالنصوص المباشرة
        let channelName = "قناة رياضية / منوعة";
        let category = "رياضة";
        let language = "العربية";

        const nameMatch = text.match(/اسم القناة:\s*(.+)/);
        if (nameMatch) channelName = nameMatch[1].trim();

        const catMatch = text.match(/الفئة:\s*(.+)/);
        if (catMatch) category = catMatch[1].trim();

        const langMatch = text.match(/اللغة:\s*(.+)/);
        if (langMatch) language = langMatch[1].trim();

        return {
            channel_name: channelName,
            category: category,
            language: language
        };
    } catch (e) {
        console.log(`[!] خطأ تحليل Gemini: ${e.message}`);
        return {
            channel_name: "قناة بث مباشر",
            category: "عامة",
            language: "العربية"
        };
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
 * مستمع أمر /start المباشر مع التقرير الشامل
 */
async function startTelegramBotListener() {
    let lastUpdateId = 0;
    setInterval(async () => {
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
                        caption += `📸 <i>جاري التقاط الشاشة وتحليل البث بـ Gemini...</i>`;

                        await sendTelegramMessage(caption);

                        if (currentScanningUrl) {
                            const instantImgPath = path.join('/tmp', `instant_${currentScanningNum}.jpg`);
                            const success = await captureLiveFrame(currentScanningUrl, instantImgPath);

                            if (success && fs.existsSync(instantImgPath)) {
                                const res = await getStreamResolution(currentScanningUrl);
                                const analysis = await analyzeScreenshotWithGemini(instantImgPath);

                                const channelName = analysis ? analysis.channel_name : "قناة بث مباشر";
                                const category = analysis ? analysis.category : "عامة";
                                const language = analysis ? analysis.language : "العربية";
                                const qualityStr = `${res.height}p (${res.width}x${res.height})`;

                                let infoMsg = `✅ <b>تقرير Gemini للبث المباشر:</b>\n\n`;
                                infoMsg += `📺 <b>اسم القناة:</b> ${channelName}\n`;
                                infoMsg += `🏷️ <b>الفئة:</b> ${category}\n`;
                                infoMsg += `🗣️ <b>اللغة:</b> ${language}\n`;
                                infoMsg += `📐 <b>الدقة:</b> ${qualityStr}\n`;

                                const m3uEntry = formatM3uEntry(currentScanningUrl, channelName, category, `${res.height}p FHD`);

                                await sendTelegramPhoto(instantImgPath, infoMsg);
                                await sendTelegramMessage(`<code>${m3uEntry}</code>`);

                                try { fs.unlinkSync(instantImgPath); } catch (e) {}
                            }
                        }
                    }
                }
            }
        } catch (e) {}
    }, 2500);
}

/**
 * فحص الاستجابة الأولية
 */
async function isValidStream(url) {
    try {
        const response = await axios.get(url, {
            timeout: 5000,
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
 * عملية الفحص المتسلسلة
 */
async function startScanning(baseUrl, startNum, count = 500) {
    await sendTelegramMessage("🟢 <b>تم تفعيل فحص البث المباشر والتحليل البصري الشامل بـ Gemini!</b>");

    for (let i = 0; i < count; i++) {
        currentScanningNum = startNum + i;
        currentScanningUrl = `${baseUrl}${currentScanningNum}.ts`;

        process.stdout.write(`[*] فحص ${currentScanningNum} -> `);

        const valid = await isValidStream(currentScanningUrl);

        if (valid) {
            console.log("✅ شغال! استخراج صورة الفيديو والدقة...");

            const tempImgPath = path.join('/tmp', `frame_${currentScanningNum}.jpg`);
            const captured = await captureLiveFrame(currentScanningUrl, tempImgPath);

            if (captured) {
                const res = await getStreamResolution(currentScanningUrl);
                const qualityStr = `${res.height}p FHD`;

                console.log("📸 تم التقاط الصورة! جاري تحليل الشعار والمعلومات مع Gemini...");
                const analysis = await analyzeScreenshotWithGemini(tempImgPath);

                const channelName = analysis ? analysis.channel_name : "قناة بث مباشر";
                const category = analysis ? analysis.category : "عامة";
                const language = analysis ? analysis.language : "العربية";

                console.log(`[+] مكتشفة بـ Gemini: ${channelName} [${category}] [اللغة: ${language}] - الدقة: ${res.height}p`);

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
                console.log("⚠️ تعذر التقاط صورة ملونة للبث.");
            }
        } else {
            console.log("❌ الرابط لا يعمل");
        }
    }
}

// ==================== التشغيل ====================
(async () => {
    startTelegramBotListener();

    const BASE_URL = "http://xvip.pro/live/hend0815/08152023/";
    const START_NUMBER = 340315;
    await startScanning(BASE_URL, START_NUMBER, 500);
})();
