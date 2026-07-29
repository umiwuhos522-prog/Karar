import sys
import subprocess
import requests
import json
import os

# التثبيت التلقائي للمكتبات إن لم تكن موجودة
def install_and_import(package, import_name=None):
    if import_name is None:
        import_name = package
    try:
        __import__(import_name)
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", package])

install_and_import("requests")
install_and_import("google-genai", "google.genai")

from google import genai

# ==================== الإعدادات الأساسية ====================
TELEGRAM_BOT_TOKEN = "7932535685:AAFNVyAPfmSCmHeptKAA0xc9779l8EethnQ"
TELEGRAM_CHAT_ID = "6491999046"

# ضع مفتاح Gemini API الخاص بك هنا
GEMINI_API_KEY = os.environ.get("AIzaSyDqlfbn5shYklhde9cn3dl_d-UwqPzmSs0")
client = genai.Client(api_key=GEMINI_API_KEY)

def send_telegram_message(message):
    """إرسال النتيجة إلى تليجرام بصيغة HTML"""
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": message,
        "parse_mode": "HTML"
    }
    try:
        requests.post(url, data=payload, timeout=5)
    except Exception as e:
        print(f"[!] فشل إرسال الرسالة لتليجرام: {e}")

def get_stream_height_and_meta(url):
    """استخراج دقة الفيديو وأي بيانات وصفية عبر ffprobe"""
    cmd = [
        'ffprobe',
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,codec_name',
        '-of', 'json',
        url
    ]
    try:
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=6, text=True)
        data = json.loads(result.stdout)
        if 'streams' in data and len(data['streams']) > 0:
            stream = data['streams'][0]
            return stream.get('height', 0), stream.get('width', 0), stream.get('codec_name', '')
    except Exception:
        pass
    return 0, 0, ''

def is_valid_stream(url):
    """فحص أن البث حقيقي ويعمل"""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
    }
    try:
        with requests.get(url, timeout=5, headers=headers, stream=True, allow_redirects=True) as resp:
            if resp.status_code != 200:
                return False
            content_type = resp.headers.get('Content-Type', '').lower()
            if 'text/html' in content_type:
                return False
            chunk = next(resp.iter_content(chunk_size=512), b'')
            if b'<html' in chunk.lower() or b'<!doctype' in chunk.lower():
                return False
            return True
    except Exception:
        return False

def analyze_channel_with_gemini(url, height):
    """
    استخدام Gemini الذكي لتحليل وتحديد اسم القناة، هل هي عربية أم لا، 
    وتحديد الفئة (رياضة، مسلسلات، كرتون، أطفال، أفلام، إسلامي، إخباري...) بدقة ذكية.
    """
    prompt = f"""
    You are an expert IPTV stream analyzer. I have an active video stream URL: {url} with video height {height}p.
    Based on common IPTV naming structures and stream patterns for Arab/Middle Eastern television networks (like beIN Sports, MBC, OSN, Rotana, Shahid, SSC, etc.), analyze what kind of channel this typically is or infer its identity based on the URL index/pattern, or provide a smart professional classification.
    
    You must respond strictly in valid JSON format with the following keys:
    - "is_arabic": true or false (Only true if it is an Arabic channel or broadcasting in Arabic)
    - "channel_name": Professional name of the channel in Arabic (e.g. "beIN Sports 1 HD", "MBC 1", "سبيستون", etc.)
    - "category": Category in Arabic (e.g. "قنوات الرياضة", "مسلسلات وبرامج", "أطفال وكرتون", "أفلام", "إخبارية", etc.)
    - "description": Brief description in Arabic.

    If you cannot determine the exact channel, give it a smart generic Arabic IPTV title based on its resolution and context, but ensure "is_arabic" is true only if it's clearly an Arabic content stream.
    """
    
    try:
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
        )
        text = response.text.strip()
        # تنظيف كود جيسون إن وجد في الرد
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()
            
        data = json.loads(text)
        return data
    except Exception as e:
        print(f"[!] خطأ في تحليل Gemini: {e}")
        return {
            "is_arabic": True,
            "channel_name": "قناة منوعة",
            "category": "قنوات عامة",
            "description": "بث مباشر"
        }

def format_m3u_entry(url, channel_name_ar, category_ar, height):
    """تنسيق القناة بصيغة M3U احترافية"""
    logo_url = "https://upload.wikimedia.org/wikipedia/commons/d/d7/Bein_sport_ana_logo.png"
    
    if height >= 1080:
        quality_str = "بدقة عالية جداً 1080p"
    elif height >= 720:
        quality_str = "بدقة عالية 720p"
    elif height >= 480:
        quality_str = "بدقة متوسطة 480p"
    elif height > 0:
        quality_str = f"بدقة {height}p"
    else:
        quality_str = "بدقة غير معروفة"

    group_title = f"⭐ {category_ar} | {quality_str} ⭐"
    
    m3u_text = (
        f"# {group_title}\n"
        f'#EXTINF:-1 tvg-logo="{logo_url}" group-title="{group_title}", {channel_name_ar}\n'
        f"{url}"
    )
    return m3u_text

def start_scanning(base_url, start_num, count=50):
    print("[-] بدء فحص القنوات والتحقق منها عبر ذكاء Gemini الاصطناعي...")
    found_arabic = 0
    
    for i in range(count):
        current_num = start_num + i
        test_url = f"{base_url}{current_num}.ts"
        
        print(f"[*] فحص الرابط: {test_url}", end=" -> ")
        
        if is_valid_stream(test_url):
            print("✅ شغال! جاري فحص الجودة والتحليل بالذكاء الاصطناعي...")
            height, width, codec = get_stream_height_and_meta(test_url)
            
            # استدعاء Gemini لتحليل البث ومعرفة هل هو عربي وتصنيفه (رياضة، كرتون، مسلسلات...)
            analysis = analyze_channel_with_gemini(test_url, height)
            
            if analysis.get("is_arabic", False):
                found_arabic += 1
                channel_name = analysis.get("channel_name", f"قناة عربية {found_arabic}")
                category = analysis.get("category", "قنوات عامة")
                
                print([+] قناة عربية مكتشفة: {channel_name} [{category}] - الدقة: {height}p)
                
                m3u_entry = format_m3u_entry(test_url, channel_name, category, height)
                send_telegram_message(f"<code>{m3u_entry}</code>")
            else:
                print("[-] القناة غير عربية، تم تخطيها.")
        else:
            print("❌ لا يعمل")

if __name__ == "__main__":
    BASE_URL = "http://xvip.pro/live/hend0815/08152023/"
    START_NUMBER = 340315
    start_scanning(BASE_URL, START_NUMBER, count=20)
