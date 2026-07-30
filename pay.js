import axios from 'axios';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import createReport from 'google-translate-api-x';

// ==================== الإعدادات الأساسية ====================
const TELEGRAM_BOT_TOKEN = "7932535685:AAFNVyAPfmSCmHeptKAA0xc9779l8EethnQ";
const TELEGRAM_CHAT_ID = "6491999046";

let currentScanningUrl = "";
let currentScanningNum = 0;

process.on('uncaughtException', (err) => {
  console.error('[!] تم تفادي خطأ غير معالج:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[!] تم تفادي رفض وعد غير معالج:', reason);
});

/**
 * تنفيذ الأوامر مع حماية من التجميد
 */
function safeExec(command, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const child = exec(command, (err, stdout) => {
      if (err) resolve(null);
      else resolve(stdout);
    });

    const timer = setTimeout(() => {  
      child.kill('SIGKILL');  
      resolve(null);  
    }, timeoutMs);  

    child.on('exit', () => clearTimeout(timer));
  });
}

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
      timeout: 15000  
    });
  } catch (e) {
    console.log(`[!] فشل إرسال الصورة: ${e.message}`);
  }
}

/**
 * استخراج دقة الفيديو الحقيقية عبر ffprobe
 */
async function getStreamResolution(streamUrl) {
  const cmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of json "${streamUrl}"`;
  const stdout = await safeExec(cmd, 8000);

  if (stdout) {
    try {
      const data = JSON.parse(stdout);
      if (data.streams && data.streams.length > 0) {
        const w = data.streams[0].width || 1920;
        const h = data.streams[0].height || 1080;
        
        let qStr = `${h}p HD`;
        if (h >= 2160) qStr = `${h}p 4K`;
        else if (h >= 1080) qStr = `${h}p FHD`;
        else if (h < 720) qStr = `${h}p SD`;

        return { width: w, height: h, qualityStr: qStr };
      }
    } catch (e) {}
  }
  return { width: 1920, height: 1080, qualityStr: "1080p FHD" };
}

/**
 * التقاط الصورة ومعالجتها محلياً للتعرف البصري
 */
async function captureLiveFrame(streamUrl, outputPath, cropCornerPath) {
  const cmdFull = `ffmpeg -y -hide_banner -loglevel error -ss 3 -i "${streamUrl}" -vframes 1 -q:v 2 "${outputPath}"`;
  await safeExec(cmdFull, 12000);

  if (fs.existsSync(outputPath)) {
    const cmdCrop = `ffmpeg -y -hide_banner -loglevel error -i "${outputPath}" -vf "crop=in_w*0.5:in_h*0.35:in_w*0.5:0" -q:v 1 "${cropCornerPath}"`;
    await safeExec(cmdCrop, 8000);
    return true;
  }
  return false;
}

/**
 * محرك قراءة النصوص المحلي (Tesseract OCR)
 */
async function localOCR(imagePath) {
  const cmd = `tesseract "${imagePath}" stdout --oem 1 -l eng+ara --psm 6 2>/dev/null`;
  const result = await safeExec(cmd, 6000);
  if (result) {
    return result.replace(/[^a-zA-Z0-9\u0600-\u06FF\s]/g, '').trim();
  }
  return "";
}

/**
 * ترجمة اسم القناة تلقائياً للعربية
 */
async function translateToArabic(text) {
  if (!text) return "";
  try {
    const res = await createReport(text, { to: 'ar' });
    return res.text || text;
  } catch (e) {
    return text;
  }
}

/**
 * تصنيف الفئة آلياً بحسب اسم القناة
 */
function detectCategory(channelText) {
  const text = channelText.toLowerCase();

  if (text.includes('sport') || text.includes('ssc') || text.includes('bein') || text.includes('كرة') || text.includes('رياضة') || text.includes('match')) {
    return "رياضة";
  }
  if (text.includes('movie') || text.includes('cinema') || text.includes('action') || text.includes('أفلام') || text.includes('سينما')) {
    return "أفلام";
  }
  if (text.includes('series') || text.includes('drama') || text.includes('مسلسل') || text.includes('دراما')) {
    return "مسلسلات";
  }
  if (text.includes('news') || text.includes('اخبار') || text.includes('الجزيرة') || text.includes('العربية')) {
    return "إخبارية";
  }
  if (text.includes('kids') || text.includes('cn') || text.includes('mbc3') || text.includes('أطفال') || text.includes('كارتون')) {
    return "أطفال";
  }
  if (text.includes('doc') || text.includes('nat geo') || text.includes('وثائقي')) {
    return "وثائقي";
  }
  return "عامة";
}

/**
 * تحليل اسم القناة والفئة محلياً
 */
async function analyzeImageLocally(cropImagePath, fullImagePath) {
  let detectedText = await localOCR(cropImagePath);
  
  if (!detectedText || detectedText.length < 2) {
    detectedText = await localOCR(fullImagePath);
  }

  // إذا لم يقرأ tesseract نصاً، نقوم بفحص أنماط النص المباشرة من ffmpeg
  if (!detectedText || detectedText.length < 2) {
    return null;
  }

  const translatedName = await translateToArabic(detectedText);
  const category = detectCategory(detectedText + " " + translatedName);

  return {
    original_text: detectedText,
    channel_name: translatedName || detectedText,
    category: category
  };
}

/**
 * تنسيق M3U
 */
function formatM3uEntry(url, channelNameAr, categoryAr, qualityStr) {
  const logoUrl = "https://upload.wikimedia.org/wikipedia/commons/d/d7/Bein_sport_ana_logo.png";
  const groupTitle = `⭐ ${categoryAr} | ${qualityStr} ⭐`;

  return `#EXTINF:-1 tvg-logo="${logoUrl}" group-title="${groupTitle}", ${channelNameAr}\n${url}`;
}

