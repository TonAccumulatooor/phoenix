import { useEffect, useRef } from 'react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  type: 'ember' | 'spark' | 'flame';
  hue: number;
  brightness: number;
}

export function EmberParticles({ count = 80 }: { count?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -9999, y: -9999 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const onMouse = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('mousemove', onMouse);

    let w = 0;
    let h = 0;

    function resize() {
      w = canvas!.width = window.innerWidth;
      h = canvas!.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    function makeEmber(): Particle {
      return {
        x: Math.random() * w,
        y: h + Math.random() * 60,
        vx: (Math.random() - 0.5) * 0.4,
        vy: -(Math.random() * 1.1 + 0.3),
        size: Math.random() * 3 + 1.5,
        life: 0,
        maxLife: 250 + Math.random() * 350,
        type: 'ember',
        hue: 15 + Math.random() * 35,
        brightness: 70 + Math.random() * 30,
      };
    }

    function makeSpark(): Particle {
      return {
        x: Math.random() * w,
        y: h * (0.3 + Math.random() * 0.7),
        vx: (Math.random() - 0.5) * 2,
        vy: -(Math.random() * 3 + 1.5),
        size: Math.random() * 1.5 + 0.5,
        life: 0,
        maxLife: 25 + Math.random() * 40,
        type: 'spark',
        hue: 35 + Math.random() * 25,
        brightness: 96 + Math.random() * 4,
      };
    }

    function makeFlame(): Particle {
      return {
        x: Math.random() * w,
        y: h + Math.random() * 80,
        vx: (Math.random() - 0.5) * 0.2,
        vy: -(Math.random() * 0.6 + 0.2),
        size: Math.random() * 6 + 4,
        life: 0,
        maxLife: 350 + Math.random() * 450,
        type: 'flame',
        hue: 5 + Math.random() * 25,
        brightness: 55 + Math.random() * 30,
      };
    }

    function spawn(): Particle {
      const r = Math.random();
      return r < 0.55 ? makeEmber() : r < 0.75 ? makeFlame() : makeSpark();
    }

    const particles: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const p = spawn();
      p.life = Math.random() * p.maxLife * 0.8;
      p.y = Math.random() * h;
      particles.push(p);
    }

    let animId: number;
    let frame = 0;

    function draw() {
      ctx!.clearRect(0, 0, w, h);
      frame++;

      if (frame % 4 === 0 && particles.length < count * 1.4) {
        particles.push(makeSpark());
      }

      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life++;

        if (p.life >= p.maxLife) {
          Object.assign(p, spawn());
          continue;
        }

        const dx = p.x - mx;
        const dy = p.y - my;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 200 && dist > 0) {
          const force = ((200 - dist) / 200) * 0.5;
          p.vx += (dx / dist) * force;
          p.vy += (dy / dist) * force;
          p.brightness = Math.min(100, p.brightness + force * 12);
        }

        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.991;
        p.vy *= 0.996;

        if (p.type !== 'spark') {
          p.x += Math.sin(p.life * 0.02 + p.y * 0.009) * 0.4;
        }

        const t = p.life / p.maxLife;
        let alpha = t < 0.08 ? t / 0.08 : t > 0.6 ? (1 - t) / 0.4 : 1;
        alpha *= p.type === 'spark' ? 1 : p.type === 'flame' ? 0.4 : 0.75;

        if (alpha <= 0) continue;

        if (p.type === 'flame') {
          ctx!.save();
          ctx!.translate(p.x, p.y);
          ctx!.scale(1, 2 + Math.sin(p.life * 0.04) * 0.5);
          const g = ctx!.createRadialGradient(0, 0, 0, 0, 0, p.size);
          g.addColorStop(0, `hsla(${p.hue + 20}, 100%, 70%, ${alpha})`);
          g.addColorStop(0.3, `hsla(${p.hue + 10}, 100%, 55%, ${alpha * 0.6})`);
          g.addColorStop(0.6, `hsla(${p.hue}, 100%, 40%, ${alpha * 0.3})`);
          g.addColorStop(1, 'transparent');
          ctx!.beginPath();
          ctx!.arc(0, 0, p.size, 0, Math.PI * 2);
          ctx!.fillStyle = g;
          ctx!.fill();
          ctx!.restore();
        } else {
          const r = p.size * (p.type === 'spark' ? 2 : 2.5);
          const g = ctx!.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          const core =
            p.brightness > 88
              ? `rgba(255,255,230,${alpha})`
              : `hsla(${p.hue},100%,${p.brightness}%,${alpha})`;
          g.addColorStop(0, core);
          g.addColorStop(0.25, `hsla(${p.hue},100%,${p.brightness * 0.7}%,${alpha * 0.8})`);
          g.addColorStop(0.6, `hsla(${p.hue},100%,${p.brightness * 0.4}%,${alpha * 0.3})`);
          g.addColorStop(1, 'transparent');
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx!.fillStyle = g;
          ctx!.fill();
        }
      }

      while (particles.length > count * 1.6) particles.pop();

      animId = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouse);
    };
  }, [count]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0"
      style={{ opacity: 0.85 }}
    />
  );
}
