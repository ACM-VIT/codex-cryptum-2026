"use client";
import { useRef, type ReactNode } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { KeyholeMark } from "../keyhole-mark";
import ShutterText from "./shutter-text";

gsap.registerPlugin(useGSAP);

export function ParallaxComponent({ children }: { children?: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const titleComplete = useRef<(word: string) => void>(() => {});
  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        const container = root.current;
        if (!container) return;
        const title =
          container.querySelector<HTMLElement>(".cryptum-wordmark");
        if (!title) return;
        const reveals = container.querySelectorAll(
          ".hero-keyhole, .cryptum-intro",
        );
        const timeline = gsap.timeline({ paused: true });
        timeline.fromTo(
          title,
          {
            x: () =>
              (window.innerWidth - title.offsetWidth) / 2 - title.offsetLeft,
            y: () =>
              (window.innerHeight - title.offsetHeight) / 2 - title.offsetTop,
            scale: () => (window.innerWidth > 640 ? 1.22 : 1),
          },
          { x: 0, y: 0, scale: 1, duration: 0.65, ease: "power2.inOut" },
          0,
        );
        timeline.fromTo(
          reveals,
          { autoAlpha: 0, y: 24 },
          { autoAlpha: 1, y: 0, duration: 0.35, stagger: 0.06 },
          0.55,
        );
        let disposed = false;
        const completed = new Set<string>();
        titleComplete.current = (word) => {
          completed.add(word);
          if (completed.size !== 2) return;
          void document.fonts.ready.then(() => {
            if (disposed) return;
            timeline.invalidate().timeScale(0.75).play(0);
          });
        };

        // Remove this component's ticker and triggers only; other routes own theirs.
        return () => {
          disposed = true;
          titleComplete.current = () => {};
          timeline.kill();
        };
      });
      return () => media.revert();
    },
    { scope: root },
  );
  return (
    <div className="cryptum-parallax" ref={root}>
      <section className="cryptum-hero" aria-label="Codex Cryptum">
        <div className="cryptum-layers" data-parallax-layers>
          <div
            className="cryptum-atmosphere"
            data-parallax-layer="1"
            aria-hidden="true"
          />
          <svg
            className="hero-perimeter-lines"
            viewBox="0 0 1600 1000"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <g className="corner-curves-top-right">
              {Array.from({ length: 8 }, (_, index) => (
                <path
                  key={index}
                  d={`M${1020 + index * 28} -40 C${1080 + index * 28} 120 ${1380 + index * 18} ${130 + index * 18} 1640 ${240 + index * 18}`}
                />
              ))}
            </g>
            <g className="corner-curves-bottom-left">
              {Array.from({ length: 8 }, (_, index) => (
                <path
                  key={index}
                  d={`M-40 ${790 + index * 20} C180 ${825 + index * 20} ${400 + index * 22} ${865 + index * 20} ${560 + index * 22} 1040`}
                />
              ))}
            </g>
          </svg>
          <div className="hero-keyhole" data-parallax-layer="2">
            <KeyholeMark />
          </div>
          <h1 className="cryptum-wordmark" data-parallax-layer="3">
            <span className="sr-only">Codex Cryptum</span>
            <div aria-hidden="true" className="shutter-wordmark">
              <ShutterText
                text="CODEX"
                className="shutter-title-line"
                onRevealComplete={() => titleComplete.current("CODEX")}
              />
              <ShutterText
                text="CRYPTUM"
                className="shutter-title-line"
                onRevealComplete={() => titleComplete.current("CRYPTUM")}
              />
            </div>
          </h1>
          <div className="cryptum-intro" data-parallax-layer="4">
            {children}
          </div>
        </div>
      </section>
    </div>
  );
}
