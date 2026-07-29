import axios from 'axios';
import { chromium } from 'playwright';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';

// ==================== الإعدادات الأساسية ====================
const TELEGRAM_BOT_TOKEN = "7932535685:AAFNVyAPfmSCmHeptKAA0xc9779l8EethnQ";
const TELEGRAM_CHAT_ID = "6491999046";

// مفتاح Gemini API
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyDqlfbn5shYklhde9cn3dl_d-UwqPzmSs0";

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

/**
 * إرسال رسالة لتليجرام
 */
async function sendTelegramMessage(message) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const payload = {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "HTML"
    };
    try {
        await axios.post(url, payload, { timeout: 8000 });
    } catch (error) {
        console.log(`[!] فشل إرسال الرسالة لتليجرام: ${error.message}`);
    }
}

/**
 * الاستماع لأوامر تليجرام المباشرة مثل /start
 */
async function startTelegramBotListener() {
    let lastUpdateId = 0;
    console.log("🤖 تفعيل مستمع أوامر تليجرام (/start)...");

    setInterval(async () => {
        try {
            const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=5`;
            const response = await axios.get(url, { timeout: 10000 });

            if (response.data && response.data.result) {
                for (const update of response.data.result) {
                    lastUpdateId = update.update_id;
                    if (update.message && update.message.text) {
                        const text = update.message.text;
                        const chatId = update.message.chat.id;

                        if (text === '/start') {
                            await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                                chat_id: chatId,
                                text: "<b>✨ أهلاً بك! البوت يعمل بنجاح ومستمر في فحص قنوات IPTV بالذكاء الاصطناعي...</b>",
                                parse_mode: "HTML"
                            });
                        }
                    }
                }
            }
        } catch (e) {
            // الاستمرار في العمل
        }
    }, 3000);
}

/**
 * التقاط الشاشة عبر Playwright
 */
async function captureVideoFrameWithBrowser(browser, streamUrl, outputPath) {
    const context = await browser.newContext({
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
        await page.waitForTimeout(5000);

        await page.screenshot({ path: outputPath, type: 'jpeg', quality: 80 });
        await context.close();

        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 4000) {
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
    أنت نظام فحص متطور لقنوات التلفزيون المباشر (IPTV).
    أمامك صورة شاشة حقيقية ملتقطة من بث مباشر شغال حالياً.

    المطلوب منك:
    1. افحص اللوجو والنصوص في الشاشة بدقة.
    2. اذكر اسم القناة الحقيقي بالعربي (مثل: "beIN Sports 1 HD", "MBC 1", "روتانا سينما", "سبيستون", "الجزيرة HD", "SSC Sports 1 HD").
    3. هل القناة موجهة للجمهور العربي؟ (is_arabic: true / false).
    4. اختر تصنيف القناة فقط من: ("رياضة", "مسلسلات وبرامج", "أفلام عربية", "أفلام أجنبية ورعب", "أطفال وكرتون", "إخبارية وثائقية", "إسلامية").

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
 * فحص التأكد السريع أن الرابط يعمل
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
 * دالة التخمين الرئيسية
 */
async function startScanning(baseUrl, startNum, count = 100) {
    // إرسال تنبيه للتليجرام عند بدء التشغيل مباشرة
    await sendTelegramMessage("🟢 <b>تم تشغيل سيرفر الفحص بنجاح وجاري فحص القنوات الآن...</b>");

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required']
    });

    let foundCount = 0;

    for (let i = 0; i < count; i++) {
        const currentNum = startNum + i;
        const testUrl = `${baseUrl}${currentNum}.ts`;

        process.stdout.write(`[*] فحص ${currentNum} -> `);

        const valid = await isValidStream(testUrl);

        if (valid) {
            console.log("✅ شغال! جاري الالتقاط بـ Playwright...");

            const tempImgPath = path.join('/tmp', `frame_${currentNum}.jpg`);
            const screenshotSuccess = await captureVideoFrameWithBrowser(browser, testUrl, tempImgPath);

            if (screenshotSuccess) {
                const analysis = await analyzeScreenshotWithGemini(tempImgPath, testUrl);

                if (fs.existsSync(tempImgPath)) {
                    try { fs.unlinkSync(tempImgPath); } catch (e) {}
                }

                if (analysis && analysis.is_arabic) {
                    foundCount++;
                    const channelName = analysis.channel_name || `قناة عربية ${foundCount}`;
                    const category = analysis.category || "قنوات عامة";

                    console.log(`[+] اكتشاف: ${channelName} [${category}]`);

                    const m3uEntry = formatM3uEntry(testUrl, channelName, category);
                    await sendTelegramMessage(`<code>${m3uEntry}</code>`);
                }
            }
        } else {
            console.log("❌ غير شغال");
        }
    }

    await browser.close();
}

// ==================== التشغيل ====================
(async () => {
    // تشغيل مستمع أوامر تليجرام في الخلفية
    startTelegramBotListener();

    const BASE_URL = "http://xvip.pro/live/hend0815/08152023/";
    const START_NUMBER = 340315;
    await startScanning(BASE_URL, START_NUMBER, 200);
})();
