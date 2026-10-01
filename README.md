# WhisperVideoSRT - سامانه تبدیل ویدیو به زیرنویس فارسی و انگلیسی

سامانه سریع، مدرن و خودکفای تبدیل گفتار ویدیو به زیرنویس استاندارد SRT با استفاده از **FFmpeg**، **faster-whisper** و **FastAPI**.
طراحی شده برای استقرار آسان با داکر (Docker Compose) بر روی سرورهای لینوکس بدون نیاز به هیچ‌گونه API یا سرویس خارجی ابری.

---

## 🌟 ویژگی‌های کلیدی (Key Features)

- 🎙️ **هوش مصنوعی faster-whisper محلی**: رونویسی سریع و دقیق با کمترین مصرف حافظه رم بر روی پردازنده‌های معمولی (CPU با کوانتیزاسیون `int8`).
- 🎬 **پشتیبانی از فرمت‌های محبوب**: بارگذاری مستقیم ویدیوهای `mp4.`، `mkv.` و `mov.`.
- 🇮🇷 **پشتیبانی ویژه از زبان فارسی و انگلیسی**: امکان تشخیص خودکار زبان (Auto-detect) یا انتخاب دستی زبان فارسی (`fa`) یا انگلیسی (`en`).
- ⏱️ **خروجی استاندارد SRT**: تولید فایل زیرنویس با انکودینگ معتبر `UTF-8`، تایم‌استمپ‌های دقیق میلی‌ثانیه‌ای (`00:00:01,234 --> 00:00:04,500`) و شمارنده‌های ترتیبی استاندارد.
- ⚡ **معماری ناهمگام (Async Job Processing)**: جلوگیری از مسدود ماندن اتصال کاربر در حین بارگذاری و پردازش ویدیو؛ تحویل فوری شناسه امن (Job ID) و بررسی وضعیت لحظه‌ای با درصد پیشرفت.
- 🔒 **امنیت و محرمانگی**: استفاده از شناسه‌های غیرقابل حدس و تصادفی (Cryptographic Token) و قابلیت تعیین توکن امنیتی/رمز عبور (`API_ACCESS_TOKEN`) برای دسترسی در اینترنت.
- 💾 **کش دائمی مدل‌ها در داکر ولوم (Docker Volume)**: مدل بارگذاری شده در ولوم داکر ذخیره می‌شود و با ری‌استارت شدن کانتینر مجدداً دانلود نمی‌شود.
- 🧹 **پاکسازی خودکار فایل‌های موقت**: سیستم پس‌زمینه Janitor فایل‌های ویدیویی و خروجی‌های قدیمی‌تر از زمان مشخص شده را به صورت خودکار پاک می‌کند.
- 🧩 **معماری ماژولار و قابل توسعه**: جداسازی کامل لایه ذخیره‌سازی (`LocalStorage` با قابلیت تعویض با `S3Storage`) و صف کارها (`JobManager` با قابلیت اتصال به Celery/Redis).

---

## 📁 ساختار پروژه (Project Structure)

```text
├── backend/
│   ├── config.py              # تنظیمات، متغیرهای محیطی و سقف حجم
│   ├── main.py                # برنامه FastAPI، روت‌ها و میدل‌ورها
│   ├── requirements.txt       # پکیج‌های پایتون (fastapi, faster-whisper, ...)
│   ├── test_pipeline.py       # اسکریپت تست خودکار با تولید ویدیوی نمونه
│   └── services/
│       ├── audio.py           # استخراج صوت ۱۶ کیلوهرتز مونو با FFmpeg
│       ├── queue.py           # مدیریت صف کارهای ناهمگام در حافظه
│       ├── srt_formatter.py   # تولید و فرمت‌بندی زیرنویس SRT با UTF-8
│       ├── storage.py         # اینترفیس ذخیره‌سازی (دیسک محلی و الگوی S3)
│       └── transcriber.py     # موتور رونویسی faster-whisper
├── src/                       # رابط کاربری تحت وب (React + Tailwind CSS)
├── compose.yaml               # فایل داکر کامپوز با ولوم‌های پایدار
├── Dockerfile                 # ایمیج بهینه‌شده پایتون ۳.۱۰ با FFmpeg
├── .env.example               # نمونه تنظیمات محیطی
└── README.md                  # راهنمای کامل فارسی و انگلیسی
```

