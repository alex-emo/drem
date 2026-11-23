import type { SVGProps } from "react";

/** Dream 品牌 X 标识；路径来自 Android adaptive icon 源图。装饰性图形，旁边始终有 Dream 文本。 */
export function BrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 160 160" aria-hidden="true" focusable="false" {...props}>
      <defs>
        <linearGradient id="dream-brand-x" x1="160" y1="0" x2="0" y2="160" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#52b0ff" />
          <stop offset="1" stopColor="#7bd0ff" />
        </linearGradient>
      </defs>
      <path
        fill="url(#dream-brand-x)"
        d="M76 17L99 40L140 0L160 20L120 60L160 100L140 120L40 20L60 0Z"
      />
      <path
        fill="url(#dream-brand-x)"
        d="M84 143L61 120L20 160L0 140L40 100L0 60L20 40L120 140L100 160Z"
      />
    </svg>
  );
}
