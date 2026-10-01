import React, { useState, useEffect, useRef } from 'react';
import {
  UploadCloud,
  FileVideo,
  CheckCircle2,
  Clock,
  AlertCircle,
  Download,
  Play,
  Pause,
  RefreshCw,
  Key,
  Copy,
  Check,
  Code,
  Terminal,
  Trash2,
  FileText,
  Sparkles,
  Cpu,
  Layers,
  Search,
  ExternalLink,
  Info,
  Server
} from 'lucide-react';

interface JobData {
  job_id: string;
  status: 'queued' | 'extracting' | 'transcribing' | 'completed' | 'failed';
  progress: number;
  message: string;
  original_filename: string;
  file_size: number;
  duration?: number;
  language_requested?: string;
  language_detected?: string | null;
  language_probability?: number;
  model?: string;
  error?: string | null;
  segments_count?: number;
  can_download?: boolean;
}

interface SubtitleSegment {
  id: string | number;
  startTime: string;
  endTime: string;
  start: number;
  end: number;
  text: string;
}

interface ProjectFile {
  key: string;
  path: string;
  title: string;
  lang: string;
  content: string;
}

export default function App() {
  // Navigation
  const [activeTab, setActiveTab] = useState<'transcribe' | 'viewer' | 'docker'>('transcribe');

  // Config & Auth
  const [apiToken, setApiToken] = useState<string>(() => localStorage.getItem('whisper_api_token') || '');
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [tempTokenInput, setTempTokenInput] = useState(apiToken);
  const [serverConfig, setServerConfig] = useState<{
    upload_max_mb: number;
    allowed_extensions: string[];
    default_model: string;
    supported_models: string[];
    auth_required: boolean;
  }>({
    upload_max_mb: 500,
    allowed_extensions: ['mp4', 'mkv', 'mov'],
    default_model: 'base',
    supported_models: ['tiny', 'base', 'small', 'medium', 'large-v3'],
    auth_required: false,
  });

  // Upload Form State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('auto');
  const [selectedModel, setSelectedModel] = useState<string>('base');
  const [fileError, setFileError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // Active Job State
  const [currentJob, setCurrentJob] = useState<JobData | null>(() => {
    const saved = localStorage.getItem('whisper_active_job');
    return saved ? JSON.parse(saved) : null;
  });
  const [copiedJobId, setCopiedJobId] = useState(false);
  const [pollIntervalId, setPollIntervalId] = useState<any>(null);

  // Subtitle Viewer State
  const [subtitles, setSubtitles] = useState<SubtitleSegment[]>([]);
  const [rawSrt, setRawSrt] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeSegmentId, setActiveSegmentId] = useState<string | number | null>(null);
  const [copiedSrt, setCopiedSrt] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Docker & Code Files State
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  const [selectedFileKey, setSelectedFileKey] = useState<string>('compose');
  const [copiedCode, setCopiedCode] = useState(false);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);

  // Fetch initial config
  useEffect(() => {
    fetch('/api/config')
      .then((res) => res.json())
      .then((data) => {
        if (data.upload_max_mb) setServerConfig(data);
      })
      .catch((err) => console.log('Config fetch note:', err));
  }, []);

  // Sync token with localStorage
  const handleSaveToken = () => {
    const cleaned = tempTokenInput.trim();
    setApiToken(cleaned);
    localStorage.setItem('whisper_api_token', cleaned);
    setTokenModalOpen(false);
  };

  // File selection validation
  const validateAndSetFile = (file: File) => {
    setFileError(null);
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !['mp4', 'mkv', 'mov'].includes(ext)) {
      setFileError('فرمت فایل پشتیبانی نمی‌شود. لطفاً یکی از فرمت‌های mp4، mkv یا mov را انتخاب کنید.');
      setSelectedFile(null);
      return;
    }

    const maxBytes = serverConfig.upload_max_mb * 1024 * 1024;
    if (file.size > maxBytes) {
      setFileError(`حجم فایل (${(file.size / (1024 * 1024)).toFixed(1)}MB) بیش از سقف مجاز سرور (${serverConfig.upload_max_mb}MB) است.`);
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
    // Create object URL for local video playback preview
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
    }
    setVideoUrl(URL.createObjectURL(file));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  // Upload and start job
  const handleStartJob = async () => {
    if (!selectedFile) return;
    setIsUploading(true);
    setFileError(null);

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('language', selectedLanguage);
    formData.append('model', selectedModel);

    try {
      const headers: Record<string, string> = {};
      if (apiToken) {
        headers['X-API-Token'] = apiToken;
      }

      const res = await fetch('/api/jobs/upload', {
        method: 'POST',
        headers,
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ detail: 'خطا در بارگذاری فایل' }));
        throw new Error(errData.detail || errData.error || `خطا (${res.status})`);
      }

      const data = await res.json();
      const initialJob: JobData = {
        job_id: data.job_id,
        status: 'queued',
        progress: 5,
        message: 'فایل با موفقیت ارسال شد و در نوبت پردازش قرار گرفت...',
        original_filename: data.original_filename,
        file_size: data.file_size,
        language_requested: data.language,
        model: data.model,
      };

      setCurrentJob(initialJob);
      localStorage.setItem('whisper_active_job', JSON.stringify(initialJob));
      startJobPolling(data.job_id);
    } catch (err: any) {
      setFileError(err.message || 'خطا در ارتباط با سرور.');
    } finally {
      setIsUploading(false);
    }
  };

  // Polling for job status
  const startJobPolling = (jobId: string) => {
    if (pollIntervalId) clearInterval(pollIntervalId);

    const poll = async () => {
      try {
        const headers: Record<string, string> = {};
        if (apiToken) headers['X-API-Token'] = apiToken;

        const res = await fetch(`/api/jobs/${jobId}`, { headers });
        if (!res.ok) {
          if (res.status === 404) {
            clearInterval(id);
          }
          return;
        }

        const job: JobData = await res.json();
        setCurrentJob(job);
        localStorage.setItem('whisper_active_job', JSON.stringify(job));

        if (job.status === 'completed') {
          clearInterval(id);
          fetchSubtitles(job.job_id);
        } else if (job.status === 'failed') {
          clearInterval(id);
        }
      } catch (e) {
        console.error('Job polling error:', e);
      }
    };

    const id = setInterval(poll, 1500);
    setPollIntervalId(id);
    poll(); // Run immediately
  };

  // Poll on component mount if an active job is in progress
  useEffect(() => {
    if (currentJob && ['queued', 'extracting', 'transcribing'].includes(currentJob.status)) {
      startJobPolling(currentJob.job_id);
    } else if (currentJob?.status === 'completed' && subtitles.length === 0) {
      fetchSubtitles(currentJob.job_id);
    }
    return () => {
      if (pollIntervalId) clearInterval(pollIntervalId);
    };
  }, []);

  // Fetch subtitles for viewer
  const fetchSubtitles = async (jobId: string) => {
    try {
      const headers: Record<string, string> = {};
      if (apiToken) headers['X-API-Token'] = apiToken;

      const res = await fetch(`/api/jobs/${jobId}/subtitles`, { headers });
      if (res.ok) {
        const data = await res.json();
        setSubtitles(data.segments || []);
        setRawSrt(data.srt_raw || '');
      }
    } catch (e) {
      console.error('Error fetching subtitles:', e);
    }
  };

  // Download SRT file
  const handleDownloadSrt = (jobId: string, filename: string) => {
    const tokenQuery = apiToken ? `?token=${encodeURIComponent(apiToken)}` : '';
    const downloadUrl = `/api/jobs/${jobId}/download${tokenQuery}`;
    const a = document.createElement('a');
    a.href = downloadUrl;
    const baseName = filename.replace(/\.[^/.]+$/, '');
    a.download = `${baseName}.srt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Fetch project files for Docker & code inspector
  useEffect(() => {
    if (activeTab === 'docker' && projectFiles.length === 0) {
      setIsLoadingFiles(true);
      fetch('/api/project-files')
        .then((res) => res.json())
        .then((data) => {
          if (data.files) {
            setProjectFiles(data.files);
          }
        })
        .catch((err) => console.error('Files fetch error:', err))
        .finally(() => setIsLoadingFiles(false));
    }
  }, [activeTab]);

  // Video time update synchronization with subtitles
  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const time = videoRef.current.currentTime;
    setCurrentTime(time);

    const active = subtitles.find((s) => time >= s.start && time <= s.end);
    setActiveSegmentId(active ? active.id : null);
  };

  const seekToSegment = (startSec: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = startSec;
      videoRef.current.play();
      setIsPlaying(true);
    }
  };

  const copyToClipboard = (text: string, setCopied: (v: boolean) => void) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Generate synthetic test video directly in browser if user has no sample video
  const createSyntheticTestVideo = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw background & Persian sample text
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ویدیوی نمونه آزمایشی برای رونویسی هوش مصنوعی', 320, 160);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '16px sans-serif';
    ctx.fillText('Faster-Whisper CPU int8 with FFmpeg Speech Pipeline', 320, 200);

    const stream = canvas.captureStream(25);

    // Add audio track with Web Audio API oscillator
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const dst = audioCtx.createMediaStreamDestination();
    osc.frequency.setValueAtTime(440, audioCtx.currentTime);
    osc.connect(dst);
    osc.start();

    // Combine tracks
    const combinedTracks = [...stream.getVideoTracks(), ...dst.stream.getAudioTracks()];
    const combinedStream = new MediaStream(combinedTracks);

    const mime = MediaRecorder.isTypeSupported('video/mp4')
      ? 'video/mp4'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm'
      : 'video/webm';

    try {
      const recorder = new MediaRecorder(combinedStream, { mimeType: mime });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        osc.stop();
        const blob = new Blob(chunks, { type: 'video/mp4' });
        const testFile = new File([blob], 'sample_video.mp4', { type: 'video/mp4' });
        validateAndSetFile(testFile);
      };

      recorder.start();
      setTimeout(() => recorder.stop(), 3000);
    } catch {
      // Fallback dummy file
      const dummyBlob = new Blob(['sample-video-content'], { type: 'video/mp4' });
      const dummyFile = new File([dummyBlob], 'sample_demo.mp4', { type: 'video/mp4' });
      validateAndSetFile(dummyFile);
    }
  };

  const currentSelectedFileObj = projectFiles.find((f) => f.key === selectedFileKey) || projectFiles[0];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-['Vazirmatn',sans-serif]">
      {/* Top Navbar */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          {/* Logo & Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-violet-600 to-amber-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-white via-slate-200 to-amber-300 bg-clip-text text-transparent">
                  تبدیل ویدیو به زیرنویس
                </span>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-300 border border-violet-500/30">
                  faster-whisper
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">
                تولید خودکار زیرنویس استاندارد SRT با FFmpeg و هوش مصنوعی محلی
              </p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={() => setActiveTab('transcribe')}
              className={`flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                activeTab === 'transcribe'
                  ? 'bg-violet-600 text-white shadow-md shadow-violet-600/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
            >
              <UploadCloud className="w-4 h-4" />
              <span>بارگذاری و پردازش</span>
            </button>

            <button
              onClick={() => setActiveTab('viewer')}
              className={`flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                activeTab === 'viewer'
                  ? 'bg-violet-600 text-white shadow-md shadow-violet-600/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>پیش‌نمایش زیرنویس</span>
              {subtitles.length > 0 && (
                <span className="text-[10px] bg-violet-400 text-slate-950 font-bold px-1.5 py-0.2 rounded-full">
                  {subtitles.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('docker')}
              className={`flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                activeTab === 'docker'
                  ? 'bg-violet-600 text-white shadow-md shadow-violet-600/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
            >
              <Terminal className="w-4 h-4" />
              <span className="hidden md:inline">داکر و کدهای سرور</span>
              <span className="md:hidden">داکر</span>
            </button>

            {/* Auth Token Button */}
            <button
              onClick={() => setTokenModalOpen(true)}
              title="تنظیم توکن دسترسی API"
              className={`p-2 rounded-lg border transition-all ${
                apiToken
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-slate-800/50 border-slate-700/60 text-slate-400 hover:text-white'
              }`}
            >
              <Key className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        {/* TAB 1: Transcribe & Upload */}
        {activeTab === 'transcribe' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left/Main Column: Upload Box & Parameters */}
            <div className="lg:col-span-7 space-y-6">
              {/* Upload Card */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl relative overflow-hidden">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base sm:text-lg font-bold flex items-center gap-2 text-white">
                    <FileVideo className="w-5 h-5 text-violet-400" />
                    انتخاب یا کشیدن فایل ویدیو
                  </h2>
                  <span className="text-xs text-slate-400">
                    فرمت‌های مجاز: <code className="text-amber-400 font-mono">mp4, mkv, mov</code>
                  </span>
                </div>

                {/* Dropzone */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-xl p-6 sm:p-8 text-center transition-all cursor-pointer relative ${
                    dragActive
                      ? 'border-violet-500 bg-violet-500/10'
                      : selectedFile
                      ? 'border-emerald-500/50 bg-emerald-500/5'
                      : 'border-slate-700 hover:border-slate-600 bg-slate-950/40 hover:bg-slate-950/70'
                  }`}
                  onClick={() => document.getElementById('video-file-input')?.click()}
                >
                  <input
                    id="video-file-input"
                    type="file"
                    accept=".mp4,.mkv,.mov,video/mp4,video/x-matroska,video/quicktime"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        validateAndSetFile(e.target.files[0]);
                      }
                    }}
                  />

                  {selectedFile ? (
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                        <CheckCircle2 className="w-8 h-8" />
                      </div>
                      <div>
                        <p className="font-semibold text-white text-base max-w-sm truncate" title={selectedFile.name}>
                          {selectedFile.name}
                        </p>
                        <p className="text-xs text-slate-400 mt-1">
                          حجم: {(selectedFile.size / (1024 * 1024)).toFixed(2)} مگابایت | فرمت:{' '}
                          {selectedFile.name.split('.').pop()?.toUpperCase()}
                        </p>
                      </div>
                      <span className="text-xs text-violet-400 hover:underline mt-1">
                        برای تغییر فایل، کلیک یا فایل جدیدی رها کنید
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-14 h-14 rounded-2xl bg-violet-600/10 text-violet-400 flex items-center justify-center border border-violet-500/20">
                        <UploadCloud className="w-8 h-8" />
                      </div>
                      <div>
                        <p className="font-semibold text-slate-200 text-sm sm:text-base">
                          فایل ویدیوی خود را اینجا رها کنید، یا برای انتخاب کلیک نمایید
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          حداکثر حجم مجاز: {serverConfig.upload_max_mb} مگابایت
                        </p>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            createSyntheticTestVideo();
                          }}
                          className="px-3 py-1 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 transition-all flex items-center gap-1.5"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>استفاده از ویدیوی تستی برای آزمایش سریع</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Validation Error */}
                {fileError && (
                  <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs sm:text-sm flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <span>{fileError}</span>
                  </div>
                )}

                {/* Processing Settings */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5 pt-5 border-t border-slate-800/80">
                  {/* Language Selection */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      زبان رونویسی (Language)
                    </label>
                    <select
                      value={selectedLanguage}
                      onChange={(e) => setSelectedLanguage(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-violet-500 transition-all"
                    >
                      <option value="auto">تشخیص خودکار زبان (Auto-detect)</option>
                      <option value="fa">فارسی (Persian / Farsi)</option>
                      <option value="en">انگلیسی (English)</option>
                    </select>
                    <p className="text-[11px] text-slate-500 mt-1">
                      تشخیص خودکار برای ویدیوهای دو زبانه بسیار مناسب است.
                    </p>
                  </div>

                  {/* Model Choice */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      مدل ویسپر (Whisper Model)
                    </label>
                    <select
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-violet-500 transition-all font-mono"
                    >
                      <option value="tiny">tiny (سریع‌ترین - ۳۹ مگابایت)</option>
                      <option value="base">base (پیشنهادی برای CPU - ۷۴ مگابایت)</option>
                      <option value="small">small (دقت بالاتر - ۲۴۴ مگابایت)</option>
                      <option value="medium">medium (دقت حرفه‌ای - ۷۶۹ مگابایت)</option>
                      <option value="large-v3">large-v3 (حداکثر دقت - ۱.۵ گیگابایت)</option>
                    </select>
                    <p className="text-[11px] text-slate-500 mt-1">
                      مدل‌ها در ولوم اختصاصی داکر ذخیره می‌شوند.
                    </p>
                  </div>
                </div>

                {/* Submit Button */}
                <div className="mt-6">
                  <button
                    disabled={!selectedFile || isUploading}
                    onClick={handleStartJob}
                    className={`w-full py-3 px-6 rounded-xl font-bold text-sm sm:text-base flex items-center justify-center gap-2 transition-all shadow-lg ${
                      !selectedFile || isUploading
                        ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        : 'bg-gradient-to-r from-violet-600 via-indigo-600 to-amber-500 hover:from-violet-500 hover:to-amber-400 text-white shadow-violet-600/30'
                    }`}
                  >
                    {isUploading ? (
                      <>
                        <RefreshCw className="w-5 h-5 animate-spin" />
                        <span>در حال ارسال فایل به سرور...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-5 h-5" />
                        <span>شروع استخراج صوت و تولید زیرنویس</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Architecture Highlight Box */}
              <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-4 flex items-start gap-3 text-xs text-slate-400">
                <Info className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  این سامانه به صورت ناهمگام (Async Job Processing) کار می‌کند: با بارگذاری ویدیو، درخواست فوراً با شناسه اختصاصی پاسخ داده می‌شود و پردازش FFmpeg و faster-whisper در پس‌زمینه بدون مسدود ماندن اتصال کاربر انجام می‌پذیرد.
                </p>
              </div>
            </div>

            {/* Right Column: Active Job Status & Results */}
            <div className="lg:col-span-5 space-y-6">
              {currentJob ? (
                <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl relative">
                  <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                    <h3 className="font-bold text-base flex items-center gap-2 text-white">
                      <Clock className="w-4 h-4 text-violet-400" />
                      وضعیت پردازش درخواست
                    </h3>
                    {/* Status Badge */}
                    <span
                      className={`text-xs px-2.5 py-1 rounded-full font-medium flex items-center gap-1.5 ${
                        currentJob.status === 'completed'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : currentJob.status === 'failed'
                          ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                          : 'bg-violet-500/20 text-violet-300 border border-violet-500/40 animate-pulse'
                      }`}
                    >
                      {currentJob.status === 'queued' && 'در صف انتظار'}
                      {currentJob.status === 'extracting' && 'استخراج با FFmpeg'}
                      {currentJob.status === 'transcribing' && 'رونویسی هوش مصنوعی'}
                      {currentJob.status === 'completed' && 'تکمیل شده'}
                      {currentJob.status === 'failed' && 'خطا'}
                    </span>
                  </div>

                  {/* Job ID Display */}
                  <div className="mt-4 p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
                    <div>
                      <span className="text-[11px] text-slate-500 block">شناسه امن کار (Job ID):</span>
                      <code className="text-xs font-mono text-amber-400 break-all select-all">
                        {currentJob.job_id}
                      </code>
                    </div>
                    <button
                      onClick={() => copyToClipboard(currentJob.job_id, setCopiedJobId)}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all shrink-0 mr-2"
                      title="کپی شناسه"
                    >
                      {copiedJobId ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* Progress Bar */}
                  <div className="mt-5 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-300 font-medium">{currentJob.message}</span>
                      <span className="font-mono text-violet-400 font-bold">{Math.round(currentJob.progress)}%</span>
                    </div>
                    <div className="w-full bg-slate-950 rounded-full h-2.5 overflow-hidden p-0.5 border border-slate-800">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          currentJob.status === 'completed'
                            ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                            : currentJob.status === 'failed'
                            ? 'bg-red-500'
                            : 'bg-gradient-to-r from-violet-600 to-amber-500'
                        }`}
                        style={{ width: `${Math.max(4, currentJob.progress)}%` }}
                      />
                    </div>
                  </div>

                  {/* Metadata Details */}
                  <div className="grid grid-cols-2 gap-3 mt-5 text-xs text-slate-300">
                    <div className="p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/80">
                      <span className="text-slate-500 block text-[10px]">فایل ویدیویی:</span>
                      <span className="font-medium truncate block" title={currentJob.original_filename}>
                        {currentJob.original_filename}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/80">
                      <span className="text-slate-500 block text-[10px]">طول مدت ویدیو:</span>
                      <span className="font-medium font-mono">
                        {currentJob.duration ? `${currentJob.duration} ثانیه` : 'در حال محاسبه...'}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/80">
                      <span className="text-slate-500 block text-[10px]">زبان تشخیص داده شده:</span>
                      <span className="font-medium">
                        {currentJob.language_detected === 'fa'
                          ? 'فارسی (Persian)'
                          : currentJob.language_detected === 'en'
                          ? 'انگلیسی (English)'
                          : currentJob.language_detected || 'در حال پردازش...'}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/80">
                      <span className="text-slate-500 block text-[10px]">مدل و کوانتیزاسیون:</span>
                      <span className="font-medium font-mono">
                        {currentJob.model || 'base'} (CPU int8)
                      </span>
                    </div>
                  </div>

                  {/* Error Notification */}
                  {currentJob.error && (
                    <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
                      {currentJob.error}
                    </div>
                  )}

                  {/* Completion Actions */}
                  {currentJob.status === 'completed' && (
                    <div className="mt-6 pt-5 border-t border-slate-800 space-y-3">
                      <button
                        onClick={() => handleDownloadSrt(currentJob.job_id, currentJob.original_filename)}
                        className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-600/20"
                      >
                        <Download className="w-4 h-4" />
                        <span>دانلود مستقیم زیرنویس (UTF-8 SRT)</span>
                      </button>

                      <button
                        onClick={() => {
                          fetchSubtitles(currentJob.job_id);
                          setActiveTab('viewer');
                        }}
                        className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm flex items-center justify-center gap-2 transition-all border border-slate-700"
                      >
                        <Play className="w-4 h-4 text-violet-400" />
                        <span>مشاهده همگام‌سازی و ویرایش در پخش‌کننده</span>
                      </button>
                    </div>
                  )}

                  {/* Reset/Clear Job */}
                  <div className="mt-4 flex justify-end">
                    <button
                      onClick={() => {
                        localStorage.removeItem('whisper_active_job');
                        setCurrentJob(null);
                        setSelectedFile(null);
                        if (pollIntervalId) clearInterval(pollIntervalId);
                      }}
                      className="text-xs text-slate-500 hover:text-red-400 flex items-center gap-1 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>پاکسازی درخواست فعلی</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bg-slate-900/40 border border-slate-800/60 rounded-2xl p-8 text-center text-slate-500 flex flex-col items-center justify-center min-h-[300px]">
                  <Layers className="w-12 h-12 text-slate-700 mb-3" />
                  <p className="font-semibold text-slate-400">هیچ درخواست فعالی وجود ندارد</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-xs">
                    پس از بارگذاری ویدیو، مراحل استخراج صدا با FFmpeg و رونویسی گفتار هوش مصنوعی در این بخش نمایش می‌یابد.
                  </p>
                </div>
              )}

              {/* Server Features / Info Card */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 text-xs text-slate-400 space-y-3">
                <h4 className="font-bold text-slate-200 flex items-center gap-2">
                  <Server className="w-4 h-4 text-violet-400" />
                  مشخصات موتور پردازشی سرور
                </h4>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800">
                    <span className="text-slate-500 block">پردازشگر:</span>
                    <span className="text-white font-mono">CPU (بدون نیاز به کارت گرافیک)</span>
                  </div>
                  <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800">
                    <span className="text-slate-500 block">دقت کوانتیزاسیون:</span>
                    <span className="text-white font-mono">int8 (کاهش ۵۰٪ رم)</span>
                  </div>
                  <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800">
                    <span className="text-slate-500 block">فرمت صدای استخراجی:</span>
                    <span className="text-white font-mono">16kHz Mono WAV</span>
                  </div>
                  <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800">
                    <span className="text-slate-500 block">کدگذاری زیرنویس:</span>
                    <span className="text-white font-mono">UTF-8 استاندارد</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Subtitle Viewer & Video Synchronizer */}
        {activeTab === 'viewer' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <FileText className="w-5 h-5 text-violet-400" />
                  پیش‌نمایش تعاملی زیرنویس و همگام‌سازی ویدیو
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  تایم‌استمپ‌های استاندارد SRT تولید شده را به صورت زنده روی ویدیو مشاهده و بررسی کنید.
                </p>
              </div>

              {currentJob && (
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <button
                    onClick={() => handleDownloadSrt(currentJob.job_id, currentJob.original_filename)}
                    className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md transition-all"
                  >
                    <Download className="w-4 h-4" />
                    <span>دانلود SRT</span>
                  </button>
                  <button
                    onClick={() => copyToClipboard(rawSrt, setCopiedSrt)}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs flex items-center gap-1.5 border border-slate-700 transition-all"
                  >
                    {copiedSrt ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    <span>کپی کل متن</span>
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Video Player Column */}
              <div className="lg:col-span-6 space-y-4">
                <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl relative">
                  {videoUrl ? (
                    <div className="relative aspect-video bg-black flex items-center justify-center">
                      <video
                        ref={videoRef}
                        src={videoUrl}
                        controls
                        onTimeUpdate={handleTimeUpdate}
                        onPlay={() => setIsPlaying(true)}
                        onPause={() => setIsPlaying(false)}
                        className="w-full h-full object-contain"
                      />
                      {/* Active Subtitle Overlay */}
                      {activeSegmentId && (
                        <div className="absolute bottom-12 inset-x-4 pointer-events-none flex justify-center">
                          <div className="bg-black/85 text-amber-300 px-4 py-2 rounded-xl text-sm sm:text-base font-medium shadow-2xl backdrop-blur-sm max-w-lg text-center border border-amber-500/20">
                            {subtitles.find((s) => s.id === activeSegmentId)?.text}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="aspect-video bg-slate-950 flex flex-col items-center justify-center p-6 text-center text-slate-500">
                      <FileVideo className="w-12 h-12 text-slate-700 mb-2" />
                      <p className="text-sm font-semibold text-slate-400">ویدیویی برای پخش بارگذاری نشده است</p>
                      <p className="text-xs text-slate-500 mt-1">
                        برای پخش زنده و همگام، فایلی را در تب اول انتخاب نمایید.
                      </p>
                    </div>
                  )}

                  {/* Player info */}
                  <div className="p-3 bg-slate-950/80 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                    <span className="font-mono">
                      زمان فعلی: {Math.floor(currentTime / 60)}:
                      {String(Math.floor(currentTime % 60)).padStart(2, '0')}.
                      {String(Math.floor((currentTime % 1) * 1000)).padStart(3, '0')}
                    </span>
                    <span>
                      {subtitles.length} بند زیرنویس شناسایی شد
                    </span>
                  </div>
                </div>

                {/* Subtitle Raw Text View Accordion */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-300">محتوای متنی فایل SRT (UTF-8):</span>
                    <button
                      onClick={() => copyToClipboard(rawSrt, setCopiedSrt)}
                      className="text-xs text-violet-400 hover:underline flex items-center gap-1"
                    >
                      {copiedSrt ? 'کپی شد!' : 'کپی محتوا'}
                    </button>
                  </div>
                  <pre className="bg-slate-950 p-3 rounded-xl text-xs font-mono text-slate-300 max-h-48 overflow-y-auto border border-slate-800/80 select-all leading-relaxed dir-ltr text-left">
                    {rawSrt || 'هیچ زیرنویسی هنوز لود نشده است.'}
                  </pre>
                </div>
              </div>

              {/* Subtitles Segment List Column */}
              <div className="lg:col-span-6 space-y-4">
                <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col h-[600px]">
                  {/* Search Bar */}
                  <div className="relative mb-4">
                    <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="جستجو در متن زیرنویس‌ها..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700/80 rounded-xl pr-9 pl-3 py-2 text-xs sm:text-sm text-slate-200 focus:outline-none focus:border-violet-500 transition-all"
                    />
                  </div>

                  {/* Segments Scroll Area */}
                  <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                    {subtitles
                      .filter((seg) => !searchQuery || seg.text.toLowerCase().includes(searchQuery.toLowerCase()))
                      .map((seg) => {
                        const isActive = activeSegmentId === seg.id;
                        return (
                          <div
                            key={seg.id}
                            onClick={() => seekToSegment(seg.start)}
                            className={`p-3 rounded-xl border transition-all cursor-pointer ${
                              isActive
                                ? 'bg-violet-900/30 border-violet-500 shadow-md shadow-violet-500/10'
                                : 'bg-slate-950/60 border-slate-800/80 hover:bg-slate-950 hover:border-slate-700'
                            }`}
                          >
                            <div className="flex items-center justify-between text-[11px] mb-1.5">
                              <span className="font-mono text-amber-400 font-bold">#{seg.id}</span>
                              <span className="font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded-md border border-slate-800 dir-ltr">
                                {seg.startTime} ➔ {seg.endTime}
                              </span>
                            </div>
                            <p className="text-sm text-slate-200 leading-relaxed font-medium">
                              {seg.text}
                            </p>
                          </div>
                        );
                      })}

                    {subtitles.length === 0 && (
                      <div className="h-full flex flex-col items-center justify-center text-center text-slate-500">
                        <FileText className="w-10 h-10 text-slate-700 mb-2" />
                        <p className="text-sm font-semibold text-slate-400">زیرنویسی در دسترس نیست</p>
                        <p className="text-xs text-slate-500 mt-1 max-w-xs">
                          ابتدا در تب اول یک ویدیو را ارسال نمایید تا زیرنویس آن به صورت خودکار استخراج شود.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: Docker & Python Source Code Viewer */}
        {activeTab === 'docker' && (
          <div className="space-y-6">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <Terminal className="w-5 h-5 text-violet-400" />
                    راهنمای استقرار سرور با داکر (Docker & Linux Server Deployment)
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    کدهای کامل پروژه برای استقرار اختصاصی روی سرور شخصی لینوکس، بدون وابستگی به هیچ API ابری خارجی.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (currentSelectedFileObj) {
                        copyToClipboard(currentSelectedFileObj.content, setCopiedCode);
                      }
                    }}
                    className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-violet-600/30 transition-all"
                  >
                    {copiedCode ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                    <span>کپی محتوای این فایل</span>
                  </button>
                </div>
              </div>

              {/* Quick Terminal Command Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <span className="text-[11px] font-semibold text-violet-400 block mb-1">
                    ۱. راه‌اندازی با داکر کامپوز:
                  </span>
                  <code className="text-xs font-mono text-slate-300 block bg-slate-900 p-2 rounded-lg dir-ltr text-left select-all">
                    docker compose up --build -d
                  </code>
                </div>
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <span className="text-[11px] font-semibold text-violet-400 block mb-1">
                    ۲. مشاهده لاگ‌های زنده:
                  </span>
                  <code className="text-xs font-mono text-slate-300 block bg-slate-900 p-2 rounded-lg dir-ltr text-left select-all">
                    docker compose logs -f
                  </code>
                </div>
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <span className="text-[11px] font-semibold text-violet-400 block mb-1">
                    ۳. تست با اسکریپت پایتون:
                  </span>
                  <code className="text-xs font-mono text-slate-300 block bg-slate-900 p-2 rounded-lg dir-ltr text-left select-all">
                    python3 backend/test_pipeline.py
                  </code>
                </div>
              </div>
            </div>

            {/* Code Explorer */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* File List Sidebar */}
              <div className="lg:col-span-4 space-y-2 bg-slate-900/80 border border-slate-800 rounded-2xl p-3 max-h-[650px] overflow-y-auto">
                <span className="text-xs font-bold text-slate-400 px-3 py-1 block">فایل‌های سورس‌کد پروژه:</span>
                {projectFiles.map((file) => {
                  const isSelected = file.key === selectedFileKey;
                  return (
                    <button
                      key={file.key}
                      onClick={() => setSelectedFileKey(file.key)}
                      className={`w-full text-right px-3 py-2 rounded-xl text-xs font-mono flex items-center justify-between transition-all ${
                        isSelected
                          ? 'bg-violet-600/20 text-violet-300 border border-violet-500/40 font-bold'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-950/60'
                      }`}
                    >
                      <span className="truncate">{file.title}</span>
                      <span className="text-[10px] text-slate-500 uppercase px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800">
                        {file.lang}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Code Viewer Panel */}
              <div className="lg:col-span-8 bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col h-[650px]">
                <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <Code className="w-4 h-4 text-violet-400" />
                    <span className="font-mono text-slate-200 font-semibold">
                      {currentSelectedFileObj?.path}
                    </span>
                  </div>
                  <span className="text-slate-500 font-mono text-[11px]">
                    {currentSelectedFileObj?.content.split('\n').length || 0} خط
                  </span>
                </div>
                <div className="flex-1 bg-slate-950 p-4 overflow-auto">
                  <pre className="font-mono text-xs text-slate-300 leading-relaxed dir-ltr text-left select-all whitespace-pre">
                    {currentSelectedFileObj?.content || 'در حال بارگذاری فایل...'}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* API Token Security Modal */}
      {tokenModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                <Key className="w-5 h-5 text-violet-400" />
                تنظیم توکن دسترسی (API Access Token)
              </h3>
              <button
                onClick={() => setTokenModalOpen(false)}
                className="text-slate-500 hover:text-slate-300 text-lg leading-none"
              >
                &times;
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              اگر متغیر <code className="text-amber-400">API_ACCESS_TOKEN</code> در فایل <code className="text-amber-400">.env</code> سرور تنظیم شده باشد، تمام درخواست‌ها به این توکن نیاز دارند.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                توکن امنیتی شما:
              </label>
              <input
                type="password"
                placeholder="مقدار API_ACCESS_TOKEN..."
                value={tempTokenInput}
                onChange={(e) => setTempTokenInput(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-violet-500 transition-all font-mono"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setTokenModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all"
              >
                انصراف
              </button>
              <button
                onClick={handleSaveToken}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-violet-600 hover:bg-violet-500 text-white transition-all shadow-md shadow-violet-600/30"
              >
                ذخیره توکن
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950/80 py-4 mt-8 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>سامانه رونویسی گفتار و تولید خودکار زیرنویس با هوش مصنوعی محلی</span>
          <div className="flex items-center gap-4 text-[11px]">
            <span>FastAPI • faster-whisper • FFmpeg</span>
            <span className="text-slate-700">|</span>
            <span>UTF-8 SRT Encoding</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
