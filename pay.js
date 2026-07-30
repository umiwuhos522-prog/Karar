import axios from 'axios';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';

// ==================== الإعدادات الأساسية ====================
const TELEGRAM_BOT_TOKEN = "7932535685:AAFNVyAPfmSCmHeptKAA0xc9779l8EethnQ";
const TELEGRAM_CHAT_ID = "6491999046";

// قراءة مفتاح API بأمان من متغيرات البيئة في Railway
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

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
function safeExec(command, timeoutMs = 10000) {
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
      timeout: 12000  
    });
  } catch (e) {
    console.log(`[!] فشل إرسال الصورة: ${e.message}`);
  }
}

/**
 * استخراج دقة الفيديو الحقيقية من البث عبر ffprobe
 */
async function getStreamResolution(streamUrl) {
  const cmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of json "${streamUrl}"`;
  const stdout = await safeExec(cmd, 6000);

  if (stdout) {
    try {
      const data = JSON.parse(stdout);
      if (data.streams && data.streams.length > 0) {
        return {
          width: data.streams[0].width || 1920,
          height: data.streams[0].height || 1080
        };
      }
    } catch (e) {}
  }
  return { width: 1920, height: 1080 };
}

/**
 * التقاط الصورة الكاملة + أخذ زاوية مكبرة لضمان ألا يخرج الرقم عن الإطار
 */
async function captureLiveFrame(streamUrl, outputPath, cropCornerPath) {
  const cmdFull = `ffmpeg -y -hide_banner -loglevel error -ss 3 -i "${streamUrl}" -vframes 1 -q:v 1 "${outputPath}"`;
  await safeExec(cmdFull, 10000);

  if (fs.existsSync(outputPath)) {
    // اقتطاع واسع للربع العلوي الأيمن كاملاً مع تكبيره لضمان ظهور أي رقم بجوار الشعار
    const cmdCrop = `ffmpeg -y -hide_banner -loglevel error -i "${outputPath}" -vf "crop=in_w*0.5:in_h*0.35:in_w*0.5:0,scale=1000:-1" -q:v 1 "${cropCornerPath}"`;
    await safeExec(cmdCrop, 6000);
    return true;
  }
  return false;
}

/**
 * تحليل البث باستخدام Anthropic Claude (Claude 3.5 Sonnet)
 */
async function analyzeScreenshotWithClaude(fullImagePath, cropImagePath) {
  if (!fs.existsSync(fullImagePath)) return null;

  if (!ANTHROPIC_API_KEY) {
    console.log("[!] خطأ: مفتاح ANTHROPIC_API_KEY غير معرف في متغيرات البيئة (Variables)!");
    return null;
  }

  const promptText = `أنت خبير متقدم جداً في تحليل شعارات القنوات التلفزيونية (TV Logo Recognition) وقراءة النصوص الصغيرة (Visual OCR).

سيتم تزويدك بصورة واحدة أو أكثر لنفس البث (صورة كاملة وصورة مقربة).

المطلوب:

1. حدد اسم القناة الرسمي كما يظهر على الشاشة.
2. اقرأ الرقم أو الكلمة المكتوبة بجوار الشعار بدقة تامة.
3. لا تخمن الرقم إطلاقاً.
4. إذا لم يكن الرقم واضحاً فاكتب اسم القناة فقط بدون إضافة أي رقم.
5. إذا كان الشعار يحتوي على كلمات مثل:
   Premium
   MAX
   Xtra
   News
   Extra
   HD
   4K
   UHD
   فقم بإضافتها إذا كانت ظاهرة بوضوح.
6. لا تعتمد على شكل الشعار فقط، بل اقرأ النص فعلياً.
7. إذا كانت هناك أكثر من صورة فاعتبرها لنفس القناة واستخرج أفضل نتيجة.
8. تجاهل نتيجة إذا كانت نسبة الثقة أقل من 95%.

بعد تحديد القناة:

- حدد الفئة:
  رياضة
  أفلام عربية
  أفلام أجنبية
  مسلسلات
  وثائقي
  أطفال
  ترفيه
  موسيقى
  إخبارية
  دينية
  تعليمية
  عامة
  أخرى

- حدد اللغة الأساسية:
  العربية
  الإنجليزية
  الفرنسية
  التركية
  الفارسية
  الهندية
  الإسبانية
  الروسية
  الصينية
  اليابانية
  أخرى

- استخرج الدقة الظاهرة إن كانت مكتوبة داخل الصورة:
  SD
  HD
  FHD
  UHD
  4K

إذا لم تكن مكتوبة فاكتب:
Unknown

أعد JSON فقط بدون أي شرح وبدون كتل كود (code blocks).

{
  "channel_name": "",
  "category": "",
  "language": "",
  "quality": "",
  "confidence": 0,
  "reason": ""
}`;

  try {
    const fullImageBase64 = fs.readFileSync(fullImagePath).toString('base64');
    
    // إعداد الرسالة مع دعم الصور المزدوجة
    const content = [];

    // إضافة الصورة الكاملة
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: fullImageBase64
      }
    });

    // إضافة الصورة المقربة إن وجدت
    if (fs.existsSync(cropImagePath)) {
      const cropImageBase64 = fs.readFileSync(cropImagePath).toString('base64');
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: cropImageBase64
        }
      });
    }

    // إضافة النص المطلوب في النهاية
    content.push({
      type: "text",
      text: promptText
    });

    // إرسال الطلب لـ Anthropic API
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1024,
        messages: [{ role: 'user', content: content }]
      },
      {
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        timeout: 15000
      }
    );

    let rawText = response.data.content[0].text.trim();
    rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    const data = JSON.parse(rawText);

    if (data.channel_name && data.confidence >= 95) {
      return {
        channel_name: data.channel_name,
        category: data.category || "عامة",
        language: data.language || "العربية",
        quality: data.quality || "Unknown",
        confidence: data.confidence,
        reason: data.reason || ""
      };
    } else {
      console.log(`[!] تم تجاهل النتيجة من Claude لتدني نسبة الثقة (${data.confidence || 0}%): ${data.reason || 'غير محدد'}`);
    }
    return null;

  } catch (e) {
    if (e.response && e.response.data) {
      console.log(`[!] خطأ Anthropic API:`, JSON.stringify(e.response.data));
    } else {
      console.log(`[!] خطأ تحليل Claude: ${e.message}`);
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
  await sendTelegramMessage("🟢 <b>تم تفعيل الفحص والتحليل باستخدام Anthropic Claude 3.5 Sonnet!</b>");

  for (let i = 0; i < count; i++) {
    try {
      currentScanningNum = startNum + i;
      currentScanningUrl = `${baseUrl}${currentScanningNum}.ts`;

      process.stdout.write(`[*] فحص ${currentScanningNum} -> `);  

      const valid = await isValidStream(currentScanningUrl);  

      if (valid) {  
        console.log("✅ شغال! جاري الالتقاط بزاويتين وتحليل الشعار بـ Claude...");  

        const tempImgPath = path.join('/tmp', `frame_${currentScanningNum}.jpg`);  
        const cropImgPath = path.join('/tmp', `crop_${currentScanningNum}.jpg`);  

        const captured = await captureLiveFrame(currentScanningUrl, tempImgPath, cropImgPath);  

        if (captured) {  
          const res = await getStreamResolution(currentScanningUrl);  
          const streamQualityStr = res.height >= 1080 ? `${res.height}p FHD` : `${res.height}p HD`;  

          // تحليل الشعار بواسطة Claude
          const analysis = await analyzeScreenshotWithClaude(tempImgPath, cropImgPath);  

          if (analysis) {
            const channelName = analysis.channel_name;  
            const category = analysis.category;  
            const language = analysis.language;  
            const logoQuality = analysis.quality !== "Unknown" ? analysis.quality : streamQualityStr;

            console.log(`[+] القناة المكتشفة: ${channelName} | ${category} | ${logoQuality} | الثقة: ${analysis.confidence}%`);  

            const m3uEntry = formatM3uEntry(currentScanningUrl, channelName, category, logoQuality);  

            let caption = `✅ <b>قناة جديدة مكتشفة بـ Claude!</b>\n\n`;  
            caption += `📺 <b>اسم القناة:</b> ${channelName}\n`;  
            caption += `🏷️ <b>الفئة:</b> ${category}\n`;  
            caption += `🗣️ <b>اللغة:</b> ${language}\n`;  
            caption += `📐 <b>الدقة المكتشفة:</b> ${logoQuality}\n`;
            caption += `🎯 <b>نسبة الثقة:</b> ${analysis.confidence}%\n`;
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

        // انتظار 3 ثوانٍ بين الطلبات
        await new Promise(res => setTimeout(res, 3000));  
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
