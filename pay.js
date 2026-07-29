import axios from 'axios';
import { chromium } from 'playwright';
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

// متغيرات حالة البوت والتقدم
let globalBrowser = null;
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
    } catch (error) {
        console.log(`[!] فشل إرسال الرسالة لتليجرام: ${error.message}`);
    }
}

/**
 * إرسال صورة ملتقطة مباشرة إلى تليجرام
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
    } catch (error) {
        console.log(`[!] فشل إرسال الصورة لتليجرام: ${error.message}`);
    }
}

/**
 * الاستماع لأوامر تليجرام المباشرة (/start) وإرسال لقطة شاشة القناة الحالية
 */
async function startTelegramBotListener() {
    let lastUpdateId = 0;
    console.log("🤖 تفعيل مستمع الأوامر ومصور الشاشة الحية (/start)...");

    setInterval(async () => {
        try {
            const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=5`;
            const response = await axios.get(url, { timeout: 10000 });

            if (response.data && response.data.result) {
                for (const update of response.data.result) {
                    lastUpdateId = update.update_id;
                    if (update.message && update.message.text) {
                        const text = update.message.text;

                        if (text === '/start') {
                            let msg = `<b>📊 تقرير فحص البث المباشر الحالي:</b>\n\n`;
                            msg += `🔗 <b>الرابط قيد الفحص:</b> <code>${currentScanningUrl || "جاري البدء..."}</code>\n`;
                            msg += `🔢 <b>الرقم الحالي:</b> <code>${currentScanningNum}</code>\n`;

                            // إذا توفرت صورة حية أرسلها فوراً للبوت
                            if (lastCapturedImagePath && fs.existsSync(lastCapturedImagePath)) {
                                msg += `📸 <b>إليك لقطة شاشة حية من البث الآن:</b>`;
                                await sendTelegramPhoto(lastCapturedImagePath, msg);
                            } else {
                                msg += `⚠️ <i>البث الحالي لا يعطي صورة أو غير شغال، جاري تجاوز الرقم...</i>`;
                                await sendTelegramMessage(msg);
                            }
                        }
                    }
                }
            }
        } catch (e) {}
    }, 2500);
}

/**
 * التقاط الشاشة عبر Playwright
 */
async function captureVideoFrameWithBrowser(streamUrl, outputPath) {
    if (!globalBrowser) return false;

    const context = await globalBrowser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 },
        ignoreHTTPSErrors: true
    });

    const page = await context.newPage();

    try {
        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body, html { margin: 0; padding: 0; width: 100%; height: 100%; background: #000; }
                    video { width: 100%; height: 100%; object-fit: contain; }
                </style>
            </head>
            <body>
                <video id="v" autoplay playsinline muted src="${streamUrl}"></video>
                <script>
                    const v = document.getElementById('v');
                    v.play().catch(() => {});
                </script>
            </body>
            </html>
        `;

        await page.setContent(htmlContent);
        await page.waitForTimeout(4000);

        await page.screenshot({ path: outputPath, type: 'jpeg', quality: 80 });
        await context.close();

        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 3000) {
            lastCapturedImagePath = outputPath;
            return true;
        }
        return false;
    } catch (error) {
        await context.close();
        return false;
    }
}

/**
 * تحليل الصورة عبر Gemini
 */
async function analyzeScreenshotWithGemini(imagePath, streamUrl) {
    if (!fs.existsSync(imagePath)) return null;

    const prompt = `
    أنت نظام فحص متطور جداً لقنوات التلفزيون والبث المباشر (IPTV).
    افحص صورة الشاشة المرفقة جيداً وتأكد من شعار القناة:

    1. اذكر اسم القناة الحقيقي والكامل بالعربي (مثل: "beIN Sports 1 HD", "MBC 1", "روتانا سينما", "سبيستون", "الجزيرة HD", "SSC Sports 1 HD").
    2. هل القناة موجهة للجمهور العربي؟ (is_arabic: true / false).
    3. اختر التصنيف الدقيق فقط من: ("رياضة", "مسلسلات وبرامج", "أفلام عربية", "أفلام أجنبية ورعب", "أطفال وكرتون", "إخبارية وثائقية", "إسلامية").

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
 * فحص التأكد السريع
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
 * عملية الفحص المتسلسلة
 */
async function startScanning(baseUrl, startNum, count = 500) {
    await sendTelegramMessage("🟢 <b>تم تفعيل البوت وسيرفر التخمين! اكتب /start لتلقي لقطة الشاشة الحية للبث المباشر.</b>");

    globalBrowser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required']
    });

    for (let i = 0; i < count; i++) {
        currentScanningNum = startNum + i;
        currentScanningUrl = `${baseUrl}${currentScanningNum}.ts`;

        process.stdout.write(`[*] فحص ${currentScanningNum} -> `);

        const valid = await isValidStream(currentScanningUrl);

        if (valid) {
            console.log("✅ شغال! الالتقاط بالمتصفح...");
            const tempImgPath = path.join('/tmp', `frame_${currentScanningNum}.jpg`);
            const screenshotSuccess = await captureVideoFrameWithBrowser(currentScanningUrl, tempImgPath);

            if (screenshotSuccess) {
                const analysis = await analyzeScreenshotWithGemini(tempImgPath, currentScanningUrl);

                if (analysis && analysis.is_arabic) {
                    const channelName = analysis.channel_name;
                    const category = analysis.category;

                    console.log(`[+] اكتشاف مؤكد: ${channelName} [${category}]`);

                    const m3uEntry = formatM3uEntry(currentScanningUrl, channelName, category);
                    
                    // إرسال الصورة متبوعة بكود الـ M3U لـ Telegram
                    await sendTelegramPhoto(tempImgPath, `✅ <b>قناة جديدة مكتشفة بـ Gemini!</b>\n📺 <b>الاسم:</b> ${channelName}\n🏷️ <b>التصنيف:</b> ${category}`);
                    await sendTelegramMessage(`<code>${m3uEntry}</code>`);
                }
            }
        } else {
            console.log("❌ غير شغال");
        }
    }

    await globalBrowser.close();
}

// ==================== التشغيل ====================
(async () => {
    startTelegramBotListener();

    const BASE_URL = "http://xvip.pro/live/hend0815/08152023/";
    const START_NUMBER = 340315;
    await startScanning(BASE_URL, START_NUMBER, 500);
})();
