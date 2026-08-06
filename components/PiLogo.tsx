"use client";

/**
 * Pi 官网（pi.codes hero）使用的 π 标志，取自官网 hero-logo 的 SVG path
 * （viewBox 470×470，fill-rule evenodd 版本）。
 *
 * - 默认 `fill="currentColor"`，跟随文字/主题色。
 * - 传入 `gradient` 时使用品牌渐变（粉 → 紫 → 蓝）填充，用于欢迎页 hero。
 */
export function PiLogo({
  size = 40,
  color,
  gradient = false,
  gradientId = "pi-logo-brand-gradient",
  className,
  style,
}: {
  size?: number;
  color?: string;
  /** 用品牌渐变填充（用于欢迎页大 logo）；默认跟随 currentColor。 */
  gradient?: boolean;
  /** 渐变 id，页面多处渲染大 logo 时传不同值避免冲突。 */
  gradientId?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const fill = gradient ? `url(#${gradientId})` : (color ?? "currentColor");

  return (
    <svg
      viewBox="0 0 470 470"
      width={size}
      height={size}
      className={className}
      style={style}
      fill={fill}
      aria-hidden="true"
      focusable="false"
    >
      {gradient && (
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f472b6" />
            <stop offset="50%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor="#60a5fa" />
          </linearGradient>
        </defs>
      )}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M0 0H352.07V234.71H234.71V352.07H117.36V469.43H0V0ZM117.36 117.36V234.71H234.71V117.36H117.36Z"
      />
      <path d="M352.07 234.71H469.43V469.43H352.07V234.71Z" />
    </svg>
  );
}
