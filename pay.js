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

// مسار برنامج VLC على جهازك (عدّله حسب مسار VLC لديك إذا كان مختلفاً)
// للـ Windows غالباً: "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe"
const VLC_PATH = `C:\\Program Files\\VideoLAN\\VLC\\vlc.exe`;

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

/**
 * إرسال رسالة نصية إلى تليجرام
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
        console.log(`[!] فشل إرسال الرسالة لتليجرام: ${e.message}`);
    }
}

/**
 * إرسال صورة ملتقطة إلى تليجرام
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
    } catch (e) {
        console.log(`[!] فشل إرسال الصورة لتليجرام: ${e.message}`);
    }
}

/**
 * تشغيل البث المباشر عبر برنامج VLC الحقيقي والتقاط صورة للشاشة بدون شاشة سوداء
 */
function captureVLCFrame(streamUrl, outputPath) {
    return new Promise((resolve) => {
        const outputDir = path.dirname(outputPath);
        const fileName = path.basename(outputPath, path.extname(outputPath));

        // أمر تشغيل VLC لالتقاط فريم حقيقي من البث
        const cmd = `"${VLC_PATH}" "${streamUrl}" --intf dummy --vout image --image-out-format jpg --image-out-prefix "${fileName}" --image-out-dir "${outputDir}" --run-time 5 vlc://quit`;

        exec(cmd, { timeout: 15000 }, (error) => {
            if (fs.existsSync(outputPath)) {
                const stats = fs.statSync(outputPath);
                if (stats.size > 5000) { // التأكد من وجود صورة ملونة وليست سوداء
                    return resolve(true);
                }
            }
            resolve(false);
        });
    });
}

/**
 * تحليل لقطة الشاشة المأخوذة من VLC بواسطة Gemini
 */
async function analyzeScreenshotWithGemini(imagePath, streamUrl) {
    if (!fs.existsSync(imagePath)) return null;

    const prompt = `
    أنت خبير محترف في الفحص البصري لقنوات IPTV والتلفزيون العربي.
    أمامك صورة شاشة حقيقية ملتقطة من برنامج VLC أثناء تشغيل البث المباشر للرابط: ${streamUrl}.

    افحص اللوجو والمحتوى على الشاشة بدقة ثم أجب بالتالي:
    1. ما هو اسم القناة الحقيقي والدقيق باللغة العربية؟ (مثال: "beIN Sports 1 HD", "MBC 1", "روتانا سينما", "سبيستون", "الجزيرة HD", "SSC 1 HD", "MBC Drama").
    2. هل القناة عربية أو موجهة للمستمع العربي؟ (is_arabic: true / false).
    3. تحديد تصنيف القناة الدقيق فقط من القائمة التالية:
       - "رياضة"
       - "مسلسلات وبرامج"
       - "أفلام عربية"
       - "أفلام أجنبية ورعب"
       - "أطفال وكرتون"
       - "إخبارية وثائقية"
       - "إسلامية"

    تنبيه: يجب أن تكون الإجابة بصيغة JSON فقط بهذا الشكل:
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
        console.log(`[!] خطأ في تحليل Gemini: ${e.message}`);
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
 * فحص التأكد السريع أن الرابط يستجيب
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
 * الدالة الرئيسية للفحص
 */
async function startScanning(baseUrl, startNum, count = 100) {
    console.log("🚀 بدء تشغيل الفحص باستخدام برنامج VLC الحقيقي و Gemini...\n");
    await sendTelegramMessage("🟢 <b>تم تفعيل الفحص عبر برنامج VLC الحقيقي محلياً...</b>");

    for (let i = 0; i < count; i++) {
        const currentNum = startNum + i;
        const testUrl = `${baseUrl}${currentNum}.ts`;

        process.stdout.write(`[*] فحص الرابط رقم ${currentNum} -> `);

        const valid = await isValidStream(testUrl);

        if (valid) {
            console.log("✅ البث شغال! جاري التشغيل في برنامج VLC والتقاط الشاشة...");

            const tempImgPath = path.join(process.cwd(), `frame_${currentNum}.jpg`);
            const success = await captureVLCFrame(testUrl, tempImgPath);

            if (success) {
                console.log("📸 تم التقاط الصورة عبر VLC! جاري التحليل مع Gemini...");
                const analysis = await analyzeScreenshotWithGemini(tempImgPath, testUrl);

                if (analysis && analysis.is_arabic) {
                    const channelName = analysis.channel_name;
                    const category = analysis.category;

                    console.log(`[+] اكتشاف مؤكد: ${channelName} [${category}]`);

                    const m3uEntry = formatM3uEntry(testUrl, channelName, category);

                    await sendTelegramPhoto(tempImgPath, `✅ <b>قناة جديدة مكتشفة بـ VLC & Gemini!</b>\n📺 <b>الاسم:</b> ${channelName}\n🏷️ <b>التصنيف:</b> ${category}`);
                    await sendTelegramMessage(`<code>${m3uEntry}</code>`);
                }

                // مسح الصورة المؤقتة
                if (fs.existsSync(tempImgPath)) {
                    try { fs.unlinkSync(tempImgPath); } catch (e) {}
                }
            } else {
                console.log("⚠️ تعذر فتح الفيديو أو البث مغلق.");
            }
        } else {
            console.log("❌ الرابط لا يعمل");
        }
    }
}

// ==================== التشغيل ====================
(async () => {
    const BASE_URL = "http://xvip.pro/live/hend0815/08152023/";
    const START_NUMBER = 340315;
    await startScanning(BASE_URL, START_NUMBER, 100);
})();
