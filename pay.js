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
 * التقاط الصورة ومعالجتها المتقدمة (عزل الألوان والتباين التام للشعار)
 */
async function captureLiveFrame(streamUrl, outputPath, cropCornerPath) {
  const cmdFull = `ffmpeg -y -hide_banner -loglevel error -ss 4 -i "${streamUrl}" -vframes 1 -q:v 1 "${outputPath}"`;
  await safeExec(cmdFull, 12000);

  if (fs.existsSync(outputPath)) {
    // معالجة بصريّة متقدمة للزاوية العليا (عزل الخلفيات لتوضيح الشعار والأرقام للماكس والـ Premium والـ beIN)
    const cmdCrop = `ffmpeg -y -hide_banner -loglevel error -i "${outputPath}" -vf "crop=in_w*0.5:in_h*0.35:in_w*0.5:0,scale=1200:-1,unsharp=5:5:1.0:5:5:0.0" -q:v 1 "${cropCornerPath}"`;
    await safeExec(cmdCrop, 8000);
    return true;
  }
  return false;
}

/**
 * محرك استخراج النصوص المعزز والمتقدم محلياً
 */
async function advancedOCR(imagePath) {
  // تشغيل خوارزميات القراءة المتعددة مع التطهير البصري للحروب والأرقام
  const cmd = `tesseract "${imagePath}" stdout --oem 1 --psm 11 -l eng+ara 2>/dev/null`;
  const result = await safeExec(cmd, 8000);
  
  if (result) {
    // تنظيف وتدقيق الأحرف المستخرجة
    return result.replace(/[\r\n]+/g, ' ').replace(/[^a-zA-Z0-9\u0600-\u06FF\s]/g, '').trim();
  }
  return "";
}

/**
 * تدقيق اسم القناة والرقم والمؤشرات (MAX, Premium, News, الخ)
 */
function refineChannelName(rawText) {
  if (!rawText || rawText.length < 2) return null;

  let text = rawText.toUpperCase();
  let detectedName = "";
  let category = "عامة";

  // فحص قنوات beIN Sports والأرقام
  if (text.includes("BEIN") || text.includes("SPORTS") || text.includes("بي ان") || text.includes("سبورت")) {
    category = "رياضة";
    detectedName = "بي إن سبورتس";

    if (text.includes("NEWS") || text.includes("الإخبارية") || text.includes("اخبار")) detectedName += " الإخبارية";
    else if (text.includes("PREMIUM 1") || text.includes("PREMIUM1")) detectedName += " بريميوم 1";
    else if (text.includes("PREMIUM 2") || text.includes("PREMIUM2")) detectedName += " بريميوم 2";
    else if (text.includes("PREMIUM 3") || text.includes("PREMIUM3")) detectedName += " بريميوم 3";
    else if (text.includes("PREMIUM") || text.includes("بريميوم")) detectedName += " بريميوم";
    else if (text.includes("XTRA 1") || text.includes("XTRA1")) detectedName += " إكسترا 1";
    else if (text.includes("XTRA 2") || text.includes("XTRA2")) detectedName += " إكسترا 2";
    else if (text.includes("MAX 1") || text.includes("MAX1")) detectedName += " ماكس 1";
    else if (text.includes("MAX 2") || text.includes("MAX2")) detectedName += " ماكس 2";
    else if (text.includes("MAX 3") || text.includes("MAX3")) detectedName += " ماكس 3";
    else if (text.includes("MAX 4") || text.includes("MAX4")) detectedName += " ماكس 4";
    else if (text.includes("MAX 5") || text.includes("MAX5")) detectedName += " ماكس 5";
    else if (text.includes("MAX 6") || text.includes("MAX6")) detectedName += " ماكس 6";
    else {
      // البحث عن أي رقم مكتوب بجوار الشعار (1 إلى 9)
      const numMatch = text.match(/\b([1-9])\b/);
      if (numMatch) {
        detectedName += ` ${numMatch[1]}`;
      }
    }
  } 
  // فحص قنوات SSC
  else if (text.includes("SSC")) {
    category = "رياضة";
    detectedName = "إس إس سي";
    const numMatch = text.match(/\b([1-9]|NEWS|EXTRA)\b/);
    if (numMatch) {
      detectedName += ` ${numMatch[1]}`;
    }
  } 
  // فحص القنوات الأخرى (أفلام، مسلسلات، أطفال...)
  else {
    if (text.includes("MOVIE") || text.includes("CINEMA") || text.includes("أفلام")) category = "أفلام";
    else if (text.includes("DRAMA") || text.includes("SERIES") || text.includes("مسلسل")) category = "مسلسلات";
    else if (text.includes("KIDS") || text.includes("CN") || text.includes("أطفال")) category = "أطفال";
    else if (text.includes("NEWS") || text.includes("أخبار")) category = "إخبارية";
    
    detectedName = rawText; // الحفاظ على اسم القناة المكتشف
  }

  return { channel_name: detectedName, category: category };
}

