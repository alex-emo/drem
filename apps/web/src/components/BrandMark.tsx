import type { SVGProps } from "react";

/** Dream 品牌标识：梦螺旋 + 星芒。抽象图形，不依赖字母。 */
export function BrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="200 200 640 640" aria-hidden="true" focusable="false" {...props}>
      <defs>
        <linearGradient id="dream-brand-mark" x1="240" y1="220" x2="780" y2="800" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#c4f8ff" />
          <stop offset="0.42" stopColor="#69dcff" />
          <stop offset="1" stopColor="#4f6bff" />
        </linearGradient>
        <linearGradient id="dream-brand-star" x1="470" y1="450" x2="610" y2="590" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff7d6" />
          <stop offset="1" stopColor="#ffae36" />
        </linearGradient>
      </defs>
      <path d="M575 245 C735 275 805 420 775 555 C740 710 570 790 430 735 C290 680 245 520 320 405 C395 290 545 270 640 350 C715 414 715 535 640 590" fill="none" stroke="url(#dream-brand-mark)" strokeWidth="92" strokeLinecap="round" />
      <path fill="url(#dream-brand-star)" d="M520 442 C530 488 558 508 604 518 C558 528 530 548 520 594 C510 548 482 528 436 518 C482 508 510 488 520 442 Z" />
    </svg>
  );
}
