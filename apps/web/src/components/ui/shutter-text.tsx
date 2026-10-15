"use client";

import {
  AnimatePresence,
  motion,
  useInView,
  useReducedMotion,
} from "framer-motion";
import {
  type HTMLAttributes,
  useCallback,
  useRef,
  useState,
} from "react";

interface ShutterTextProps extends HTMLAttributes<HTMLElement> {
  text?: string;
  onRevealComplete?: () => void;
  trigger?: "auto" | "scroll" | "click" | "hover";
}

export default function ShutterText({
  text = "IMMERSE",
  onRevealComplete,
  trigger = "auto",
  className = "",
  ...props
}: ShutterTextProps) {
  const [count, setCount] = useState(0);
  const reducedMotion = useReducedMotion();
  const [interacting, setInteracting] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const isInView = useInView(ref, { once: false, amount: 0.5 });
  const characters = text.split("");

  const animating = trigger === "auto" || (trigger === "scroll" ? isInView : interacting);
  const interactive = trigger === "click" || trigger === "hover";
  const Root = interactive ? "button" : "div";

  const handleClick = useCallback(() => {
    if (trigger === "click" || trigger === "hover") {
      setInteracting(true);
      setCount((c) => c + 1);
    }
  }, [trigger]);

  const handleMouseEnter = useCallback(() => {
    if (trigger === "hover") {
      setInteracting(true);
      setCount((c) => c + 1);
    }
  }, [trigger]);

  const handleMouseLeave = useCallback(() => {
    if (trigger === "hover") setInteracting(false);
  }, [trigger]);

  return (
    <Root
      ref={(element: HTMLDivElement | HTMLButtonElement | null) => { ref.current = element; }}
      type={interactive ? "button" : undefined}
      onClick={interactive ? handleClick : undefined}
      onMouseEnter={trigger === "hover" ? handleMouseEnter : undefined}
      onMouseLeave={trigger === "hover" ? handleMouseLeave : undefined}
      className={`relative inline-flex flex-wrap items-center justify-center ${className}`}
      {...props}
    >
      <AnimatePresence mode="wait">
        {animating && !reducedMotion ? (
          <motion.span
            key={count}
            className="flex flex-wrap items-center justify-center"
          >
            {characters.map((char, i) => (
              <span
                key={i}
                className="relative inline-block overflow-hidden px-[0.1vw]"
              >
                {/* Main Character */}
                <motion.span
                  initial={{ opacity: 0, filter: "blur(10px)" }}
                  animate={{ opacity: 1, filter: "blur(0px)" }}
                  transition={{ delay: i * 0.04 + 0.3, duration: 0.8 }}
                  onAnimationComplete={
                    i === characters.length - 1 ? onRevealComplete : undefined
                  }
                  className="inline-block font-black text-[var(--ivory)] leading-none tracking-tighter "
                >
                  {char === " " ? "\u00A0" : char}
                </motion.span>

                {/* Top Slice Layer */}
                <motion.span
                  initial={{ x: "-100%", opacity: 0 }}
                  animate={{ x: "100%", opacity: [0, 1, 0] }}
                  transition={{
                    duration: 0.7,
                    delay: i * 0.04,
                    ease: "easeInOut",
                  }}
                  className="pointer-events-none absolute inset-0 z-10 inline-block font-black text-[var(--accent)] leading-none "
                  style={{ clipPath: "polygon(0 0, 100% 0, 100% 35%, 0 35%)" }}
                >
                  {char}
                </motion.span>

                {/* Middle Slice Layer */}
                <motion.span
                  initial={{ x: "100%", opacity: 0 }}
                  animate={{ x: "-100%", opacity: [0, 1, 0] }}
                  transition={{
                    duration: 0.7,
                    delay: i * 0.04 + 0.1,
                    ease: "easeInOut",
                  }}
                  className="pointer-events-none absolute inset-0 z-10 inline-block font-black text-[var(--ivory)] leading-none "
                  style={{
                    clipPath: "polygon(0 35%, 100% 35%, 100% 65%, 0 65%)",
                  }}
                >
                  {char}
                </motion.span>

                {/* Bottom Slice Layer */}
                <motion.span
                  initial={{ x: "-100%", opacity: 0 }}
                  animate={{ x: "100%", opacity: [0, 1, 0] }}
                  transition={{
                    duration: 0.7,
                    delay: i * 0.04 + 0.2,
                    ease: "easeInOut",
                  }}
                  className="pointer-events-none absolute inset-0 z-10 inline-block font-black text-[var(--accent)] leading-none "
                  style={{
                    clipPath: "polygon(0 65%, 100% 65%, 100% 100%, 0 100%)",
                  }}
                >
                  {char}
                </motion.span>
              </span>
            ))}
          </motion.span>
        ) : (
          <span className="flex flex-wrap items-center justify-center">
            {characters.map((char, i) => (
              <span
                key={i}
                className="relative inline-block overflow-hidden px-[0.1vw]"
              >
                <span className="inline-block font-black text-[var(--ivory)] leading-none tracking-tighter ">
                  {char === " " ? "\u00A0" : char}
                </span>
              </span>
            ))}
          </span>
        )}
      </AnimatePresence>
    </Root>
  );
}
