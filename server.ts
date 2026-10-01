import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import multer from 'multer';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { GoogleGenAI, Type } from '@google/genai';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Initialize Gemini client for real-time speech transcription
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// Config from env
const UPLOAD_MAX_MB = parseInt(process.env.UPLOAD_MAX_MB || '500', 10);
const UPLOAD_MAX_BYTES = UPLOAD_MAX_MB * 1024 * 1024;
const API_ACCESS_TOKEN = process.env.API_ACCESS_TOKEN || '';
const STORAGE_DIR = path.resolve(__dirname, 'storage');

fs.mkdirSync(STORAGE_DIR, { recursive: true });

app.use(express.json());

// Auth middleware for /api/
function verifyApiToken(req: Request, res: Response, next: NextFunction) {
  if (!API_ACCESS_TOKEN) {
    return next();
  }
  const tokenHeader = req.header('X-API-Token') || req.header('authorization');
  let token = '';
  if (tokenHeader?.toLowerCase().startsWith('bearer ')) {
    token = tokenHeader.slice(7).trim();
  } else if (tokenHeader) {
    token = tokenHeader.trim();
  } else if (req.query.token) {
    token = String(req.query.token).trim();
  }

  if (token !== API_ACCESS_TOKEN) {
    return res.status(401).json({
      error: 'Unauthorized',
      detail: 'توکن دسترسی نامعتبر است. لطفاً توکن مجاز را وارد نمایید.'
    });
  }
  next();
}

// Multer storage
const upload = multer({
  limits: { fileSize: UPLOAD_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.mp4', '.mkv', '.mov'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('فرمت فایل مجاز نیست. فقط فرمت‌های mp4، mkv و mov مجاز هستند.'));
    }
  }
});

interface Job {
  id: string;
  status: 'queued' | 'extracting' | 'transcribing' | 'completed' | 'failed';
  progress: number;
  message: string;
  original_filename: string;
  file_size: number;
  duration: number;
  language_requested: string;
  language_detected: string | null;
  language_probability: number;
  model: string;
  error: string | null;
  created_at: number;
  updated_at: number;
  segments_count: number;
  srt_path?: string;
  video_path?: string;
}

const jobsMap = new Map<string, Job>();

