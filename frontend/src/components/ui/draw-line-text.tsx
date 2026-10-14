"use client";
import { useRef, useState, type ComponentProps } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";

type DrawTextProps = {
  text: string;
  fontFamily?: string;
  fontWeight?: number;
  afterFill?: boolean;
  color?: string;
  fontSize?: number;
  letterSpacing?: number;
  oneByOne?: boolean;
  strokeWidth?: number;
  wordSpacing?: number;
} & ComponentProps<"svg">;
gsap.registerPlugin(useGSAP);

// Adapted from the supplied DrawLineText. SVG units keep it responsive; font-ready
// measurements prevent clipping, and a local GSAP context owns every animation.
export function DrawLineText({
  text,
  fontFamily = "Fraunces",
  fontWeight = 400,
  oneByOne = true,
  afterFill = true,
  color = "currentColor",
  fontSize = 180,
  wordSpacing = 36,
  strokeWidth = 1,
  letterSpacing = -6,
  style,
  ...props
}: DrawTextProps) {
  const root = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState({
    width: text.length * fontSize * 0.6,
    height: fontSize * 1.35,
  });
  useGSAP(
    (_context, contextSafe) => {
      let disposed = false;
      const media = gsap.matchMedia();
      const render = contextSafe!(() => {
        if (disposed || !root.current) return;
        const letters = Array.from(
          root.current.querySelectorAll<SVGTextElement>("text"),
        );
        let x = strokeWidth * 3;
        for (const letter of letters) {
          letter.setAttribute("x", `${x}`);
          const width = letter.getComputedTextLength();
          x += letter.textContent === " " ? wordSpacing : width + letterSpacing;
        }
        setBox({
          width: x - letterSpacing + strokeWidth * 3,
          height: fontSize * 1.35,
        });
        media.add(
          {
            reduce: "(prefers-reduced-motion: reduce)",
            animate: "(prefers-reduced-motion: no-preference)",
          },
          (context) => {
            if (context.conditions?.reduce) {
              gsap.set(letters, {
                fillOpacity: afterFill ? 1 : 0,
                strokeDashoffset: 0,
                strokeDasharray: "none",
              });
              return;
            }
            letters.forEach((letter) => {
              const length = Math.max(1, letter.getComputedTextLength() * 8);
              gsap.set(letter, {
                strokeDasharray: length,
                strokeDashoffset: length,
                fillOpacity: 0,
              });
            });
            const timeline = gsap.timeline();
            timeline.to(letters, {
              strokeDashoffset: 0,
              duration: 2.25,
              ease: "none",
              stagger: oneByOne ? 0.1 : 0,
            });
            if (afterFill)
              timeline.to(
                letters,
                {
                  fillOpacity: 1,
                  duration: 0.6,
                  ease: "power2.inOut",
                  stagger: { amount: 0.12, from: "center" },
                },
                "-=.2",
              );
          },
        );
      });
      document.fonts
        .load(`${fontWeight} ${fontSize}px "${fontFamily}"`)
        .then(render, render);
      return () => {
        disposed = true;
        media.revert();
      };
    },
    {
      scope: root,
      dependencies: [
        text,
        fontFamily,
        fontWeight,
        afterFill,
        color,
        fontSize,
        wordSpacing,
        strokeWidth,
        letterSpacing,
        oneByOne,
      ],
      revertOnUpdate: true,
    },
  );
  return (
    <svg
      {...props}
      ref={root}
      viewBox={`0 0 ${box.width} ${box.height}`}
      style={{ width: "100%", height: "auto", overflow: "visible", ...style }}
      aria-hidden="true"
    >
      {text.split("").map((character, index) => (
        <text
          key={index}
          x={index * fontSize * 0.6}
          y={fontSize}
          style={{
            stroke: color,
            fill: color,
            fillOpacity: 1,
            fontFamily,
            fontWeight,
            fontSize,
            strokeWidth,
          }}
        >
          {character}
        </text>
      ))}
    </svg>
  );
}