---

## 🚀 راهنمای نصب و اجرای سریع با داکر در لینوکس (Linux Server Installation)

### ۱. پیش‌نیازها
روی سرور لینوکس (مانند Ubuntu 22.04 / 24.04 یا Debian) ابزارهای Docker و Docker Compose را نصب داشته باشید:
```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
```

### ۲. کلون پروژه و آماده‌سازی فایل تنظیمات
```bash
# کپی کردن فایل نمونه متغیرهای محیطی
cp .env.example .env

# ویرایش تنظیمات (اختیاری: تغییر پورت، مدل و سقف حجم)
nano .env
```

### ۳. ساخت ایمیج و اجرای کانتینر (Build & Run)
برای راه‌اندازی در پس‌زمینه سرور:
```bash
docker compose up --build -d
```
> در اولین اجرا، ایمیج ساخته شده و در اولین درخواست، مدل هوش مصنوعی (حدود ۷۵ مگابایت برای مدل `base`) دانلود شده و در ولوم `whisper_models_cache` ذخیره می‌شود.

---

## 🕹️ دستورات مدیریت سرور (Management Commands)

### مشاهده لاگ‌های زنده (View Logs):
```bash
docker compose logs -f whisper-srt-app
```

### توقف برنامه (Stop Application):
```bash
docker compose stop
```

### شروع مجدد برنامه (Restart Application):
```bash
docker compose restart
```

### خاموش کردن کامل و حذف کانتینرها (Down):
```bash
# توجه: ولوم‌های مدل و اطلاعات حفظ خواهند شد
docker compose down
```

### بررسی وضعیت سلامت سرویس (Health Check):
```bash
curl -s http://localhost:8000/api/health
```
پاسخ نمونه:
```json
{
  "status": "healthy",
  "service": "WhisperVideoSRT",
  "model": "base",
  "device": "cpu",
  "compute_type": "int8",
  "max_upload_mb": 500
}
```

---

## 🧪 تست برنامه با ویدیوی نمونه (Testing with Sample Video)

### روش اول: اجرای اسکریپت تست خودکار پایتون
این اسکریپت به صورت خودکار یک ویدیو ۴ ثانیه‌ای با صدا تولید کرده، آن را به API می‌فرستد، وضعیت را تا اتمام رصد کرده و فایل SRT تولید شده را دانلود می‌کند:
```bash
python3 backend/test_pipeline.py
```

### روش دوم: تست دستی از طریق `curl`

۱. **ساخت یک فایل ویدیویی تست در صورت نیاز:**
```bash
ffmpeg -f lavfi -i testsrc=duration=3:size=640x360:rate=25 -f lavfi -i sine=frequency=440:duration=3 -c:v libx264 -c:a aac -b:a 128k sample.mp4
```

۲. **ارسال فایل به سرور و ایجاد جاب:**
```bash
curl -X POST http://localhost:8000/api/jobs/upload \
  -F "file=@sample.mp4" \
  -F "language=fa" \
  -F "model=base"
```
پاسخ دریافتی:
```json
{
  "success": true,
  "job_id": "8kL_9pA1xQmZbV_04uYw72Te",
  "status": "queued",
  "original_filename": "sample.mp4",
  "message": "فایل با موفقیت دریافت و در صف استخراج و رونویسی قرار گرفت."
}
```

۳. **بررسی وضعیت پردازش جاب:**
```bash
curl http://localhost:8000/api/jobs/8kL_9pA1xQmZbV_04uYw72Te
```
پاسخ دریافتی در حین پردازش یا پس از اتمام:
```json
{
  "job_id": "8kL_9pA1xQmZbV_04uYw72Te",
  "status": "completed",
  "progress": 100.0,
  "language_detected": "fa",
  "can_download": true
}
```

۴. **دانلود فایل زیرنویس SRT نهایی:**
```bash
curl -O -J http://localhost:8000/api/jobs/8kL_9pA1xQmZbV_04uYw72Te/download
```