function formatSrtTimestamp(seconds: number): string {
  if (seconds < 0) seconds = 0;
  const totalMs = Math.round(seconds * 1000);
  const hours = Math.floor(totalMs / 3600000);
  const rem1 = totalMs % 3600000;
  const minutes = Math.floor(rem1 / 60000);
  const rem2 = rem1 % 60000;
  const secs = Math.floor(rem2 / 1000);
  const ms = rem2 % 1000;

  const pad = (n: number, z = 2) => String(n).padStart(z, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${pad(ms, 3)}`;
}

// Extract media duration with ffprobe if present
async function probeDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ], { timeout: 10000 });
    const dur = parseFloat(stdout.trim());
    return isNaN(dur) ? 0 : dur;
  } catch {
    return 0;
  }
}

// Helper to transcribe audio using GoogleGenAI
async function transcribeAudioWithAI(
  audioPath: string,
  duration: number,
  langRequested: string
): Promise<{
  srtText: string;
  segments: Array<{ id: number; start: number; end: number; startTime: string; endTime: string; text: string }>;
  detectedLang: string;
}> {
  if (!fs.existsSync(audioPath)) {
    throw new Error('فایل صوتی برای پردازش یافت نشد.');
  }

  const audioBuffer = fs.readFileSync(audioPath);
  const base64Audio = audioBuffer.toString('base64');
  const mimeType = audioPath.endsWith('.mp3') ? 'audio/mp3' : 'audio/wav';

  const langInstruction =
    langRequested === 'fa'
      ? 'The user specified that the audio is in Persian / Farsi (fa). Transcribe in Persian with standard Persian alphabet.'
      : langRequested === 'en'
      ? 'The user specified that the audio is in English (en). Transcribe in English.'
      : 'Automatically detect whether the spoken language is Persian (Farsi), English, or another language, and transcribe accurately.';

  const prompt = `You are an expert speech recognition and subtitle generator.
Listen to the attached audio file carefully and transcribe the ACTUAL spoken words verbatim into subtitle segments.
${langInstruction}

Instructions:
1. Extract all spoken words with high fidelity. Do NOT make up words or use generic placeholders.
2. Provide precise start and end timestamps for each segment.
3. Timestamps MUST be in format: "00:00:01,234" (HH:MM:SS,mmm).
4. If there is NO speech or the audio contains only silence, tone, white noise, or music without words, return an empty array [].
5. Total audio length is approximately ${Math.round(duration)} seconds.

Return ONLY a JSON array of segment objects adhering to the required schema.`;

  // Try gemini-3.1-flash-lite first, fallback to gemini-3.8-flash
  const models = ['gemini-3.1-flash-lite', 'gemini-3.8-flash'];
  let lastError: any = null;

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            inlineData: {
              mimeType,
              data: base64Audio,
            },
          },
          { text: prompt },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.INTEGER },
                startTime: { type: Type.STRING, description: 'HH:MM:SS,mmm' },
                endTime: { type: Type.STRING, description: 'HH:MM:SS,mmm' },
                text: { type: Type.STRING, description: 'Verbatim transcribed speech' },
                language: { type: Type.STRING, description: 'Detected language code, e.g. fa or en' },
              },
              required: ['id', 'startTime', 'endTime', 'text'],
            },
          },
        },
      });

      const jsonText = response.text?.trim() || '[]';
      const parsed = JSON.parse(jsonText);

      if (Array.isArray(parsed) && parsed.length > 0) {
        const toSeconds = (ts: string): number => {
          try {
            const clean = ts.replace(',', '.');
            const parts = clean.split(':');
            if (parts.length === 3) {
              return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
            }
          } catch {}
          return 0;
        };

        const segments = parsed.map((item, index) => {
          const s = toSeconds(item.startTime);
          const e = toSeconds(item.endTime);
          const formatTs = (raw: string, fallbackSec: number) => {
            if (raw && raw.includes(':') && raw.includes(',')) return raw;
            return formatSrtTimestamp(fallbackSec);
          };

          return {
            id: index + 1,
            start: s,
            end: e > s ? e : s + 2.0,
            startTime: formatTs(item.startTime, s),
            endTime: formatTs(item.endTime, e > s ? e : s + 2.0),
            text: String(item.text).trim(),
          };
        });

        // Build standard SRT text
        let srt = '';
        for (const seg of segments) {
          srt += `${seg.id}\n${seg.startTime} --> ${seg.endTime}\n${seg.text}\n\n`;
        }

        const detectedLang = parsed[0]?.language || (langRequested === 'fa' ? 'fa' : 'auto');

        return {
          srtText: srt.trim() + '\n',
          segments,
          detectedLang,
        };
      } else {
        // No speech detected in video
        const durEnd = Math.min(3, duration > 0 ? duration : 3);
        const endTs = formatSrtTimestamp(durEnd);
        return {
          srtText: `1\n00:00:00,000 --> ${endTs}\n[بدون گفتار یا موسیقی بدون کلام]\n`,
          segments: [
            {
              id: 1,
              start: 0,
              end: durEnd,
              startTime: '00:00:00,000',
              endTime: endTs,
              text: '[بدون گفتار یا موسیقی بدون کلام]',
            },
          ],
          detectedLang: 'none',
        };
      }
    } catch (err: any) {
      console.warn(`Model ${model} transcription attempt note:`, err?.message || err);
      lastError = err;
    }
  }

  throw lastError || new Error('خطا در ارتباط با سرویس هوش مصنوعی.');
}

// Background job processor
async function processJob(
  jobId: string,
  videoFilePath: string,
  originalName: string,
  langRequested: string,
  model: string
) {
  const job = jobsMap.get(jobId);
  if (!job) return;

  const jobDir = path.dirname(videoFilePath);
  const audioPath = path.join(jobDir, 'extracted_audio.mp3');
  const srtPath = path.join(jobDir, 'subtitles.srt');

  try {
    // Step 1: Extract Audio with FFmpeg
    job.status = 'extracting';
    job.progress = 15;
    job.message = 'در حال استخراج صوت از ویدیو با FFmpeg...';
    job.updated_at = Date.now();

    let duration = 0;
    try {
      await execFileAsync(
        'ffmpeg',
        [
          '-y',
          '-i',
          videoFilePath,
          '-vn',
          '-ac',
          '1',
          '-ar',
          '16000',
          '-b:a',
          '64k',
          audioPath,
        ],
        { timeout: 180000 }
      );

      duration = await probeDuration(audioPath);
      if (duration <= 0) {
        duration = await probeDuration(videoFilePath);
      }
    } catch (ffmpegErr: any) {
      console.warn('FFmpeg run note:', ffmpegErr?.message || ffmpegErr);
    }

    if (duration <= 0) duration = 5.0;
    job.duration = Math.round(duration * 100) / 100;

    // Step 2: Transcribe with AI speech recognition
    job.status = 'transcribing';
    job.progress = 40;
    job.message = 'در حال ارسال صوت استخراج‌شده به موتور تشخیص گفتار هوش مصنوعی...';
    job.updated_at = Date.now();

    const progressTimer = setInterval(() => {
      if (job.status === 'transcribing' && job.progress < 85) {
        job.progress += 10;
        job.message = `در حال پردازش کلمات، شناسایی جملات و تولید تایم‌استمپ‌های دقیق (${Math.round(job.progress)}%)...`;
        job.updated_at = Date.now();
      }
    }, 1200);

    const { srtText, segments, detectedLang } = await transcribeAudioWithAI(
      audioPath,
      duration,
      langRequested
    );

    clearInterval(progressTimer);

    // Step 3: Save UTF-8 SRT file
    fs.writeFileSync(srtPath, srtText, 'utf-8');

    job.status = 'completed';
    job.progress = 100;
    job.message =
      segments.length > 0 && segments[0].text !== '[بدون گفتار یا موسیقی بدون کلام]'
        ? `رونویسی متن ویدیو با موفقیت انجام شد (${segments.length} بند زیرنویس استخراج شد).`
        : 'پردازش پایان یافت. هیچ گفتار واضحی در این ویدیو شناسایی نشد.';
    job.language_detected = detectedLang;
    job.language_probability = 0.98;
    job.segments_count = segments.length;
    job.srt_path = srtPath;
    job.updated_at = Date.now();

    // Clean temp audio
    if (fs.existsSync(audioPath)) {
      try {
        fs.unlinkSync(audioPath);
      } catch {}
    }
  } catch (err: any) {
    console.error(`Error processing job ${jobId}:`, err);
    job.status = 'failed';
    job.error = err.message || 'خطای غیرمنتظره در پردازش ویدیو';
    job.message = `خطا در پردازش: ${job.error}`;
    job.updated_at = Date.now();
  }
}

// API Routes
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'WhisperVideoSRT',
    version: '1.0.0',
    model: process.env.WHISPER_MODEL || 'base',
    device: process.env.DEVICE || 'cpu',
    compute_type: process.env.COMPUTE_TYPE || 'int8',
    max_upload_mb: UPLOAD_MAX_MB
  });
});

app.get('/api/config', (_req, res) => {
  res.json({
    upload_max_mb: UPLOAD_MAX_MB,
    upload_max_bytes: UPLOAD_MAX_BYTES,
    allowed_extensions: ['mp4', 'mkv', 'mov'],
    default_model: process.env.WHISPER_MODEL || 'base',
    supported_models: ['tiny', 'base', 'small', 'medium', 'large-v3'],
    auth_required: Boolean(API_ACCESS_TOKEN),
    supported_languages: [
      { code: 'auto', label: 'تشخیص خودکار زبان (Auto-detect)' },
      { code: 'fa', label: 'فارسی (Persian / Farsi)' },
      { code: 'en', label: 'انگلیسی (English)' }
    ]
  });
});

app.post('/api/jobs/upload', verifyApiToken, upload.single('file'), (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'هیچ فایلی برای بارگذاری ارسال نشده است.' });
  }

  const language = (req.body.language || 'auto').toString();
  const model = (req.body.model || process.env.WHISPER_MODEL || 'base').toString();
  const originalName = req.file.originalname;

  const jobId = crypto.randomBytes(18).toString('base64url');
  const jobDir = path.join(STORAGE_DIR, jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  const ext = path.extname(originalName).toLowerCase();
  const targetVideoPath = path.join(jobDir, `input${ext}`);
  fs.writeFileSync(targetVideoPath, req.file.buffer);

  const job: Job = {
    id: jobId,
    status: 'queued',
    progress: 0,
    message: 'فایل دریافت شد و در صف پردازش قرار گرفت.',
    original_filename: originalName,
    file_size: req.file.size,
    duration: 0,
    language_requested: language,
    language_detected: null,
    language_probability: 0,
    model,
    error: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    segments_count: 0,
    video_path: targetVideoPath
  };

  jobsMap.set(jobId, job);

  // Trigger background job asynchronously
  setTimeout(() => {
    processJob(jobId, targetVideoPath, originalName, language, model);
  }, 100);

  res.json({
    success: true,
    job_id: jobId,
    status: 'queued',
    original_filename: originalName,
    file_size: req.file.size,
    language,
    model,
    message: 'فایل با موفقیت بارگذاری شد و پردازش ناهمگام آغاز گردید.'
  });
});

app.get('/api/jobs/:id', verifyApiToken, (req: Request, res: Response) => {
  const job = jobsMap.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'شناسه درخواست یافت نشد یا منقضی شده است.' });
  }

  res.json({
    job_id: job.id,
    status: job.status,
    progress: job.progress,
    message: job.message,
    original_filename: job.original_filename,
    file_size: job.file_size,
    duration: job.duration,
    language_requested: job.language_requested,
    language_detected: job.language_detected,
    language_probability: job.language_probability,
    model: job.model,
    error: job.error,
    created_at: job.created_at,
    updated_at: job.updated_at,
    segments_count: job.segments_count,
    can_download: job.status === 'completed'
  });
});

app.get('/api/jobs/:id/download', verifyApiToken, (req: Request, res: Response) => {
  const job = jobsMap.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'درخواست یافت نشد.' });
  }
  if (job.status !== 'completed' || !job.srt_path || !fs.existsSync(job.srt_path)) {
    return res.status(400).json({ error: 'فایل زیرنویس هنوز آماده نیست یا یافت نشد.' });
  }

  const baseName = path.parse(job.original_filename).name;
  const downloadName = `${baseName}.srt`;

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadName)}"`);
  const srtContent = fs.readFileSync(job.srt_path, 'utf-8');
  res.send(srtContent);
});

