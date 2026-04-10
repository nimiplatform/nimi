import { useCallback, useEffect, useRef, useState } from 'react';

const CROP_SIZE = 256; // output pixel size
const VIEW_SIZE = 280; // display size in the modal

interface AvatarCropModalProps {
  imageUrl: string;
  onConfirm: (croppedFile: File) => void;
  onCancel: () => void;
}

/**
 * A simple circular crop modal.
 * User can drag the image and use a slider to zoom.
 * Outputs a square PNG file cropped to the visible circle region.
 */
export function AvatarCropModal({ imageUrl, onConfirm, onCancel }: AvatarCropModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  // Load image
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      // Initial scale: fit the shorter side to VIEW_SIZE
      const minDim = Math.min(img.width, img.height);
      const fitScale = VIEW_SIZE / minDim;
      setScale(fitScale);
      // Center
      setOffset({
        x: (VIEW_SIZE - img.width * fitScale) / 2,
        y: (VIEW_SIZE - img.height * fitScale) / 2,
      });
      setLoaded(true);
    };
    img.src = imageUrl;
  }, [imageUrl]);

  // Draw
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, VIEW_SIZE, VIEW_SIZE);

    // Draw image
    ctx.save();
    ctx.beginPath();
    ctx.arc(VIEW_SIZE / 2, VIEW_SIZE / 2, VIEW_SIZE / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, offset.x, offset.y, img.width * scale, img.height * scale);
    ctx.restore();

    // Circular border
    ctx.beginPath();
    ctx.arc(VIEW_SIZE / 2, VIEW_SIZE / 2, VIEW_SIZE / 2 - 1, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(148, 165, 51, 0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [offset, scale]);

  useEffect(() => { if (loaded) draw(); }, [loaded, draw]);

  // Mouse drag
  const handleMouseDown = (e: React.MouseEvent) => {
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
  };
  const handleMouseUp = () => { dragging.current = false; };

  // Touch drag
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    dragging.current = true;
    lastPos.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY };
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!dragging.current || e.touches.length !== 1) return;
    const dx = e.touches[0]!.clientX - lastPos.current.x;
    const dy = e.touches[0]!.clientY - lastPos.current.y;
    lastPos.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY };
    setOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
  };
  const handleTouchEnd = () => { dragging.current = false; };

  // Zoom slider
  const handleScaleChange = (newScale: number) => {
    const img = imgRef.current;
    if (!img) return;
    // Zoom around center
    const center = VIEW_SIZE / 2;
    const oldCenterX = (center - offset.x) / scale;
    const oldCenterY = (center - offset.y) / scale;
    setScale(newScale);
    setOffset({
      x: center - oldCenterX * newScale,
      y: center - oldCenterY * newScale,
    });
  };

  // Export cropped image
  const handleConfirm = () => {
    const img = imgRef.current;
    if (!img) return;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = CROP_SIZE;
    outCanvas.height = CROP_SIZE;
    const ctx = outCanvas.getContext('2d');
    if (!ctx) return;

    // Scale factor from view to output
    const ratio = CROP_SIZE / VIEW_SIZE;
    ctx.drawImage(img, offset.x * ratio, offset.y * ratio, img.width * scale * ratio, img.height * scale * ratio);

    outCanvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], 'avatar.png', { type: 'image/png' });
      onConfirm(file);
    }, 'image/png');
  };

  const img = imgRef.current;
  const minScale = img ? Math.min(VIEW_SIZE / img.width, VIEW_SIZE / img.height) * 0.5 : 0.5;
  const maxScale = img ? Math.max(VIEW_SIZE / img.width, VIEW_SIZE / img.height) * 3 : 3;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-[18px] p-6 w-[360px]" style={{ background: '#fff', boxShadow: '0 8px 32px rgba(0,0,0,0.15)' }}>
        <h3 className="text-[15px] font-semibold mb-4" style={{ color: '#1a2b4a' }}>调整头像</h3>

        {/* Crop area */}
        <div className="flex justify-center mb-4">
          <canvas
            ref={canvasRef}
            width={VIEW_SIZE}
            height={VIEW_SIZE}
            className="cursor-move rounded-full"
            style={{ width: VIEW_SIZE, height: VIEW_SIZE, background: '#f5f3ef' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          />
        </div>

        {/* Zoom slider */}
        <div className="flex items-center gap-3 mb-5 px-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8a8f9a" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><path d="M8 11h6" />
          </svg>
          <input type="range" min={minScale} max={maxScale} step={0.01} value={scale}
            onChange={(e) => handleScaleChange(parseFloat(e.target.value))}
            className="flex-1 accent-[#94A533]" />
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8a8f9a" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><path d="M8 11h6M11 8v6" />
          </svg>
        </div>

        <p className="text-[11px] text-center mb-4" style={{ color: '#8a8f9a' }}>拖动图片调整位置，滑块缩放大小</p>

        {/* Actions */}
        <div className="flex gap-3">
          <button onClick={handleConfirm}
            className="flex-1 py-2.5 rounded-full text-[13px] font-medium text-white transition-all hover:opacity-90"
            style={{ background: '#86AFDA' }}>
            确认
          </button>
          <button onClick={onCancel}
            className="flex-1 py-2.5 rounded-full text-[13px] font-medium transition-colors"
            style={{ background: '#f5f3ef', color: '#1a2b4a' }}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
