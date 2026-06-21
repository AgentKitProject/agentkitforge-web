// AgentKitAuto brand logo.
//
// A faithful, crisp, scalable rendition of the Auto mark:
//   • a rounded-square (squircle) frame with a THICK deep royal-indigo border
//     (#3538CD) on white;
//   • a vivid royal-blue (#3B5BF6) near-complete circular ORBIT ARROW with an
//     open gap at the top-left, rounded caps, and an arrowhead at the
//     top-left end pointing up / counterclockwise;
//   • a GREEN filled dot (#22C55E) at the top near the gap;
//   • a dark-navy (#1E2150) HEXAGON nut with a smaller hex hole cut out at the
//     center.
//
// Multi-color brand palette is intentional (not currentColor) — this is a
// fixed brand mark. Renders at any size; pass `size` (px) and optional
// `title` for accessibility.
import type { SVGProps } from "react";

const INDIGO = "#3538CD"; // frame border
const NAVY = "#1E2150"; // hex nut
const BLUE = "#3B5BF6"; // orbit arrow
const GREEN = "#22C55E"; // dot

export type AutoLogoProps = SVGProps<SVGSVGElement> & {
  size?: number;
  title?: string;
};

export function AutoLogo({ size = 42, title = "AgentKitAuto", ...props }: AutoLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      {...props}
    >
      <title>{title}</title>
      {/* Squircle frame: white fill, thick indigo border */}
      <rect x="4" y="4" width="56" height="56" rx="16" fill="#ffffff" />
      <rect x="4" y="4" width="56" height="56" rx="16" fill="none" stroke={INDIGO} strokeWidth="5" />

      {/* Orbit arrow: near-complete circle (r = 17, centered at 32,32) with an
          open gap at the top-left. The arc runs the long way around (right →
          bottom → left), from the top end (250°) to the left end (200°). The
          open top end carries the arrowhead pointing up / counterclockwise. */}
      <path
        d="M 26.2 16.0
           A 17 17 0 1 1 16.0 26.2"
        fill="none"
        stroke={BLUE}
        strokeWidth="5"
        strokeLinecap="round"
      />
      {/* Arrowhead at the top open end (26.2,16.0), pointing up/counterclockwise */}
      <path
        d="M 21.2 14.6 L 26.2 16.0 L 24.8 21.0"
        fill="none"
        stroke={BLUE}
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Green dot centered in the top-left gap (mid-angle 225°, on the orbit) */}
      <circle cx="20.0" cy="20.0" r="3.4" fill={GREEN} />

      {/* Hexagon nut with a hex hole cut out (evenodd) at the center */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        fill={NAVY}
        d="M 32 20.5 L 43.1 26.9 L 43.1 39.8 L 32 46.2 L 20.9 39.8 L 20.9 26.9 Z
           M 32 28.0 L 38.0 31.4 L 38.0 38.3 L 32 41.7 L 26.0 38.3 L 26.0 31.4 Z"
      />
    </svg>
  );
}

export default AutoLogo;