---

## ⚙️ متغیرهای محیطی (Environment Variables)

| متغیر | مقدار پیش‌فرض | توضیحات |
| :--- | :--- | :--- |
| `PORT` | `8000` | پورت اتصال سرور وب |
| `API_ACCESS_TOKEN` | *(خالی)* | توکن امنیتی برای دسترسی حفاظت‌شده به API |
| `UPLOAD_MAX_MB` | `500` | سقف مجاز حجم هر ویدیو (مگابایت) |
| `WHISPER_MODEL` | `base` | مدل ویسپر (`tiny`, `base`, `small`, `medium`, `large-v3`) |
| `DEVICE` | `cpu` | پردازشگر (`cpu` یا `cuda` برای گرافیک انویدیا) |
| `COMPUTE_TYPE` | `int8` | دقت محاسباتی (`int8` مناسب سی‌پی‌یو، `float16` برای GPU) |
| `CPU_THREADS` | `4` | تعداد رشته‌های پردازشی اختصاص‌یافته به تبدیل |
| `TEMP_FILE_RETENTION_HOURS` | `24` | زمان پاکسازی خودکار فایل‌های قدیمی بر حسب ساعت |
| `STORAGE_DIR` | `/data/storage` | مسیر ذخیره‌سازی داده‌ها و آپلودها |
| `MODEL_CACHE_DIR` | `/root/.cache/huggingface` | مسیر کش مدل‌های هوش مصنوعی (متصل به Docker volume) |

---

## ⚠️ محدودیت‌های نسخه آزمایشی فعلی (Trial Version Limitations)

این نسخه به گونه‌ای پیاده‌سازی شده که راه‌اندازی آن بدون وابستگی‌های خارجی پیچیده روی یک سرور به صورت مستقل و بدون دردسر کار کند:

1. **مدیریت صف در حافظه (In-Memory Job Manager):**
   - صف درخواست‌ها و وضعیت جاب‌ها در حافظه موقت (RAM) نگهداری می‌شود. با ری‌استارت شدن کانتینر، تاریخچه درخواست‌های در جریان پاک می‌شود (هرچند فایل‌های تکمیل شده در ولوم داکر ذخیره هستند).
2. **یک کارگر پردازشی تک-نودی (Single Worker Execution):**
   - برای جلوگیری از درگیر شدن بیش از حد پردازنده (CPU Throttling)، جاب‌ها به صورت سریالی یا با کارگر محدود پردازش می‌شوند تا سیستم هنگ نکند.
3. **ذخیره‌سازی روی دیسک محلی (Local Disk Storage):**
   - فایل‌های ویدیو و زیرنویس‌ها در دایرکتوری محلی سرور نگهداری می‌شوند.

---

## 🗺️ نقشه راه ارتقا به نسخه تجاری (Production Scale Roadmap)

برای ارتقا این سامانه به مقیاس نامحدود ابری، کدها از هم‌اکنون به صورت ماژولار طراحی شده‌اند:
1. **انتقال صف کارها به Celery + Redis:**
   - کلاس `JobManager` در فایل `backend/services/queue.py` آماده است تا با ارسال تسک‌های Celery و ذخیره وضعیت در Redis جایگزین شود.
2. **انتقال ذخیره‌سازی به MinIO / S3:**
   - رابط `BaseStorage` در فایل `backend/services/storage.py` پیاده‌سازی شده و کلاس نمونه `S3StorageAdapterStub` قرار دارد که با فعال‌سازی `boto3` و تعریف Bucket، فایل‌ها مستقیماً از Object Storage لود و با Presigned URL دانلود می‌شوند.
3. **شتاب‌دهی سخت‌افزاری با GPU (NVIDIA CUDA):**
   - با افزودن `--gpus all` در داکر کامپوز و تغییر متغیر `DEVICE=cuda` و `COMPUTE_TYPE=float16`، سرعت استخراج تا ۱۰ برابر افزایش می‌یابد.

---

## 📄 مجوز (License)
Apache-2.0 License - آماده برای استقرار سازمانی و توسعه شخصی.
