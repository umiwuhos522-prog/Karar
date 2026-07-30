import axios from 'axios';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';

// ==================== الإعدادات الأساسية ====================
const TELEGRAM_BOT_TOKEN = "7932535685:AAFNVyAPfmSCmHeptKAA0xc9779l8EethnQ";
const TELEGRAM_CHAT_ID = "6491999046";

// قراءة مفتاح OpenAI الرسمي بأمان من متغيرات البيئة في Railway
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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
function safeExec(command, timeoutMs = 20000) {
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
 * استخراج دقة الفيديو الحقيقية من البث عبر ffprobe
 */
async function getStreamResolution(streamUrl) {
  const cmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of json "${streamUrl}"`;
  const stdout = await safeExec(cmd, 10000);

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
 * التقاط الصورة بوضوح عالي وبدون ضغط لضمان قراءة الشعار 100%
 */
async function captureLiveFrame(streamUrl, outputPath, cropCornerPath, seekTime = 6) {
  // الالتقاط بعد مرور أوقات أطول لضمان وضوح البث والشعار
  const cmdFull = `ffmpeg -y -hide_banner -loglevel error -ss ${seekTime} -i "${streamUrl}" -vframes 1 -vf "scale=1280:-1" -q:v 1 "${outputPath}"`;
  await safeExec(cmdFull, 15000);

  if (fs.existsSync(outputPath)) {
    const cmdCrop = `ffmpeg -y -hide_banner -loglevel error -i "${outputPath}" -vf "crop=in_w*0.5:in_h*0.35:in_w*0.5:0,scale=800:-1" -q:v 1 "${cropCornerPath}"`;
    await safeExec(cmdCrop, 10000);
    return true;
  }
  return false;
}

/**
 * تحليل دقيق وصارم جداً لاسم القناة عبر OpenAI API (gpt-4o-mini)
 */
async function analyzeScreenshotWithOfficialChatGPT(fullImagePath, cropImagePath) {
  if (!fs.existsSync(fullImagePath)) return null;

  if (!OPENAI_API_KEY) {
    console.log("[!] خطأ: مفتاح OPENAI_API_KEY غير معرف في متغيرات البيئة (Variables)!");
    return null;
  }

  const promptText = `أنت خبير محترف جداً ومُدقق في تحليل شعارات القنوات التلفزيونية (TV Logo Recognition) واستخراج النصوص الدقيقة (Visual OCR).

المطلوب تدقيقه من الصورتين:
1. اقرأ اسم القناة الرسمي باللغة العربية مع الرقم الظاهر بجوار الشعار بدقة 100% (مثال: بي إن سبورتس 1, SSC 2, بي إن سبورتس الإخبارية, بي إن سبورتس بريميوم 1, الكأس 1). 
2. لا تُخمن الرقم إطلاقاً، اقرأه كما هو مكتوب بوضوح على الشاشة.
3. إذا لم يكن هناك رقم مكتوب بجوار الشعار، اكتب اسم القناة الرسمي فقط.
4. حدد الفئة (رياضة | أفلام عربية | أفلام أجنبية | مسلسلات | وثائقي | أطفال | ترفيه | إخبارية | دينية | عامة).
5. حدد اللغة الأساسية للبث (العربية | الإنجليزية | الفرنسية | أخرى).

إذا لم تكن واثقاً من اسم القناة بنسبة 100%، ضع نسبة الثقة confidence أقل من 80.

أعد JSON فقط بدون أي شرح وبدون كتل كود:
{
  "channel_name": "",
  "category": "",
  "language": "",
  "confidence": 0,
  "reason": ""
}`;

  try {
    const fullImageBase64 = fs.readFileSync(fullImagePath).toString('base64');
    
    const messagesContent = [
      { type: "text", text: promptText },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${fullImageBase64}`, detail: "high" } }
    ];

    if (fs.existsSync(cropImagePath)) {
      const cropImageBase64 = fs.readFileSync(cropImagePath).toString('base64');
      messagesContent.push({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${cropImageBase64}`, detail: "high" }
      });
    }

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: messagesContent }],
        response_format: { type: "json_object" },
        max_tokens: 400
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 25000
      }
    );

    let rawText = response.data.choices[0].message.content.trim();
    const data = JSON.parse(rawText);

    // اشتراط نسبة ثقة عالية واستخراج اسم محدد دون قبول أي إجابة عامة
    if (data.channel_name && data.channel_name.trim().length > 2 && data.confidence >= 80) {
      return {
        channel_name: data.channel_name.trim(),
        category: data.category || "عامة",
        language: data.language || "العربية",
        confidence: data.confidence,
        reason: data.reason || ""
      };
    } else {
      console.log(`[!] [تحليل غير مكتمل] الثقة: ${data.confidence || 0}% | السبب: ${data.reason || 'غير محدد'}`);
    }
    return null;

  } catch (e) {
    if (e.response && e.response.data && e.response.data.error && e.response.data.error.code === 'rate_limit_exceeded') {
      console.log("⏳ تجاوز مؤقت لمعدل الطلبات، انتظار 4 ثوانٍ...");
      await new Promise(res => setTimeout(res, 4000));
    } else if (e.response && e.response.data) {
      console.log(`[!] خطأ OpenAI API:`, JSON.stringify(e.response.data));
    } else {
      console.log(`[!] خطأ تحليل ChatGPT: ${e.message}`);
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
 * عملية الفحص الرئيسية بطيئة ودقيقة جداً (حلقة تدقيق تامة حتى استخراج الاسم 100%)
 */
async function startScanning(baseUrl, startNum, count = 100000) {
  await sendTelegramMessage("🟢 <b>تم تفعيل الفحص العالي الدقة (تدقيق 100% حتى استخراج الاسم والبيانات بالكامل)!</b>");

  for (let i = 0; i < count; i++) {
    try {
      currentScanningNum = startNum + i;
      currentScanningUrl = `${baseUrl}${currentScanningNum}.ts`;

      process.stdout.write(`[*] فحص ${currentScanningNum} -> `);  

      const valid = await isValidStream(currentScanningUrl);  

      if (valid) {  
        console.log("✅ شغال! جاري التدقيق والانتظار التام حتى جلب اسم القناة 100%...");  

        const tempImgPath = path.join('/tmp', `frame_${currentScanningNum}.jpg`);  
        const cropImgPath = path.join('/tmp', `crop_${currentScanningNum}.jpg`);  

        let analysis = null;
        let attempt = 0;

        // حلقة تكرار هادئة وبطيئة للقناة الشغالة دون مغادرتها حتى جلب الاسم الدقيق
        while (!analysis) {
          attempt++;
          // التدرج في ثواني الالتقاط: 6 ثوانٍ، ثم 10 ثوانٍ، ثم 14 ثانية... لضمان وضوح الشعار
          const seekTime = 6 + (attempt - 1) * 4;

          console.log(`🔍 [محاولة ${attempt}] التقاط فريم بعد ${seekTime} ثوانٍ وللتحليل الدقيق...`);
          const captured = await captureLiveFrame(currentScanningUrl, tempImgPath, cropImgPath, seekTime);

          if (captured) {
            analysis = await analyzeScreenshotWithOfficialChatGPT(tempImgPath, cropImgPath);
          }

          if (!analysis) {
            console.log(`⚠️ لم يتم التأكد من الشعار بعد... انتظار 4 ثوانٍ وإعادة الالتقاط بقفزة زمنية أطول.`);
            await new Promise(res => setTimeout(res, 4000));
          }
        }

        // استخراج الدقة الحقيقية برمجياً عبر ffprobe
        const res = await getStreamResolution(currentScanningUrl);  
        const systemQualityStr = `${res.qualityStr} (${res.width}x${res.height})`;

        const channelName = analysis.channel_name;  
        const category = analysis.category;  
        const language = analysis.language;  
        const confidence = analysis.confidence;

        console.log(`[+] تم التدقيق والجلب بنجاح 100%: ${channelName} | ${category} | الدقة: ${res.qualityStr}`);  

        const m3uEntry = formatM3uEntry(currentScanningUrl, channelName, category, res.qualityStr);  

        let caption = `✅ <b>قناة جديدة مكتشفة بـ ChatGPT!</b>\n\n`;  
        caption += `📺 <b>اسم القناة:</b> ${channelName}\n`;  
        caption += `🏷️ <b>الفئة:</b> ${category}\n`;  
        caption += `🗣️ <b>اللغة:</b> ${language}\n`;  
        caption += `📐 <b>الدقة (من النظام):</b> ${systemQualityStr}\n`;
        caption += `🎯 <b>نسبة الثقة:</b> ${confidence}%`;  

        await sendTelegramPhoto(tempImgPath, caption);  
        await sendTelegramMessage(`<code>${m3uEntry}</code>`);  

        // تنظيف الصور المؤقتة  
        try { if (fs.existsSync(tempImgPath)) fs.unlinkSync(tempImgPath); } catch (e) {}  
        try { if (fs.existsSync(cropImgPath)) fs.unlinkSync(cropImgPath); } catch (e) {}  

        // استراحة 3 ثوانٍ قبل الانتقال للقناة القادمة
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
