import { useEffect, useRef, useState } from "react";

/**
 * 隧道/代理会把 SSE 攒成一批再送达，直接渲染会出现"停半秒、跳一大段"。
 * 这里把每次到达的文本按时间摊开显示，尽量接近持续吐字的观感。
 */
export function SmoothText({ text, className }: { text: string; className?: string }) {
  const targetRef = useRef(text);
  targetRef.current = text;
  const shownRef = useRef(0);
  const [, force] = useState(0);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(now - last, 120);
      last = now;
      const backlog = targetRef.current.length - shownRef.current;
      if (backlog > 0) {
        const rate = backlog > 160 ? 320 : backlog > 60 ? 180 : 100;
        const step = Math.max(1, Math.round((rate * dt) / 1000));
        shownRef.current = Math.min(targetRef.current.length, shownRef.current + Math.min(step, backlog));
        force((value) => value + 1);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <div className={className}>{text.slice(0, shownRef.current)}</div>;
}
