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
        }, { timeout: 5000 });
    } catch (e) {}
}

/**
 * إرسال صورة ملتقطة لتليجرام مع التقرير
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
            timeout: 8000
        });
    } catch (e) {
        console.log(`[!] فشل إرسال الصورة: ${e.message}`);
    }
}

/**
 * استخراج دقة الفيديو السريعة عبر ffprobe
 */
function getStreamResolution(streamUrl) {
    return new Promise((resolve) => {
        const cmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of json "${streamUrl}"`;
        exec(cmd, { timeout: 4000 }, (err, stdout) => {
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
 * التقاط فريم سريع جداً من البث
 */
function captureLiveFrame(streamUrl, outputPath) {
    return new Promise((resolve) => {
        // التقاط الصورة بعد ثانيتين فقط لزيادة السرعة
        const cmd = `ffmpeg -y -hide_banner -loglevel error -ss 2 -i "${streamUrl}" -vframes 1 -q:v 3 "${outputPath}"`;

        exec(cmd, { timeout: 8000 }, (error) => {
            if (fs.existsSync(outputPath)) {
                const stats = fs.statSync(outputPath);
                if (stats.size > 5000) {
                    return resolve(true);
                }
            }
            resolve(false);
        });
    });
}

/**
 * تحليل دقيق وفائق السرعة بـ Gemini
 */
async function analyzeScreenshotWithGemini(imagePath) {
    if (!fs.existsSync(imagePath)) return null;

    const prompt = `
    افحص صورة الشاشة المرفقة بسرعة واستخرج المعلومات التالية بدقة:
    - channel_name: اسم القناة الحقيقي بالعربي والإنجليزي (مثل beIN Sports 1 HD, MBC 1, Rotana, SSC 1, Spacetoon).
    - category: التصنيف فقط من: (رياضة | مسلسلات وبرامج | أفلام عربية | أفلام أجنبية ورعب | أطفال وكرتون | إخبارية وثائقية | إسلامية).
    - language: اللغة (العربية / الإنجليزية / مترجم للعربية).

    أعد النتيجة بصيغة JSON فقط بهذا الشكل:
    {
      "channel_name": "اسم القناة",
      "category": "الفئة",
      "language": "اللغة"
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
            config: {
                responseMimeType: "application/json"
            }
        });

        const text = response.text.trim();
        return JSON.parse(text);
    } catch (e) {
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
 * فحص استجابة الرابط بأقصى سرعة
 */
async function isValidStream(url) {
    try {
        const response = await axios.get(url, {
            timeout: 3000,
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
 * دالة التخمين المستمرة التلقائية (تستمر بالفحص بدون توقف)
 */
async function startContinuousScanning(baseUrl, startNum) {
    console.log("🚀 انطلاق فحص IPTV التلقائي السريع المستمر مع Gemini...\n");
    await sendTelegramMessage("⚡ <b>تم تشغيل نظام التخمين والفحص السريع التلقائي بدون توقف!</b>");

    let currentNum = startNum;

    while (true) {
        const testUrl = `${baseUrl}${currentNum}.ts`;
        process.stdout.write(`[*] فحص الرابط رقم ${currentNum} -> `);

        const valid = await isValidStream(testUrl);

        if (valid) {
            console.log("✅ شغال! التقاط الفريم والتحليل...");

            const tempImgPath = path.join('/tmp', `frame_${currentNum}.jpg`);
            const captured = await captureLiveFrame(testUrl, tempImgPath);

            if (captured) {
                const res = await getStreamResolution(testUrl);
                const qualityStr = res.height >= 1080 ? `${res.height}p FHD` : `${res.height}p HD`;

                const analysis = await analyzeScreenshotWithGemini(tempImgPath);

                if (analysis && analysis.channel_name) {
                    const channelName = analysis.channel_name;
                    const category = analysis.category || "رياضة";
                    const language = analysis.language || "العربية";

                    console.log(`[+] اكتشاف مؤكد: ${channelName} [${category}] [${qualityStr}]`);

                    const m3uEntry = formatM3uEntry(testUrl, channelName, category, qualityStr);

                    let caption = `✅ <b>قناة جديدة مكتشفة بـ Gemini!</b>\n\n`;
                    caption += `📺 <b>اسم القناة:</b> ${channelName}\n`;
                    caption += `🏷️ <b>الفئة:</b> ${category}\n`;
                    caption += `🗣️ <b>اللغة:</b> ${language}\n`;
                    caption += `📐 <b>الدقة:</b> ${qualityStr} (${res.width}x${res.height})`;

                    // إرسال النتيجة فوراً للبوت بدون توقف
                    await sendTelegramPhoto(tempImgPath, caption);
                    await sendTelegramMessage(`<code>${m3uEntry}</code>`);
                }

                if (fs.existsSync(tempImgPath)) {
                    try { fs.unlinkSync(tempImgPath); } catch (e) {}
                }
            } else {
                console.log("⚠️ البث لا يعطي صورة ملونة.");
            }
        } else {
            console.log("❌ غير شغال");
        }

        // الانتقال التلقائي المباشر للرابط التالي
        currentNum++;
    }
}

// ==================== التشغيل ====================
(async () => {
    const BASE_URL = "http://xvip.pro/live/hend0815/08152023/";
    const START_NUMBER = 340315;
    await startContinuousScanning(BASE_URL, START_NUMBER);
})();
