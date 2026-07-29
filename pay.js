import axios from 'axios';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';

// تفعيل إضافة التخفي للمحاكاة لتجاوز حظر السيرفرات
puppeteer.use(StealthPlugin());

// ==================== الإعدادات الأساسية ====================
const TELEGRAM_BOT_TOKEN = "7932535685:AAFNVyAPfmSCmHeptKAA0xc9779l8EethnQ";
const TELEGRAM_CHAT_ID = "6491999046";

// مفتاح Gemini API
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyDqlfbn5shYklhde9cn3dl_d-UwqPzmSs0";

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

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
    } catch (e) {}
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
    } catch (e) {}
}

/**
 * مستمع أوامر /start
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
                        let msg = `<b>📊 تقرير الفحص عبر المحاكي المطور:</b>\n\n`;
                        msg += `🔗 <b>الرابط الحالي:</b> <code>${currentScanningUrl || "جاري البدء..."}</code>\n`;
                        msg += `🔢 <b>الرقم الحالي:</b> <code>${currentScanningNum}</code>\n`;

                        if (lastCapturedImagePath && fs.existsSync(lastCapturedImagePath)) {
                            msg += `📸 <b>إليك لقطة الشاشة الحية من المحاكي:</b>`;
                            await sendTelegramPhoto(lastCapturedImagePath, msg);
                        } else {
                            msg += `⚠️ <i>جاري المحاكاة والتقاط الفريم...</i>`;
                            await sendTelegramMessage(msg);
                        }
                    }
                }
            }
        } catch (e) {}
    }, 2500);
}

/**
 * محاكي شاشة حقيقي يعمل على تحويل فريمات الفيديو عبر Canvas لمنع الشاشة السوداء
 */
async function captureVideoFrameWithEmulator(streamUrl, outputPath) {
    if (!globalBrowser) return false;

    const page = await globalBrowser.newPage();

    try {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 720 });

        // إنشاء محاكي مشغل فيديو مع Canvas لتحويل محتوى البث بصرياً
        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
                <style>
                    body, html { margin: 0; padding: 0; width: 100%; height: 100%; background: #111; overflow: hidden; }
                    video, canvas { width: 100%; height: 100%; object-fit: contain; }
                </style>
            </head>
            <body>
                <video id="video" autoplay muted playsinline crossorigin="anonymous"></video>
                <canvas id="canvas" style="display:none;"></canvas>
                <script>
                    const video = document.getElementById('video');
                    const canvas = document.getElementById('canvas');
                    const videoSrc = '${streamUrl}';

                    if (Hls.isSupported()) {
                        const hls = new Hls({ maxBufferLength: 5 });
                        hls.loadSource(videoSrc);
                        hls.attachMedia(video);
                        hls.on(Hls.Events.MANIFEST_PARSED, function() {
                            video.play();
                        });
                    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                        video.src = videoSrc;
                        video.play();
                    }
                </script>
            </body>
            </html>
        `;

        await page.setContent(htmlContent);

        // الانتظار 6 ثوانٍ كاملة للمحاكاة وتفريغ الفريمات
        await page.waitForTimeout(6000);

        // التقاط الشاشة عبر محاكي Puppeteer
        await page.screenshot({ path: outputPath, type: 'jpeg', quality: 85 });
        await page.close();

        if (fs.existsSync(outputPath)) {
            const size = fs.statSync(outputPath).size;
            // إذا كان حجم الصورة أكبر من 10KB فهذا يعني وجود فيديو ملون حقيقي وليس شاشة سوداء
            if (size > 10000) {
                lastCapturedImagePath = outputPath;
                return true;
            }
        }
        return false;
    } catch (error) {
        await page.close().catch(() => {});
        return false;
    }
}

/**
 * تحليل الصورة عبر Gemini
 */
async function analyzeScreenshotWithGemini(imagePath, streamUrl) {
    if (!fs.existsSync(imagePath)) return null;

    const prompt = `
    أنت خبير محترف جداً في التعرف البصري على شعارات وقنوات التلفزيون المباشر (IPTV).
    أمامك صورة حقيقية التقاطها المحاكي أثناء تشغيل البث المباشر للرابط: ${streamUrl}.

    افحص اللوجو وشريط العرض بدقة ثم أجب بالتالي:
    1. اسم القناة الحقيقي والدقيق باللغة العربية بناءً على اللوجو أو المحتوى؟ (مثل: "beIN Sports 1 HD", "MBC 1", "روتانا سينما", "سبيستون", "الجزيرة HD", "SSC 1 HD", "MBC Drama").
    2. هل القناة عربية أو تبث محتوى عربي؟ (is_arabic: true / false).
    3. تحديد تصنيف القناة الدقيق فقط من: ("رياضة", "مسلسلات وبرامج", "أفلام عربية", "أفلام أجنبية ورعب", "أطفال وكرتون", "إخبارية وثائقية", "إسلامية").

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
 * دالة التخمين الرئيسية
 */
async function startScanning(baseUrl, startNum, count = 500) {
    await sendTelegramMessage("🟢 <b>تم تفعيل المحاكي المطور بنجاح لتجاوز الشاشة السوداء...</b>");

    // تشغيل متصفح Puppeteer المتخفي بالكامل
    globalBrowser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--autoplay-policy=no-user-gesture-required',
            '--disable-web-security',
            '--ignore-certificate-errors'
        ]
    });

    for (let i = 0; i < count; i++) {
        currentScanningNum = startNum + i;
        currentScanningUrl = `${baseUrl}${currentScanningNum}.ts`;

        process.stdout.write(`[*] فحص ${currentScanningNum} -> `);

        const valid = await isValidStream(currentScanningUrl);

        if (valid) {
            console.log("✅ شغال! المحاكي يفك التشفير ويلتقط الفريم الملون...");
            const tempImgPath = path.join('/tmp', `frame_${currentScanningNum}.jpg`);
            const screenshotSuccess = await captureVideoFrameWithEmulator(currentScanningUrl, tempImgPath);

            if (screenshotSuccess) {
                console.log("📸 تم التقاط الفريم بنجاح! جاري التحليل مع Gemini...");
                const analysis = await analyzeScreenshotWithGemini(tempImgPath, currentScanningUrl);

                if (analysis && analysis.is_arabic) {
                    const channelName = analysis.channel_name;
                    const category = analysis.category;

                    console.log(`[+] اكتشاف مؤكد: ${channelName} [${category}]`);

                    const m3uEntry = formatM3uEntry(currentScanningUrl, channelName, category);
                    
                    await sendTelegramPhoto(tempImgPath, `✅ <b>قناة جديدة مكتشفة بالذكاء الاصطناعي!</b>\n📺 <b>الاسم:</b> ${channelName}\n🏷️ <b>التصنيف:</b> ${category}`);
                    await sendTelegramMessage(`<code>${m3uEntry}</code>`);
                }
            } else {
                console.log("⚠️ الشاشة سوداء أو لم يتم فتح الفيديو.");
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
