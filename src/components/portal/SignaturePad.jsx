import { useRef, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { PenLine, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function SignaturePad({ name, onConfirm }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const hasDrawnRef = useRef(false);
  const idleTimerRef = useRef(null);
  const lastPointRef = useRef(null);
  const [hasDrawn, setHasDrawn] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = '#193e3a';
    drawBaseline(ctx, rect.width, rect.height);
  }, []);

  function drawBaseline(ctx, width, height) {
    ctx.save();
    ctx.strokeStyle = 'rgba(38,105,88,.22)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(16, height - 20);
    ctx.lineTo(width - 16, height - 20);
    ctx.stroke();
    ctx.restore();
  }

  function getPoint(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handlePointerDown(e) {
    clearTimeout(idleTimerRef.current);
    drawingRef.current = true;
    lastPointRef.current = getPoint(e);
    canvasRef.current.setPointerCapture?.(e.pointerId);
  }

  function handlePointerMove(e) {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const ctx2d = ctx;
    const pt = getPoint(e);
    ctx2d.beginPath();
    ctx2d.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    ctx2d.lineTo(pt.x, pt.y);
    ctx2d.stroke();
    lastPointRef.current = pt;
    if (!hasDrawnRef.current) { hasDrawnRef.current = true; setHasDrawn(true); }
  }

  function handlePointerUp() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (hasDrawnRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => { confirm(); }, 1000);
    }
  }

  function clearCanvas() {
    clearTimeout(idleTimerRef.current);
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, rect.width, rect.height);
    drawBaseline(ctx, rect.width, rect.height);
    hasDrawnRef.current = false;
    setHasDrawn(false);
  }

  function confirm() {
    if (!hasDrawnRef.current || !name?.trim()) return;
    clearTimeout(idleTimerRef.current);
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    const timestamp = new Date();
    const timestampLabel = format(timestamp, "d MMM yyyy 'at' HH:mm");

    ctx.save();
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#193e3a';
    ctx.textAlign = 'left';
    ctx.fillText(name.trim(), 16, rect.height - 6);
    ctx.font = '400 10px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#78918a';
    ctx.textAlign = 'right';
    ctx.fillText(`Signed ${timestampLabel}`, rect.width - 16, rect.height - 6);
    ctx.restore();

    const dataUrl = canvas.toDataURL('image/png');
    onConfirm(dataUrl, timestampLabel);
  }

  const canConfirm = hasDrawn && !!name?.trim();

  return (
    <div>
      <div
        className="border-2 border-dashed rounded-xl overflow-hidden"
        style={{ borderColor: 'rgba(38,105,88,.25)', background: '#fff' }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '140px', display: 'block', touchAction: 'none', cursor: 'crosshair' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
      </div>
      <div className="flex items-center gap-2 mt-2">
        <button
          type="button"
          onClick={clearCanvas}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors cursor-pointer hover:bg-slate-50"
          style={{ borderColor: 'rgba(38,105,88,.25)', color: '#193e3a' }}
        >
          <RotateCcw className="w-3.5 h-3.5" /> Clear
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!canConfirm}
          className={cn(
            'flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white transition-colors cursor-pointer',
            !canConfirm && 'opacity-50 cursor-not-allowed'
          )}
          style={{ backgroundColor: '#27775c' }}
        >
          <PenLine className="w-3.5 h-3.5" /> Confirm Signature
        </button>
      </div>
    </div>
  );
}