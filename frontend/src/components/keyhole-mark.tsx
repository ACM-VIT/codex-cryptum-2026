import type { SVGProps } from "react";

/** Vector interpretation of the event posters' keyhole and code brackets. */
export function KeyholeMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 240 320" fill="none" aria-hidden="true" {...props}>
      <path
        d="M120 12a96 96 0 0 1 55 175l34 119H31l34-119A96 96 0 0 1 120 12Z"
        fill="currentColor"
      />
      <path
        d="m98 77-30 30 30 30m44-60 30 30-30 30"
        stroke="var(--bg, #080d18)"
        strokeWidth="17"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