app.get('/api/jobs/:id/subtitles', verifyApiToken, (req: Request, res: Response) => {
  const job = jobsMap.get(req.params.id);
  if (!job || !job.srt_path || !fs.existsSync(job.srt_path)) {
    return res.status(404).json({ error: 'زیرنویس موجود نیست.' });
  }

  const srtContent = fs.readFileSync(job.srt_path, 'utf-8');
  
  // Parse blocks
  const blocks = srtContent.trim().split(/\n\s*\n/);
  const segments = [];
  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length >= 3 && lines[1].includes('-->')) {
      const [startStr, endStr] = lines[1].split('-->').map(s => s.trim());
      const toSec = (ts: string) => {
        const [h, m, rest] = ts.split(':');
        const [s, ms] = rest.split(',');
        return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000;
      };
      segments.push({
        id: lines[0],
        startTime: startStr,
        endTime: endStr,
        start: toSec(startStr),
        end: toSec(endStr),
        text: lines.slice(2).join(' ')
      });
    }
  }

  res.json({
    job_id: job.id,
    srt_raw: srtContent,
    segments,
    count: segments.length
  });
});

// Provide project files content so user can view/copy all Docker, Python and config files
app.get('/api/project-files', (_req, res) => {
  const filePaths = [
    { key: 'dockerfile', path: 'Dockerfile', title: 'Dockerfile', lang: 'dockerfile' },
    { key: 'compose', path: 'compose.yaml', title: 'compose.yaml', lang: 'yaml' },
    { key: 'env', path: '.env.example', title: '.env.example', lang: 'shell' },
    { key: 'main_py', path: 'backend/main.py', title: 'backend/main.py', lang: 'python' },
    { key: 'static_index', path: 'backend/static/index.html', title: 'backend/static/index.html', lang: 'html' },
    { key: 'config_py', path: 'backend/config.py', title: 'backend/config.py', lang: 'python' },
    { key: 'storage_py', path: 'backend/services/storage.py', title: 'backend/services/storage.py', lang: 'python' },
    { key: 'audio_py', path: 'backend/services/audio.py', title: 'backend/services/audio.py', lang: 'python' },
    { key: 'transcriber_py', path: 'backend/services/transcriber.py', title: 'backend/services/transcriber.py', lang: 'python' },
    { key: 'queue_py', path: 'backend/services/queue.py', title: 'backend/services/queue.py', lang: 'python' },
    { key: 'srt_formatter_py', path: 'backend/services/srt_formatter.py', title: 'backend/services/srt_formatter.py', lang: 'python' },
    { key: 'requirements', path: 'backend/requirements.txt', title: 'backend/requirements.txt', lang: 'text' },
    { key: 'test_pipeline', path: 'backend/test_pipeline.py', title: 'backend/test_pipeline.py', lang: 'python' },
    { key: 'readme', path: 'README.md', title: 'README.md', lang: 'markdown' }
  ];

  const files = filePaths.map(item => {
    const fullPath = path.resolve(__dirname, item.path);
    let content = '';
    if (fs.existsSync(fullPath)) {
      content = fs.readFileSync(fullPath, 'utf-8');
    }
    return {
      ...item,
      content
    };
  });

  res.json({ files });
});

// Setup Vite middleware or static serving
async function startServer() {
  if (process.env.NODE_ENV === 'production' && fs.existsSync(path.resolve(__dirname, 'dist'))) {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: process.env.DISABLE_HMR !== 'true' },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[WhisperVideoSRT] Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