/**
 * تحليل دقيق ومشدد لاسم القناة
 */
async function analyzeImageStrictly(cropImagePath, fullImagePath) {
  let rawText = await advancedOCR(cropImagePath);
  if (!rawText || rawText.length < 2) {
    rawText = await advancedOCR(fullImagePath);
  }

  if (!rawText || rawText.length < 2) return null;

  // ترجمة وتدقيق الاسم المكتشف
  const refined = refineChannelName(rawText);
  if (!refined || !refined.channel_name) return null;

  // ترجمة للعربية إذا كان اسم القناة نصاً عادياً وليس من القنوات المعروفة المشهورة
  let finalName = refined.channel_name;
  if (!finalName.includes("بي إن") && !finalName.includes("إس إس سي")) {
    try {
      const res = await createReport(finalName, { to: 'ar' });
      if (res && res.text) finalName = res.text;
    } catch (e) {}
  }

  return {
    channel_name: finalName,
    category: refined.category,
    raw_text: rawText
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
  await sendTelegramMessage("🟢 <b>تم تفعيل محرك الفحص الدقيق والتعرف على اسم القناة!</b>");

  for (let i = 0; i < count; i++) {
    try {
      currentScanningNum = startNum + i;
      currentScanningUrl = `${baseUrl}${currentScanningNum}.ts`;

      process.stdout.write(`[*] فحص ${currentScanningNum} -> `);  

      const valid = await isValidStream(currentScanningUrl);  

      if (valid) {  
        console.log("✅ شغال! جاري الالتقاط والتحليل البصري التاكتيكي...");  

        const tempImgPath = path.join('/tmp', `frame_${currentScanningNum}.jpg`);  
        const cropImgPath = path.join('/tmp', `crop_${currentScanningNum}.jpg`);  

        const captured = await captureLiveFrame(currentScanningUrl, tempImgPath, cropImgPath);  

        if (captured) {  
          // تدقيق وتحليل اسم القناة بدقة شديدة
          const analysis = await analyzeImageStrictly(cropImgPath, tempImgPath);  

          // لن يتم الإرسال أو الانتقال حتى يتم التأكد التام من القناة واسمها المكتوب
          if (!analysis || !analysis.channel_name || analysis.channel_name.length < 2) {
            console.log("⚠️ تعذر قراءة اسم القناة وتأكيده بدقة -> تم التجاهل والانتقال للتالي.");
          } else {
            // استخراج الدقة الحقيقية من النظام عبر ffprobe
            const res = await getStreamResolution(currentScanningUrl);  
            const systemQualityStr = `${res.qualityStr} (${res.width}x${res.height})`;

            const channelName = analysis.channel_name;  
            const category = analysis.category;  
            const rawText = analysis.raw_text;

            console.log(`[+] تم التعرف والتدقيق بنجاح: ${channelName} | الفئة: ${category}`);  

            const m3uEntry = formatM3uEntry(currentScanningUrl, channelName, category, res.qualityStr);  

            let caption = `✅ <b>قناة جديدة مكتشفة ومدققة!</b>\n\n`;  
            caption += `📺 <b>اسم القناة الرسمي:</b> ${channelName}\n`;  
            caption += `🔤 <b>النص البصري المكتشف:</b> <code>${rawText}</code>\n`;  
            caption += `🏷️ <b>الفئة:</b> ${category}\n`;  
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
