import React, { useEffect, useRef, useState } from 'react';
import localforage from 'localforage';
import { toast, Toaster } from 'sonner';
import { Check, Copy, Download, ImagePlus, Loader2, Minus, Play, Plus, RefreshCw, Sparkles, Trash2, Wand2, X } from 'lucide-react';
import { AppState, GeneratedResult, StyleType, VideoModelType, VoiceType } from './types';
import { compressImage } from './lib/image';
import { generateContent, suggestScripts } from './services/ai';
import { getHistory, saveResult } from './services/storage';

const INITIAL_STATE: AppState = {
  images: [],
  selectedImageIndex: null,
  content: '',
  notes: '',
  sceneCount: 3,
  voice: 'Bắc',
  style: 'professional',
  videoModel: 'Veo 3',
};

const IMAGE_LIBRARY_KEY = 'clipbrand_image_library';

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function Button({ children, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={cx('inline-flex items-center justify-center gap-2 rounded-xl font-bold transition active:scale-[0.98] disabled:opacity-60 disabled:pointer-events-none', className)} {...props}>{children}</button>;
}

function ThumbnailItem({ thumb, refImage, idx }: { thumb: any; refImage: string | undefined; idx: number }) {
  const [downloading, setDownloading] = useState(false);

  const styles = [
    { name: 'square', box: 'left-5 right-5 bottom-[13%] rounded-[18px] bg-gradient-to-br from-[#FFB020] to-[#F97316] shadow-[0_14px_35px_rgba(249,115,22,0.45)] border border-white/25', text: 'text-white' },
    { name: 'dark-pill', box: 'left-6 right-6 bottom-[14%] rounded-full bg-black/82 shadow-[0_14px_35px_rgba(0,0,0,0.45)] border border-white/15 backdrop-blur-sm', text: 'text-white' },
    { name: 'glass', box: 'left-7 right-7 bottom-[15%] rounded-[22px] bg-white/28 shadow-[0_14px_35px_rgba(15,23,42,0.35)] border border-white/55 backdrop-blur-md', text: 'text-white drop-shadow-[0_2px_5px_rgba(0,0,0,0.65)]' },
    { name: 'ribbon', box: 'left-4 right-4 bottom-[14%] rounded-tl-[28px] rounded-br-[28px] rounded-tr-[10px] rounded-bl-[10px] bg-gradient-to-r from-[#0EA5E9] to-[#0369A1] shadow-[0_14px_35px_rgba(14,165,233,0.45)] border border-white/25', text: 'text-white' },
  ];

  const style = styles[idx % styles.length];

  const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

  const drawRoundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) => {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  };

  const wrapText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) => {
    const words = String(text || '').toUpperCase().split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width <= maxWidth) line = test;
      else {
        if (line) lines.push(line);
        line = word;
      }
      if (lines.length === maxLines) break;
    }
    if (line && lines.length < maxLines) lines.push(line);
    if (lines.length === maxLines) {
      while (ctx.measureText(lines[maxLines - 1] + '...').width > maxWidth && lines[maxLines - 1].length > 3) {
        lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1);
      }
    }
    return lines;
  };

  const handleDownload = async () => {
    if (!refImage) {
      toast.error('Chưa có ảnh thumbnail để tải');
      return;
    }
    setDownloading(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1080;
      canvas.height = 1920;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Không tạo được canvas');
      const img = await loadImage(refImage);

      const canvasRatio = canvas.width / canvas.height;
      const imgRatio = img.width / img.height;
      let sx = 0, sy = 0, sw = img.width, sh = img.height;
      if (imgRatio > canvasRatio) {
        sw = img.height * canvasRatio;
        sx = (img.width - sw) / 2;
      } else {
        sh = img.width / canvasRatio;
        sy = (img.height - sh) / 2;
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

      const overlay = ctx.createLinearGradient(0, 0, 0, canvas.height);
      overlay.addColorStop(0, 'rgba(0,0,0,0.02)');
      overlay.addColorStop(0.55, 'rgba(0,0,0,0.08)');
      overlay.addColorStop(1, 'rgba(0,0,0,0.62)');
      ctx.fillStyle = overlay;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const variant = idx % 4;
      let boxX = 100, boxW = 880, radius = 54;
      if (variant === 1) { boxX = 130; boxW = 820; radius = 999; }
      if (variant === 2) { boxX = 150; boxW = 780; radius = 62; }
      if (variant === 3) { boxX = 90; boxW = 900; radius = 40; }

      let fontSize = 78;
      let lines: string[] = [];
      do {
        ctx.font = `900 ${fontSize}px Arial, sans-serif`;
        lines = wrapText(ctx, String(thumb.text || ''), boxW - 130, 3);
        fontSize -= 4;
      } while (fontSize > 48 && lines.some((line) => ctx.measureText(line).width > boxW - 130));
      fontSize += 4;
      ctx.font = `900 ${fontSize}px Arial, sans-serif`;
      const lineHeight = fontSize * 1.12;
      const boxH = Math.max(230, lines.length * lineHeight + 100);
      const boxY = canvas.height - boxH - 230;

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 36;
      ctx.shadowOffsetY = 18;
      drawRoundRect(ctx, boxX, boxY, boxW, boxH, radius);
      if (variant === 0) {
        const grad = ctx.createLinearGradient(boxX, boxY, boxX + boxW, boxY + boxH);
        grad.addColorStop(0, '#FFB020'); grad.addColorStop(1, '#F97316'); ctx.fillStyle = grad;
      } else if (variant === 1) ctx.fillStyle = 'rgba(0,0,0,0.84)';
      else if (variant === 2) ctx.fillStyle = 'rgba(255,255,255,0.30)';
      else {
        const grad = ctx.createLinearGradient(boxX, boxY, boxX + boxW, boxY);
        grad.addColorStop(0, '#0EA5E9'); grad.addColorStop(1, '#0369A1'); ctx.fillStyle = grad;
      }
      ctx.fill();
      ctx.restore();
      ctx.lineWidth = 4;
      ctx.strokeStyle = variant === 2 ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.22)';
      drawRoundRect(ctx, boxX, boxY, boxW, boxH, radius);
      ctx.stroke();

      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = variant === 2 ? 10 : 0;
      ctx.shadowOffsetY = variant === 2 ? 4 : 0;
      const startY = boxY + boxH / 2 - ((lines.length - 1) * lineHeight) / 2;
      lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, startY + i * lineHeight));

      const link = document.createElement('a');
      link.download = `clipbrand-thumb-${idx + 1}.webp`;
      link.href = canvas.toDataURL('image/webp', 0.96);
      link.click();
      toast.success('Đã tải ảnh kèm chữ');
    } catch (error) {
      console.error(error);
      toast.error('Lỗi khi tải ảnh thumbnail');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-[9/16] rounded-xl overflow-hidden bg-zinc-200 shadow-md group">
        {refImage ? <img src={refImage} className="absolute inset-0 w-full h-full object-cover brightness-[0.85] contrast-110 saturate-110 group-hover:scale-105 transition-transform duration-500" alt="Thumbnail base" /> : <div className="absolute inset-0 bg-gradient-to-br from-zinc-300 to-zinc-500" />}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/10 to-black/70 pointer-events-none" />
        <div className="absolute bottom-[13%] left-0 right-0 flex items-center justify-center px-4 w-full z-10 pointer-events-none">
          <div className={`w-auto max-w-[88%] min-w-[70%] px-5 py-4 ${style.box} transition-all duration-300 group-hover:scale-[1.03]`}>
            <p className={`text-center uppercase font-black leading-[1.12] tracking-tight break-words ${style.text}`} style={{ fontSize: 'clamp(0.9rem, 5.2cqw, 1.15rem)' }}>{thumb.text}</p>
          </div>
        </div>
      </div>
      <Button onClick={handleDownload} disabled={downloading} className="w-full border border-brand-blue text-brand-blue hover:bg-brand-blue hover:text-white rounded-[10px] min-h-[44px] bg-white">
        {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        {downloading ? 'Đang xử lý...' : 'Tải ảnh'}
      </Button>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const [history, setHistory] = useState<GeneratedResult[]>([]);
  const [currentResult, setCurrentResult] = useState<GeneratedResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const saved = await localforage.getItem<string[]>(IMAGE_LIBRARY_KEY);
      if (Array.isArray(saved) && saved.length > 0) setState((s) => ({ ...s, images: saved, selectedImageIndex: 0 }));
      const hist = await getHistory();
      setHistory(hist);
      if (hist[0]) setCurrentResult(hist[0]);
    })();
  }, []);

  const saveImages = async (images: string[]) => localforage.setItem(IMAGE_LIBRARY_KEY, images.slice(0, 6));

  const copyToClipboard = async (text: string, title: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(`Đã copy ${title}`);
  };

  const handleContentChange = async (value: string) => {
    setState((s) => ({ ...s, content: value }));
    if (value.trim().split(/\s+/).length >= 4) setSuggestions(await suggestScripts(value));
    else setSuggestions([]);
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const img = await compressImage(file);
      setState((s) => {
        const images = [img, ...s.images].slice(0, 6);
        saveImages(images);
        return { ...s, images, selectedImageIndex: 0 };
      });
      toast.success('Đã thêm ảnh vào thư viện');
    } catch {
      toast.error('Lỗi khi tải ảnh lên');
    }
  };

  const handleGenerate = async () => {
    if (!state.content.trim()) return toast.error('Vui lòng nhập nội dung kịch bản');
    setLoading(true);
    try {
      const result = await generateContent(state);
      await saveResult(result);
      const hist = await getHistory();
      setHistory(hist);
      setCurrentResult(result);
      toast.success('Tạo kịch bản thành công');
    } catch (error: any) {
      toast.error(error?.message || 'Lỗi tạo kịch bản');
    } finally {
      setLoading(false);
    }
  };

  const refImage = currentResult?.inputs.images[currentResult.inputs.selectedImageIndex ?? 0];

  return (
    <div className="min-h-screen bg-brand-bg-sub text-brand-text-body pb-20">
      <Toaster position="top-center" richColors />
      <header className="sticky top-0 z-50 bg-gradient-to-br from-brand-blue to-brand-blue-dark shadow-md">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2"><div className="w-10 h-10 rounded-xl bg-brand-yellow-light flex items-center justify-center"><Sparkles className="w-5 h-5 text-brand-text-title" /></div><h1 className="font-bold text-lg text-white">ClipBrand AI</h1></div>
          <Button onClick={() => { setState({ ...INITIAL_STATE, images: state.images, selectedImageIndex: state.selectedImageIndex }); setCurrentResult(null); }} className="bg-white/15 hover:bg-white/30 text-white text-xs px-3 py-2 border border-white/30"><RefreshCw className="w-4 h-4" />Tạo mới</Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
        <section className="lg:col-span-5 space-y-6">
          <div className="card">
            <div className="flex justify-between mb-3"><h2 className="font-bold text-brand-text-title">1. Ảnh tham chiếu</h2><span className="text-xs text-brand-text-muted">{state.images.length}/6 ảnh</span></div>
            <div className="flex gap-3 overflow-x-auto pb-2">
              <label className="flex flex-col items-center justify-center w-24 h-32 rounded-xl border-2 border-dashed border-brand-border hover:border-brand-blue cursor-pointer shrink-0 bg-brand-bg-sub">
                <ImagePlus className="w-6 h-6 text-brand-blue mb-2" /><span className="text-xs">Thêm ảnh</span>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
              </label>
              {state.images.map((img, i) => <div key={i} className={cx('relative w-24 h-32 rounded-xl overflow-hidden shrink-0 cursor-pointer', state.selectedImageIndex === i && 'ring-2 ring-brand-blue ring-offset-2')} onClick={() => setState((s) => ({ ...s, selectedImageIndex: i }))}>
                <img src={img} className="w-full h-full object-cover" />
                {state.selectedImageIndex === i && <div className="absolute inset-0 bg-brand-blue/20 grid place-items-center"><span className="bg-brand-yellow rounded-full p-1"><Check className="w-4 h-4" /></span></div>}
                <button className="absolute top-1 right-1 bg-black/60 hover:bg-red-500 text-white rounded-full p-1" onClick={(e) => { e.stopPropagation(); setState((s) => { const images = s.images.filter((_, idx) => idx !== i); saveImages(images); return { ...s, images, selectedImageIndex: images.length ? 0 : null }; }); }}><X className="w-3 h-3" /></button>
              </div>)}
            </div>
          </div>

          <div className="card">
            <div className="flex justify-between mb-3"><h2 className="font-bold text-brand-text-title">2. Nội dung / Tiêu đề</h2><span className="text-xs text-brand-text-muted">{state.content.trim().split(/\s+/).filter(Boolean).length}/2000 từ</span></div>
            <textarea className="input min-h-[160px]" placeholder="Nhập ý tưởng, tiêu đề hoặc nội dung dài mà bạn muốn truyền tải..." value={state.content} onChange={(e) => handleContentChange(e.target.value)} />
            {suggestions.length > 0 && <div className="mt-3 space-y-2">{suggestions.map((s, i) => <button key={i} className="w-full text-left px-3 py-3 rounded-lg bg-brand-bg-sub border border-brand-border text-sm" onClick={() => { setState((old) => ({ ...old, content: s })); setSuggestions([]); }}>{s}</button>)}</div>}
          </div>

          <div className="card">
            <h2 className="font-bold text-brand-text-title mb-3">3. Điều khiển AI</h2>
            <textarea className="input min-h-[70px]" placeholder="Ví dụ: Năng lượng cao, chuyên gia, gần gũi..." value={state.notes} onChange={(e) => setState((s) => ({ ...s, notes: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="card"><h3 className="font-bold mb-2">Cảnh quay</h3><div className="flex items-center bg-brand-bg-sub rounded-xl border border-brand-border"><button className="p-3" onClick={() => setState((s) => ({ ...s, sceneCount: Math.max(1, s.sceneCount - 1) }))}><Minus /></button><span className="flex-1 text-center font-bold">{state.sceneCount}</span><button className="p-3" onClick={() => setState((s) => ({ ...s, sceneCount: Math.min(7, s.sceneCount + 1) }))}><Plus /></button></div></div>
            <div className="card"><h3 className="font-bold mb-2">Giọng đọc</h3><select className="input h-12" value={state.voice} onChange={(e) => setState((s) => ({ ...s, voice: e.target.value as VoiceType }))}><option>Bắc</option><option>Trung</option><option>Nam</option></select></div>
          </div>

          <div className="card space-y-3">
            <h3 className="font-bold">Phong cách</h3>
            <div className="grid grid-cols-2 gap-2">{(['energy','professional','gentle','natural'] as StyleType[]).map((v) => <button key={v} className={cx('p-3 rounded-xl border font-bold text-left', state.style === v ? 'bg-brand-blue text-white border-brand-blue' : 'bg-white border-brand-border')} onClick={() => setState((s) => ({ ...s, style: v }))}>{v === 'energy' ? '🚀 Năng lượng' : v === 'professional' ? '💼 Chuyên nghiệp' : v === 'gentle' ? '☕ Nhẹ nhàng' : '🏡 Tự nhiên'}</button>)}</div>
          </div>

          <div className="card space-y-3"><h3 className="font-bold">Model Video</h3><div className="grid grid-cols-2 gap-2">{(['Veo 3','Gork'] as VideoModelType[]).map((v) => <button key={v} className={cx('p-3 rounded-xl border font-bold', state.videoModel === v ? 'bg-brand-blue text-white border-brand-blue' : 'bg-white border-brand-border')} onClick={() => setState((s) => ({ ...s, videoModel: v }))}>{v}<span className="block text-xs font-medium">Video {v === 'Veo 3' ? 8 : 10} giây</span></button>)}</div></div>

          <Button onClick={handleGenerate} disabled={loading} className="w-full h-14 bg-brand-yellow hover:bg-brand-yellow-light text-brand-text-title shadow-lg text-base"><Wand2 className="w-5 h-5" />{loading ? 'Đang tạo kịch bản...' : 'Tạo Kịch Bản Video'}</Button>
        </section>

        <section className="lg:col-span-7 space-y-6">
          {!currentResult ? <div className="h-[400px] rounded-2xl border border-dashed border-brand-border bg-white grid place-items-center text-center p-6"><div><Play className="w-12 h-12 mx-auto text-brand-placeholder mb-4" /><p className="text-brand-text-muted font-medium">Nhập thông tin và bấm Tạo kịch bản video để xem kết quả.</p></div></div> : <>
            <div className="card"><div className="flex items-start justify-between gap-4"><div><h3 className="font-bold text-brand-text-title text-lg">{currentResult.hook}</h3><div className="mt-2 flex flex-wrap gap-2">{currentResult.hashtags.map((tag) => <span key={tag} className="text-xs font-bold bg-brand-yellow-light text-[#92400E] px-2 py-1 rounded-full">{tag}</span>)}</div></div><Button className="border border-brand-blue text-brand-blue p-3" onClick={() => copyToClipboard(`${currentResult.hook}\n\n${currentResult.hashtags.join(' ')}`, 'Hook & Hashtags')}><Copy className="w-4 h-4" /></Button></div></div>

            <div className="space-y-4"><h3 className="font-bold text-lg flex items-center gap-2 text-brand-text-title"><Play className="w-5 h-5 text-brand-blue" />Kịch bản chi tiết ({currentResult.scenes.length} cảnh)</h3>{currentResult.scenes.map((scene, idx) => <div key={idx} className="rounded-2xl border border-brand-border bg-white shadow-sm overflow-hidden">
              <div className="flex flex-col sm:flex-row">
                <div className="bg-brand-bg-sub text-brand-text-body p-4 sm:w-[34%] flex flex-col relative shrink-0 border-r border-brand-border/50 max-h-[240px] sm:max-h-[250px] overflow-hidden">
                  <div className="flex items-center justify-between mb-3 shrink-0"><span className="bg-white text-brand-blue border border-brand-blue font-mono text-[11px] font-bold rounded-full px-2 py-1">SCENE {idx + 1}</span><span className="bg-brand-yellow-light text-[#92400E] text-[11px] font-bold rounded-full px-2 py-1">{currentResult.inputs.videoModel}</span></div>
                  <p className="text-[12px] leading-relaxed font-mono opacity-90 max-h-[145px] overflow-y-auto pr-2 mb-11">{scene.videoPrompt}</p>
                  <Button className="absolute bottom-2 right-2 hover:bg-brand-yellow-light text-brand-blue min-h-[40px] px-3" onClick={() => copyToClipboard(scene.videoPrompt, `Prompt Cảnh ${idx + 1}`)}><Copy className="w-4 h-4" />Prompt</Button>
                </div>
                <div className="bg-white p-5 flex-1 relative flex flex-col justify-center min-h-[140px]"><p className="text-brand-text-body text-[14px] leading-relaxed pl-4 border-l-[3px] border-brand-yellow font-medium">"{scene.voiceScript}"</p><Button className="absolute right-3 top-3 h-10 w-10 text-brand-blue bg-brand-bg-sub hover:bg-brand-yellow-light rounded-xl" onClick={() => copyToClipboard(scene.voiceScript, `Thoại Cảnh ${idx + 1}`)}><Copy className="w-4 h-4" /></Button></div>
              </div>
              <div className="bg-brand-bg-main border-t border-brand-border p-3 sm:px-5 flex justify-end"><Button className="w-full sm:w-auto bg-brand-yellow hover:bg-brand-yellow-light text-brand-text-title rounded-xl min-h-[44px] px-4" onClick={() => copyToClipboard(`Prompt Video:\n${scene.videoPrompt}\n\nLời thoại:\n${scene.voiceScript}`, 'Prompt + Lời thoại')}><Copy className="w-4 h-4" />Copy Prompt + Lời thoại</Button></div>
            </div>)}</div>

            <div className="space-y-4 pt-4 border-t border-brand-border"><h3 className="font-bold text-lg flex items-center gap-2 text-brand-text-title"><ImagePlus className="w-5 h-5 text-brand-yellow" />Gợi ý Thumbnail</h3><div className="grid grid-cols-1 sm:grid-cols-3 gap-4">{currentResult.thumbnailVariations.map((thumb, idx) => <ThumbnailItem key={idx} thumb={thumb} refImage={refImage} idx={idx} />)}</div></div>
          </>}

          {history.length > 0 && <div className="card"><h3 className="font-bold mb-3">Lịch sử gần đây</h3><div className="space-y-2">{history.slice(0, 3).map((item) => <button key={item.id} className="w-full text-left p-3 rounded-xl border border-brand-border hover:border-brand-blue" onClick={() => setCurrentResult(item)}><span className="font-bold line-clamp-1">{item.hook}</span><span className="block text-xs text-brand-text-muted">{new Date(item.timestamp).toLocaleString('vi-VN')} · {item.scenes.length} cảnh</span></button>)}</div></div>}
        </section>
      </main>
    </div>
  );
}
