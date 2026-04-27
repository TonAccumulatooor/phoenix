import { useEffect, useRef } from 'react';

export function CursorGlow() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onMove = (e: MouseEvent) => {
      el.style.background = `radial-gradient(700px circle at ${e.clientX}px ${e.clientY}px, rgba(255,69,0,0.09), rgba(255,143,0,0.04) 30%, rgba(220,38,38,0.02) 50%, transparent 70%)`;
    };

    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  return <div ref={ref} className="fixed inset-0 pointer-events-none z-[1]" />;
}
