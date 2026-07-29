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
 * التقاط فريم محدد من البث المباشر بدقة وصارمة عبر FFmpeg المطور مع الشاشة الوهمية
 */
function captureLiveFrame(streamUrl, outputPath) {
    return new Promise((resolve) => {
        // الانتظار 3 ثوان داخل البث (-ss 3) واستخراج إطار عالي الجودة (-vframes 1)
        const cmd = `ffmpeg -y -hide_banner -loglevel error -ss 3 -i "${streamUrl}" -vframes 1 -q:v 2 "${outputPath}"`;

        exec(cmd, { timeout: 15000 }, (error) => {
            if (fs.existsSync(outputPath)) {
                const stats = fs.statSync(outputPath);
                if (stats.size > 2000) { // التأكد أن الملف ليس خاوياً
                    return resolve(true);
                }
            }
            resolve(false);
        });
    });
}

/**
 * مستمع أمر /start المباشر مع الالتقاط والإرسال الفوري للصورة
 */
async function startTelegramBotListener() {
    let lastUpdateId = 0;
    console.log("🤖 تفعيل مستمع الأوامر المباشر لتليجرام...");

    setInterval(async () => {
        try {
            const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=5`;
            const response = await axios.get(url, { timeout: 10000 });

            if (response.data && response.data.result) {
                for (const update of response.data.result) {
                    lastUpdateId = update.update_id;
                    if (update.message && update.message.text === '/start') {
                        let caption = `<b>📊 تقرير الفحص المباشر والحالي:</b>\n\n`;
                        caption += `🔗 <b>الرابط قيد الفحص:</b> <code>${currentScanningUrl || "جاري البدء..."}</code>\n`;
                        caption += `🔢 <b>الرقم الحالي:</b> <code>${currentScanningNum}</code>\n`;
                        caption += `📸 <i>جاري التقاط صورة حية للشاشة الآن وإرسالها لك...</i>`;

                        await sendTelegramMessage(caption);

                        if (currentScanningUrl) {
                            const instantImgPath = path.join('/tmp', `instant_${currentScanningNum}.jpg`);
                            const success = await captureLiveFrame(currentScanningUrl, instantImgPath);

                            if (success && fs.existsSync(instantImgPath)) {
                                await sendTelegramPhoto(instantImgPath, `🖼️ <b>لقطة شاشة حية ومباشرة للبث الحالي (${currentScanningNum}):</b>`);
                                try { fs.unlinkSync(instantImgPath); } catch (e) {}
                            } else {
                                await sendTelegramMessage("⚠️ <b>تعذر التقاط صورة ملونة للبث الحالي (البث قد يكون سوداء أو لا يعطي إطارات).</b>");
                            }
                        }
                    }
                }
            }
        } catch (e) {}
    }, 2500);
}

/**
 * تحليل لقطة الشاشة بـ Gemini
 */
async function analyzeScreenshotWithGemini(imagePath, streamUrl) {
    if (!fs.existsSync(imagePath)) return null;

    const prompt = `
    أنت خبير فحص بصري لقنوات التلفزيون المباشر (IPTV).
    أمامك صورة شاشة ملتقطة من البث المباشر للرابط: ${streamUrl}.

    افحص اللوجو والمحتوى بدقة ثم أجب:
    1. ما اسم القناة الحقيقي بالعربي؟ (مثال: "beIN Sports 1 HD", "MBC 1", "روتانا سينما", "سبيستون", "الجزيرة HD", "SSC 1 HD").
    2. هل القناة عربية أو تبث محتوى عربي؟ (is_arabic: true / false).
    3. تحديد تصنيف القناة فقط من: ("رياضة", "مسلسلات وبرامج", "أفلام عربية", "أفلام أجنبية ورعب", "أطفال وكرتون", "إخبارية وثائقية", "إسلامية").

    رد بصيغة JSON فقط بهذا الشكل:
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
 * عملية الفحص الرئيسية بصرامة
 */
async function startScanning(baseUrl, startNum, count = 500) {
    await sendTelegramMessage("🟢 <b>تم تفعيل الفحص الصارم ومصوّر الشاشة الفوري! اضغط /start في أي وقت للحصول على صورة حية للبث...</b>");

    for (let i = 0; i < count; i++) {
        currentScanningNum = startNum + i;
        currentScanningUrl = `${baseUrl}${currentScanningNum}.ts`;

        process.stdout.write(`[*] فحص ${currentScanningNum} -> `);

        const valid = await isValidStream(currentScanningUrl);

        if (valid) {
            console.log("✅ البث يستجيب! جاري استخراج صورة الشاشة بصرامة...");

            const tempImgPath = path.join('/tmp', `frame_${currentScanningNum}.jpg`);
            
            // محاولة التقاط الصورة بصرامة
            let captured = await captureLiveFrame(currentScanningUrl, tempImgPath);

            if (captured) {
                console.log("📸 تم التقاط الصورة بنجاح! جاري التحليل مع Gemini...");
                const analysis = await analyzeScreenshotWithGemini(tempImgPath, currentScanningUrl);

                if (analysis && analysis.is_arabic) {
                    const channelName = analysis.channel_name;
                    const category = analysis.category;

                    console.log(`[+] مكتشفة: ${channelName} [${category}]`);

                    const m3uEntry = formatM3uEntry(currentScanningUrl, channelName, category);

                    await sendTelegramPhoto(tempImgPath, `✅ <b>قناة جديدة مكتشفة بـ Gemini!</b>\n📺 <b>الاسم:</b> ${channelName}\n🏷️ <b>التصنيف:</b> ${category}`);
                    await sendTelegramMessage(`<code>${m3uEntry}</code>`);
                }

                if (fs.existsSync(tempImgPath)) {
                    try { fs.unlinkSync(tempImgPath); } catch (e) {}
                }
            } else {
                console.log("⚠️ فشل استخراج صورة ملونة من البث.");
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
