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
 * إرسال النتيجة إلى تليجرام بصيغة HTML
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
 * فتح البث مباشرة عبر المتصفح وتشغيله تلقائياً مع تجاوز حظر الفيديو
 */
async function captureVideoFrameWithBrowser(browser, streamUrl, outputPath) {
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 },
        ignoreHTTPSErrors: true
    });

    const page = await context.newPage();

    try {
        // صفحة تشغيل تحتوي على فيديو ومحاكي تشغيل تلقائي
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

        // الانتظار 6 ثوانٍ كاملة لضمان محاذاة الفيديو وتحميل الشعار على الشاشة
        await page.waitForTimeout(6000);

        // التقاط لقطة شاشة جودة عالية
        await page.screenshot({ path: outputPath, type: 'jpeg', quality: 85 });
        await context.close();

        if (fs.existsSync(outputPath)) {
            const size = fs.statSync(outputPath).size;
            if (size > 4000) return true; // التأكد أن الشاشة ليست سوداء بالكامل
        }
        return false;
    } catch (error) {
        console.log(`[!] خطأ أثناء فتح المتصفح: ${error.message}`);
        await context.close();
        return false;
    }
}

/**
 * إرسال الصورة لـ Gemini والتحليل الدقيق جداً
 */
async function analyzeScreenshotWithGemini(imagePath, streamUrl) {
    if (!fs.existsSync(imagePath)) return null;

    const prompt = `
    أنت نظام فحص متطور جداً لقنوات البث المباشر والتلفزيون (IPTV).
    أمامك صورة شاشة حقيقية ملتقطة من بث مباشر شغال حالياً.

    المطلوب منك:
    1. افحص اللوجو والنصوص الموجودة في أركان الشاشة بدقة.
    2. اذكر اسم القناة الحقيقي والكامل بالعربي (مثل: "beIN Sports 1 HD", "MBC 1", "روتانا سينما", "سبيستون", "الجزيرة HD", "SSC Sports 1 HD", "MBC Drama", إلخ).
    3. هل القناة موجهة للمستمع العربي أو مترجمة للعربية؟ (is_arabic: true / false).
    4. صنف القناة بدقة من القائمة التالية فقط:
       - "رياضة"
       - "مسلسلات وبرامج"
       - "أفلام عربية"
       - "أفلام أجنبية ورعب"
       - "أطفال وكرتون"
       - "إخبارية وثائقية"
       - "إسلامية"

    يجب أن تكون إجابتك بصيغة JSON فقط:
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
            text = text.split("```json")[1].split("```")[0].trim();
        }

        return JSON.parse(text);
    } catch (e) {
        console.log(`[!] خطأ تحليل Gemini: ${e.message}`);
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
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36' 
            }
        });
        if (response.status !== 200) return false;
        response.data.destroy();
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * دالة التشغيل الرئيسية
 */
async function startScanning(baseUrl, startNum, count = 100) {
    console.log("🚀 تشغيل السكربت والمتصفح لتخمين البث وتحليله عبر Gemini...\n");

    const browser = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--autoplay-policy=no-user-gesture-required',
            '--disable-web-security'
        ]
    });

    let foundCount = 0;

    for (let i = 0; i < count; i++) {
        const currentNum = startNum + i;
        const testUrl = `${baseUrl}${currentNum}.ts`;

        process.stdout.write(`[*] فحص الرابط رقم ${currentNum} -> `);

        const valid = await isValidStream(testUrl);

        if (valid) {
            console.log("✅ البث شغال! جاري تشغيله في المتصفح والتقاط الشاشة...");

            const tempImgPath = path.join('/tmp', `frame_${currentNum}.jpg`);
            const screenshotSuccess = await captureVideoFrameWithBrowser(browser, testUrl, tempImgPath);

            if (screenshotSuccess) {
                console.log("📸 تم التقاط الصورة بنجاح! جاري إرسالها لـ Gemini للتعرف على الشعار...");
                const analysis = await analyzeScreenshotWithGemini(tempImgPath, testUrl);

                if (fs.existsSync(tempImgPath)) {
                    try { fs.unlinkSync(tempImgPath); } catch (e) {}
                }

                if (analysis && analysis.is_arabic) {
                    foundCount++;
                    const channelName = analysis.channel_name || `قناة عربية ${foundCount}`;
                    const category = analysis.category || "قنوات عامة";

                    console.log(`[+] اكتشاف مؤكد: ${channelName} [التصنيف: ${category}]`);

                    const m3uEntry = formatM3uEntry(testUrl, channelName, category);
                    await sendTelegramMessage(`<code>${m3uEntry}</code>`);
                } else {
                    console.log("[-] ليست قناة عربية أو لم يظهر الشعار بوضوح.");
                }
            } else {
                console.log("⚠️ تعذر تشغيل الفيديو أو التقاط الشاشة.");
            }
        } else {
            console.log("❌ الرابط لا يعمل");
        }
    }

    await browser.close();
}

// ==================== التشغيل ====================
(async () => {
    const BASE_URL = "http://xvip.pro/live/hend0815/08152023/";
    const START_NUMBER = 340315;
    await startScanning(BASE_URL, START_NUMBER, 100);
})();
