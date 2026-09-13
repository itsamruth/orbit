import { useId, type SVGProps } from "react";

type OrbitMarkProps = Omit<SVGProps<SVGSVGElement>, "width" | "height"> & {
  size?: number;
  title?: string;
};

export function OrbitMark({
  size = 24,
  title,
  className,
  ...props
}: OrbitMarkProps) {
  const gradientId = "orbit-metal-" + useId().replaceAll(":", "");

  return (
    <svg
      viewBox="0 0 68 48"
      width={size}
      height={size * (48 / 68)}
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      fill="none"
      {...props}
    >
      <defs>
        <linearGradient id={gradientId} x1="8" y1="8" x2="61" y2="42">
          <stop offset="0" stopColor="#3b3d40" />
          <stop offset="0.24" stopColor="#d9dce0" />
          <stop offset="0.48" stopColor="#74777c" />
          <stop offset="0.7" stopColor="#f3f4f5" />
          <stop offset="1" stopColor="#4b4d51" />
        </linearGradient>
      </defs>
      <ellipse
        cx="34"
        cy="24"
        rx="27"
        ry="11.5"
        transform="rotate(27 34 24)"
        stroke={"url(#" + gradientId + ")"}
        strokeWidth="5.6"
      />
      <ellipse
        cx="34"
        cy="24"
        rx="27"
        ry="11.5"
        transform="rotate(-27 34 24)"
        stroke={"url(#" + gradientId + ")"}
        strokeWidth="5.6"
      />
    </svg>
  );
}
