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
let lastCapturedImagePath = null;

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
            timeout: 10000
        });
    } catch (e) {}
}

/**
 * مستمع أمر /start
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
                        let msg = `<b>📊 تقرير فحص VLC في السيرفر:</b>\n\n`;
                        msg += `🔗 <b>الرابط الحالي:</b> <code>${currentScanningUrl || "جاري البدء..."}</code>\n`;
                        msg += `🔢 <b>الرقم الحالي:</b> <code>${currentScanningNum}</code>\n`;

                        if (lastCapturedImagePath && fs.existsSync(lastCapturedImagePath)) {
                            msg += `📸 <b>لقطة الشاشة الملتقطة عبر VLC:</b>`;
                            await sendTelegramPhoto(lastCapturedImagePath, msg);
                        } else {
                            msg += `⚠️ <i>جاري فتح البث ببرنامج VLC واستخراج الفريم...</i>`;
                            await sendTelegramMessage(msg);
                        }
                    }
                }
            }
        } catch (e) {}
    }, 2500);
}

/**
 * تشغيل البث عبر برنامج VLC المثبت بالنظام واستخراج لقطة شاشة
 */
function captureVLCFrame(streamUrl, outputPath) {
    return new Promise((resolve) => {
        const outputDir = path.dirname(outputPath);
        const fileName = path.basename(outputPath, path.extname(outputPath));

        // أمر تشغيل cvlc (VLC المخصص للسيرفرات)
        const cmd = `cvlc "${streamUrl}" --vout image --image-out-format jpg --image-out-prefix "${fileName}" --image-out-dir "${outputDir}" --run-time 4 vlc://quit`;

        exec(cmd, { timeout: 12000 }, (error) => {
            // البحث عن الملف الناتج
            const generatedFile = path.join(outputDir, `${fileName}00001.jpg`);
            if (fs.existsSync(generatedFile)) {
                try {
                    fs.renameSync(generatedFile, outputPath);
                    if (fs.statSync(outputPath).size > 3000) {
                        lastCapturedImagePath = outputPath;
                        return resolve(true);
                    }
                } catch (e) {}
            } else if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 3000) {
                lastCapturedImagePath = outputPath;
                return resolve(true);
            }
            resolve(false);
        });
    });
}

/**
 * تحليل لقطة الشاشة بـ Gemini
 */
async function analyzeScreenshotWithGemini(imagePath, streamUrl) {
    if (!fs.existsSync(imagePath)) return null;

    const prompt = `
    أنت خبير فحص بصري لقنوات التلفزيون المباشر (IPTV).
    أمامك صورة شاشة ملتقطة عبر مشغل VLC أثناء تشغيل البث المباشر للرابط: ${streamUrl}.

    افحص الصورة واللوجو بدقة ثم أجب:
    1. ما اسم القناة الحقيقي بالعربي؟ (مثال: "beIN Sports 1 HD", "MBC 1", "روتانا سينما", "سبيستون", "الجزيرة HD", "SSC 1 HD").
    2. هل القناة عربية أو تبث محتوى عربي؟ (is_arabic: true / false).
    3. تحديد تصنيف القناة فقط من: ("رياضة", "مسلسلات وبرامج", "أفلام عربية", "أفلام أجنبية ورعب", "أطفال وكرتون", "إخبارية وثائقية", "إسلامية").

    رد بصيغة JSON فقط:
    {
      "is_arabic": true,
      "channel_name": "اسم القناة بالعربي",
      "category": "التصنيف"
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
        return null;
    }
}

/**
 * تنسيق M3U
 */
function formatM3uEntry(url, channelNameAr, categoryAr) {
    const logoUrl = "https://upload.wikimedia.org/wikipedia/commons/d/d7/Bein_sport_ana_logo.png";
    const groupTitle = `⭐ ${categoryAr} | 1080p FHD ⭐`;

    return `# ${groupTitle}\n#EXTINF:-1 tvg-logo="${logoUrl}" group-title="${groupTitle}", ${channelNameAr}\n${url}`;
}

/**
 * فحص الاستجابة
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
 * عملية الفحص الرئيسية
 */
async function startScanning(baseUrl, startNum, count = 500) {
    await sendTelegramMessage("🟢 <b>تم تنزيل وتثبيت برنامج VLC بالسيرفر بنجاح! جاري التقاط الفريمات...</b>");

    for (let i = 0; i < count; i++) {
        currentScanningNum = startNum + i;
        currentScanningUrl = `${baseUrl}${currentScanningNum}.ts`;

        process.stdout.write(`[*] فحص ${currentScanningNum} -> `);

        const valid = await isValidStream(currentScanningUrl);

        if (valid) {
            console.log("✅ شغال! تشغيل VLC والتقاط الصورة...");

            const tempImgPath = path.join('/tmp', `vlc_frame_${currentScanningNum}.jpg`);
            const success = await captureVLCFrame(currentScanningUrl, tempImgPath);

            if (success) {
                console.log("📸 تم التقاط الصورة بواسطة VLC! جاري التحليل بـ Gemini...");
                const analysis = await analyzeScreenshotWithGemini(tempImgPath, currentScanningUrl);

                if (analysis && analysis.is_arabic) {
                    const channelName = analysis.channel_name;
                    const category = analysis.category;

                    console.log(`[+] مكتشفة بـ VLC: ${channelName} [${category}]`);

                    const m3uEntry = formatM3uEntry(currentScanningUrl, channelName, category);

                    await sendTelegramPhoto(tempImgPath, `✅ <b>قناة جديدة مكتشفة بـ VLC & Gemini!</b>\n📺 <b>الاسم:</b> ${channelName}\n🏷️ <b>التصنيف:</b> ${category}`);
                    await sendTelegramMessage(`<code>${m3uEntry}</code>`);
                }

                if (fs.existsSync(tempImgPath)) {
                    try { fs.unlinkSync(tempImgPath); } catch (e) {}
                }
            } else {
                console.log("⚠️ تعذر فتح البث بـ VLC.");
            }
        } else {
            console.log("❌ لا يعمل");
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