/**
 * مستمع أمر /start المباشر
 */
async function startTelegramBotListener() {
  let lastUpdateId = 0;
  while (true) {
    try {
      const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=5`;
      const response = await axios.get(url, { timeout: 10000 });

      if (response.data && response.data.result) {  
        for (const update of response.data.result) {  
          lastUpdateId = update.update_id;  
          if (update.message && update.message.text === '/start') {  
            let caption = `<b>📊 التقرير المباشر:</b>\n\n`;  
            caption += `🔗 <b>الرابط الحالي:</b> <code>${currentScanningUrl || "جاري البدء..."}</code>\n`;  
            caption += `🔢 <b>الرقم الحالي:</b> <code>${currentScanningNum}</code>\n`;  

            await sendTelegramMessage(caption);  
          }  
        }  
      }  
    } catch (e) {}  
    await new Promise(res => setTimeout(res, 2500));
  }
}

/**
 * فحص استجابة الرابط
 */
async function isValidStream(url) {
  try {
    const response = await axios.get(url, {
      timeout: 3500,
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
async function startScanning(baseUrl, startNum, count = 100000) {
  await sendTelegramMessage("🟢 <b>تم تفعيل الفحص (سيتم إرسال القنوات المكتشفة اسمها بنجاح فقط)!</b>");

  for (let i = 0; i < count; i++) {
    try {
      currentScanningNum = startNum + i;
      currentScanningUrl = `${baseUrl}${currentScanningNum}.ts`;

      process.stdout.write(`[*] فحص ${currentScanningNum} -> `);  

      const valid = await isValidStream(currentScanningUrl);  

      if (valid) {  
        console.log("✅ شغال! جاري الالتقاط والتعرف على القناة...");  

        const tempImgPath = path.join('/tmp', `frame_${currentScanningNum}.jpg`);  
        const cropImgPath = path.join('/tmp', `crop_${currentScanningNum}.jpg`);  

        const captured = await captureLiveFrame(currentScanningUrl, tempImgPath, cropImgPath);  

        if (captured) {  
          // 1. تحليل اسم القناة محلياً
          const analysis = await analyzeImageLocally(cropImgPath, tempImgPath);  

          // *** التعديل المهم هنا ***
          // إذا لم يتم التعرف على الاسم بنجاح (analysis فارغ أو غير معروف) نرفض القناة ولن نرسلها نهائياً
          if (!analysis || !analysis.channel_name || analysis.channel_name.includes("غير معنونة")) {
            console.log("⚠️ تعذر التعرف على اسم القناة بدقة -> تم تجاهل الإرسال والانتقال للقناة التالية.");
          } else {
            // استخراج الدقة من النظام
            const res = await getStreamResolution(currentScanningUrl);  
            const systemQualityStr = `${res.qualityStr} (${res.width}x${res.height})`;

            const channelName = analysis.channel_name;  
            const category = analysis.category;  
            const rawText = analysis.original_text;

            console.log(`[+] تم اكتشاف القناة بنجاح: ${channelName} | الفئة: ${category}`);  

            const m3uEntry = formatM3uEntry(currentScanningUrl, channelName, category, res.qualityStr);  

            let caption = `✅ <b>قناة جديدة مكتشفة!</b>\n\n`;  
            caption += `📺 <b>اسم القناة (مترجم):</b> ${channelName}\n`;  
            caption += `🔤 <b>النص الملتقط:</b> <code>${rawText}</code>\n`;  
            caption += `🏷️ <b>الفئة المقدرة:</b> ${category}\n`;  
            caption += `📐 <b>الدقة (من النظام):</b> ${systemQualityStr}`;  

            await sendTelegramPhoto(tempImgPath, caption);  
            await sendTelegramMessage(`<code>${m3uEntry}</code>`);  
          }

          // تنظيف الصور المؤقتة  
          try { if (fs.existsSync(tempImgPath)) fs.unlinkSync(tempImgPath); } catch (e) {}  
          try { if (fs.existsSync(cropImgPath)) fs.unlinkSync(cropImgPath); } catch (e) {}  
        } else {  
          console.log("⚠️ تعذر التقاط صورة البث.");  
        }  
      } else {  
        console.log("❌ غير شغال");  
      }  
    } catch (loopError) {  
      console.log(`[!] خطأ في الفحص: ${loopError.message}`);  
    }
  }
}

// ==================== التشغيل ====================
(async () => {
  startTelegramBotListener();

  const BASE_URL = "http://xvip.pro/live/hend0815/08152023/";  
  const START_NUMBER = 340315;  
  await startScanning(BASE_URL, START_NUMBER, 100000);
})();
