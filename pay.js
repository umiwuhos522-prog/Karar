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
        await axios.post(url, payload, { timeout: 5000 });
    } catch (error) {
        console.log(`[!] فشل إرسال الرسالة لتليجرام: ${error.message}`);
    }
}

/**
 * تشغيل المتصفح والانتظار حتى يعمل البث المباشر ثم التقاط الشاشة لـ Gemini
 */
async function captureVideoFrameWithBrowser(browser, streamUrl, outputPath) {
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
        // إنشاء صفحة HTML بسيطة لتشغيل فيديو البث المباشر
        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body, html { margin: 0; padding: 0; width: 100%; height: 100%; background: #000; overflow: hidden; }
                    video { width: 100%; height: 100%; object-fit: contain; }
                </style>
            </head>
            <body>
                <video id="player" autoplay muted controls src="${streamUrl}"></video>
            </body>
            </html>
        `;

        await page.setContent(htmlContent);

        // الانتظار 5 ثوانٍ حقيقية ليعمل البث المباشر وتظهر صورة اللوجو والمحتوى
        await page.waitForTimeout(5000);

        // التقاط صورة للشاشة الحالية
        await page.screenshot({ path: outputPath, type: 'jpeg', quality: 80 });
        await context.close();

        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 3000) {
            return true;
        }
        return false;
    } catch (error) {
        await context.close();
        return false;
    }
}

/**
 * جعل Gemini يرى اللوجو والصورة بعينه ويحلل المحتوى بدقة عالية جداً
 */
async function analyzeScreenshotWithGemini(imagePath, streamUrl) {
    if (!fs.existsSync(imagePath)) return null;

    const prompt = `
    أنت خبير محترف جداً في الفحص البصري لقنوات التلفزيون والبث المباشر (IPTV).
    أمامك صورة حقيقية التقاطها المتصفح أثناء تشغيل البث المباشر للرابط: ${streamUrl}.

    قم برؤية الصورة وفحص اللوجو وشريط العرض بدقة ثم أجب بالتالي:
    1. ما هو اسم القناة الحقيقي والدقيق باللغة العربية بناءً على اللوجو أو المحتوى؟ (مثال: "beIN Sports 1 HD", "MBC 1", "روتانا سينما", "سبيستون", "الجزيرة HD", "SSC 1 HD", "MBC Drama").
    2. هل القناة عربية أو تبث محتوى عربي/مترجم للعربية؟ (is_arabic: true / false).
    3. تحديد تصنيف القناة الدقيق جداً من القائمة التالية فقط:
       - "رياضة"
       - "مسلسلات"
       - "أفلام عربية"
       - "أفلام أجنبية ورعب"
       - "أطفال وكرتون"
       - "إخبارية وثائقية"
       - "إسلامية"

    تنبيه صارم: يجب أن يكون الرد بصيغة JSON فقط بهذا الشكل وبدون أي كلام إضافي:
    {
      "is_arabic": true,
      "channel_name": "اسم القناة بالعربي",
      "category": "التصنيف الدقيق"
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
        console.log(`[!] خطأ في التحليل البصري بـ Gemini: ${e.message}`);
        return null;
    }
}

/**
 * تنسيق M3U بالبيانات الحقيقية المكتشفة
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
            timeout: 4000,
            responseType: 'stream',
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        if (response.status !== 200) return false;
        response.data.destroy();
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * دالة التشغيل والفحص
 */
async function startScanning(baseUrl, startNum, count = 100) {
    console.log("🚀 تشغيل المتصفح وفحص الشاشات عبر Gemini API...\n");

    // تشغيل المتصفح عبر Playwright
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required']
    });

    for (let i = 0; i < count; i++) {
        const currentNum = startNum + i;
        const testUrl = `${baseUrl}${currentNum}.ts`;

        process.stdout.write(`[*] فحص الرابط رقم ${currentNum} -> `);

        const valid = await isValidStream(testUrl);

        if (valid) {
            console.log("✅ شغال! المتصفح يفتح البث والتقاط الشاشة...");

            const tempImgPath = path.join('/tmp', `frame_${currentNum}.jpg`);
            const screenshotSuccess = await captureVideoFrameWithBrowser(browser, testUrl, tempImgPath);

            if (screenshotSuccess) {
                // إرسال صورة الشاشة الحقيقية لـ Gemini ليرى الشعار بعينه
                const analysis = await analyzeScreenshotWithGemini(tempImgPath, testUrl);

                // مسح الصورة المؤقتة
                if (fs.existsSync(tempImgPath)) {
                    try { fs.unlinkSync(tempImgPath); } catch (e) {}
                }

                if (analysis && analysis.is_arabic) {
                    const channelName = analysis.channel_name;
                    const category = analysis.category;

                    console.log(`[+] تم التعرف على القناة بصرياً: ${channelName} [التصنيف: ${category}]`);

                    const m3uEntry = formatM3uEntry(testUrl, channelName, category);
                    await sendTelegramMessage(`<code>${m3uEntry}</code>`);
                } else {
                    console.log("[-] القناة ليست عربية أو لم يظهر الشعار بوضوح.");
                }
            } else {
                console.log("⚠️ تعذر تشغيل الفيديو في المتصفح.");
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
