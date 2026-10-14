"use client";
import { useRef, type ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import Lenis from "@studio-freight/lenis";
import { KeyholeMark } from "../keyhole-mark";
import ShutterText from "./shutter-text";

gsap.registerPlugin(ScrollTrigger, useGSAP);

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
          container.querySelector<HTMLElement>(".cryptum-wordmark")!;
        const reveals = container.querySelectorAll(
          ".hero-keyhole, .cryptum-intro",
        );
        const header = document.querySelector(".icon-header-home");
        const timeline = gsap.timeline({
          scrollTrigger: {
            trigger: container,
            start: "top top",
            end: "bottom bottom",
            scrub: 0.6,
            invalidateOnRefresh: true,
          },
        });
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
        if (header)
          timeline.fromTo(
            header,
            { autoAlpha: 0 },
            { autoAlpha: 1, duration: 0.25 },
            0.72,
          );
        let disposed = false;
        document.fonts.ready.then(() => {
          if (!disposed) ScrollTrigger.refresh();
        });
        const lenis = new Lenis({ duration: 1.1, smoothWheel: true });
        const tick = (time: number) => lenis.raf(time * 1000);
        lenis.on("scroll", ScrollTrigger.update);
        gsap.ticker.add(tick);
        const completed = new Set<string>();
        let cancelled = window.scrollY > 10;
        let scrolling = false;
        const cancelAutomaticScroll = () => {
          cancelled = true;
          if (scrolling) {
            lenis.scrollTo(window.scrollY, { immediate: true });
            scrolling = false;
          }
        };
        const events = [
          "wheel",
          "touchstart",
          "pointerdown",
          "keydown",
        ] as const;
        events.forEach((event) =>
          window.addEventListener(event, cancelAutomaticScroll, {
            passive: true,
          }),
        );
        titleComplete.current = (word) => {
          completed.add(word);
          if (completed.size !== 2 || cancelled || scrolling) return;
          // Use actual character-animation completion, then the measured scroll destination.
          void document.fonts.ready.then(() => {
            if (disposed || cancelled || window.scrollY > 10) return;
            ScrollTrigger.refresh();
            scrolling = true;
            lenis.scrollTo(timeline.scrollTrigger!.end, {
              duration: 1.6,
              easing: (progress: number) => 1 - Math.pow(1 - progress, 3),
              onComplete: () => {
                scrolling = false;
                cancelled = true;
              },
            });
          });
        };

        // Remove this component's ticker and triggers only; other routes own theirs.
        return () => {
          disposed = true;
          titleComplete.current = () => {};
          events.forEach((event) =>
            window.removeEventListener(event, cancelAutomaticScroll),
          );
          gsap.ticker.remove(tick);
          lenis.off("scroll", ScrollTrigger.update);
          lenis.destroy();
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
