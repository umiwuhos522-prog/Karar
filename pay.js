import axios from 'axios';
import { exec } from 'child_process';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';

// ==================== الإعدادات الأساسية ====================
const TELEGRAM_BOT_TOKEN = "7932535685:AAFNVyAPfmSCmHeptKAA0xc9779l8EethnQ";
const TELEGRAM_CHAT_ID = "6491999046";

// قراءة مفتاح Gemini بأمان من متغيرات البيئة في Railway
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY || "DUMMY_KEY" });

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
 * استخراج دقة الفيديو الحقيقية من البث عبر النظام (ffprobe)
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
 * التقاط الصورة وإعادة تحجيمها لتقليل حجم الـ API Payload
 */
async function captureLiveFrame(streamUrl, outputPath, cropCornerPath) {
  // التقاط الصورة الكاملة مصغرة لعرض 800px لتقليل استهلاك الـ Tokens
  const cmdFull = `ffmpeg -y -hide_banner -loglevel error -ss 3 -i "${streamUrl}" -vframes 1 -vf "scale=800:-1" -q:v 2 "${outputPath}"`;
  await safeExec(cmdFull, 12000);

  if (fs.existsSync(outputPath)) {
    // اقتصاص الشعار العلوي مكبر بوضوح
    const cmdCrop = `ffmpeg -y -hide_banner -loglevel error -i "${outputPath}" -vf "crop=in_w*0.5:in_h*0.35:in_w*0.5:0,scale=600:-1" -q:v 2 "${cropCornerPath}"`;
    await safeExec(cmdCrop, 8000);
    return true;
  }
  return false;
}

/**
 * تحليل اسم القناة واللغة والفئة بواسطة Gemini دون تدخل في الدقة
 */
async function analyzeScreenshotWithGemini(fullImagePath, cropImagePath) {
  if (!fs.existsSync(fullImagePath)) return null;

  if (!GEMINI_API_KEY) {
    console.log("[!] خطأ: مفتاح GEMINI_API_KEY غير معرف في متغيرات البيئة (Variables)!");
    return null;
  }

  const promptText = `أنت نظام Visual OCR متخصص في قراءة وتعريف قنوات التلفزيون.
مرفق صورتان للحدث المباشر (كاملة ومقربة للشعار).

المطلوب استخراجه فقط:
1. اسم القناة الرسمي باللغة العربية مع الرقم الظاهر بجوار الشعار بدقة تامة (مثل: بي إن سبورتس 1, SSC 2). إذا لم يوجد رقم اكتب الاسم فقط بدون تخمين.
2. الفئة (رياضة | أفلام عربية | أفلام أجنبية | مسلسلات | وثائقي | أطفال | ترفيه | إخبارية | دينية | عامة).
3. اللغة (العربية | الإنجليزية | الفرنسية | أخرى).

أعد JSON فقط بهذا الهيكل:
{
  "channel_name": "",
  "category": "",
  "language": "",
  "confidence": 0,
  "reason": ""
}`;

  try {
    const fullImageBuffer = fs.readFileSync(fullImagePath);
    const contents = [
      promptText,
      {
        inlineData: {
          mimeType: 'image/jpeg',
          data: fullImageBuffer.toString('base64')
        }
      }
    ];

    if (fs.existsSync(cropImagePath)) {  
      const cropImageBuffer = fs.readFileSync(cropImagePath);  
      contents.push({  
        inlineData: {  
          mimeType: 'image/jpeg',  
          data: cropImageBuffer.toString('base64')  
        }  
      });  
    }  

    // استدعاء Gemini والانتظار تلقائياً حتى ينهي التحليل ويرجع النتيجة
    const response = await ai.models.generateContent({  
      model: 'gemini-2.0-flash',  
      contents: contents,  
      config: {  
        responseMimeType: "application/json"  
      }  
    }); 

    let text = response.text.trim().replace(/```json/g, '').replace(/```/g, '').trim();  
    const data = JSON.parse(text);  

    if (data.channel_name && data.confidence >= 95) {  
      return {  
        channel_name: data.channel_name,  
        category: data.category || "عامة",  
        language: data.language || "العربية",
        confidence: data.confidence,
        reason: data.reason || ""
      };  
    } else {
      console.log(`[!] تم تجاهل النتيجة لتدني نسبة الثقة (${data.confidence || 0}%): ${data.reason || 'غير محدد'}`);
    }
    return null;

  } catch (e) {
    if (e.message && e.message.includes('429')) {
      console.log("⚠️ تم تجاوز معدل الطلبات (429)، سيتم الانتظار قليلاً لتفريغ الحصة تلقائياً...");
      await new Promise(res => setTimeout(res, 8000));
    } else {
      console.log(`[!] خطأ تحليل Gemini: ${e.message}`);
    }
    return null;
  }
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
  await sendTelegramMessage("🟢 <b>تم تفعيل الفحص التلقائي والدقيق بـ Gemini والنظام!</b>");

  for (let i = 0; i < count; i++) {
    try {
      currentScanningNum = startNum + i;
      currentScanningUrl = `${baseUrl}${currentScanningNum}.ts`;

      process.stdout.write(`[*] فحص ${currentScanningNum} -> `);  

      const valid = await isValidStream(currentScanningUrl);  

      if (valid) {  
        console.log("✅ شغال! جاري الالتقاط والتحليل الآلي...");  

        const tempImgPath = path.join('/tmp', `frame_${currentScanningNum}.jpg`);  
        const cropImgPath = path.join('/tmp', `crop_${currentScanningNum}.jpg`);  

        const captured = await captureLiveFrame(currentScanningUrl, tempImgPath, cropImgPath);  

        if (captured) {  
          // 1. استخراج الدقة حقيقياً عبر النظام بعيداً عن Gemini
          const res = await getStreamResolution(currentScanningUrl);  
          const systemQualityStr = `${res.qualityStr} (${res.width}x${res.height})`;

          // 2. تحليل اسم القناة والفئة واللغة تلقائياً بـ Gemini
          const analysis = await analyzeScreenshotWithGemini(tempImgPath, cropImgPath);  

          if (analysis) {
            const channelName = analysis.channel_name;  
            const category = analysis.category;  
            const language = analysis.language;  

            console.log(`[+] القناة المكتشفة: ${channelName} | ${category} | الدقة: ${res.qualityStr} | الثقة: ${analysis.confidence}%`);  

            const m3uEntry = formatM3uEntry(currentScanningUrl, channelName, category, res.qualityStr);  

            let caption = `✅ <b>قناة جديدة مكتشفة!</b>\n\n`;  
            caption += `📺 <b>اسم القناة:</b> ${channelName}\n`;  
            caption += `🏷️ <b>الفئة:</b> ${category}\n`;  
            caption += `🗣️ <b>اللغة:</b> ${language}\n`;  
            caption += `📐 <b>الدقة (من النظام):</b> ${systemQualityStr}\n`;
            caption += `🎯 <b>نسبة ثقة Gemini:</b> ${analysis.confidence}%\n`;
            if (analysis.reason) caption += `📝 <b>ملاحظة:</b> ${analysis.reason}`;

            await sendTelegramPhoto(tempImgPath, caption);  
            await sendTelegramMessage(`<code>${m3uEntry}</code>`);  
          } else {
            console.log("⚠️ لم يتم التأكد من القناة بنسبة ثقة كافية (أقل من 95%).");
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
