import { useEffect, useRef } from 'react';

export function FireBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let animId: number;

    function resize() {
      w = canvas!.width = window.innerWidth;
      h = canvas!.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    // Ambient flame columns at the bottom edge only
    const flameColumns: { x: number; phase: number; speed: number; width: number; height: number; hue: number }[] = [];
    for (let i = 0; i < 6; i++) {
      flameColumns.push({
        x: Math.random() * 1.2 - 0.1,
        phase: Math.random() * Math.PI * 2,
        speed: 0.002 + Math.random() * 0.003,
        width: 80 + Math.random() * 180,
        height: 120 + Math.random() * 220,
        hue: Math.random() * 30,
      });
    }

    let t = 0;

    function draw() {
      ctx!.clearRect(0, 0, w, h);
      t++;

      for (const f of flameColumns) {
        const px = f.x * w + Math.sin(t * f.speed + f.phase) * 25;
        const py = h;
        const grad = ctx!.createRadialGradient(px, py, 0, px, py - f.height * 0.5, f.width);
        const fhue = f.hue + Math.sin(t * 0.007 + f.phase) * 8;
        grad.addColorStop(0,   `hsla(${fhue + 10}, 100%, 50%, 0.04)`);
        grad.addColorStop(0.4, `hsla(${fhue + 5},  100%, 35%, 0.018)`);
        grad.addColorStop(1,   'transparent');
        ctx!.beginPath();
        ctx!.ellipse(px, py, f.width, f.height, 0, 0, Math.PI * 2);
        ctx!.fillStyle = grad;
        ctx!.fill();
      }

      animId = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0"
      style={{ opacity: 0.9 }}
    />
  );
}
