import { useEffect, useRef, type ReactNode } from "react";
import { ArrowUpRight, Check, Copy, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

export function AnimatedPage({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(
          root.current,
          { opacity: 0, y: 10 },
          { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" },
        );
      });
      return () => media.revert();
    },
    { scope: root },
  );
  return (
    <div ref={root} className={className}>
      {children}
    </div>
  );
}

export function Vault({
  solved = 0,
  small = false,
}: {
  solved?: number;
  small?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(
          ".vault-layer",
          { opacity: 0.2, scale: 0.8, rotation: -8 },
          {
            opacity: 1,
            scale: 1,
            rotation: 0,
            duration: 1.2,
            stagger: 0.055,
            transformOrigin: "50% 50%",
            ease: "power3.out",
          },
        );
      });
      return () => media.revert();
    },
    { scope: root, dependencies: [solved], revertOnUpdate: true },
  );
  return (
    <div
      ref={root}
      className={`vault ${small ? "vault-small" : ""}`}
    >
      <svg viewBox="0 0 600 600" fill="none">
        <title>{`Ten-layer vault, ${solved} layers captured`}</title>
        <defs>
          <pattern
            id="vault-grid"
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <path d="M24 0H0V24" stroke="currentColor" strokeOpacity=".08" />
          </pattern>
        </defs>
        <rect width="600" height="600" fill="url(#vault-grid)" />
        <path
          d="M300 0V600M0 300H600"
          stroke="currentColor"
          strokeOpacity=".18"
          strokeDasharray="3 7"
        />
        {Array.from({ length: 10 }, (_, i) => {
          const d = 244 - i * 19;
          const cut = d * 0.29;
          return (
            <g className="vault-layer" key={i}>
              <path
                d={`M${300 - d + cut} ${300 - d}H${300 + d - cut}L${300 + d} ${300 - d + cut}V${300 + d - cut}L${300 + d - cut} ${300 + d}H${300 - d + cut}L${300 - d} ${300 + d - cut}V${300 - d + cut}Z`}
                transform={`rotate(${i * 5.3} 300 300)`}
                stroke={i < solved ? "#9cdaca" : "currentColor"}
                strokeWidth={i === 0 ? 1.5 : 1}
                strokeOpacity={i < solved ? 0.25 : 0.3 + i * 0.065}
                strokeDasharray={i < solved ? "3 8" : undefined}
              />
              <circle
                cx={300 + d * 0.72}
                cy={300 - d}
                r={i < solved ? 3 : 2}
                fill={i < solved ? "#9cdaca" : "currentColor"}
                transform={`rotate(${i * 5.3} 300 300)`}
              />
            </g>
          );
        })}
        <path
          d="M279 286v-10a21 21 0 0142 0v10m-48 0h54v42h-54z"
          stroke="currentColor"
          strokeWidth="3"
        />
        <circle cx="300" cy="304" r="3" fill="currentColor" />
        <path d="M300 306v8" stroke="currentColor" strokeWidth="2" />
        <path
          d="M30 53V30h23M547 30h23v23M570 547v23h-23M53 570H30v-23"
          stroke="currentColor"
        />
      </svg>
      {!small && (
        <>
          <span className="vault-coordinate top">SYS / VAULT.010</span>
          <span className="vault-coordinate bottom">
            {String(solved).padStart(2, "0")} / 10 LAYERS CAPTURED
          </span>
        </>
      )}
    </div>
  );
}

export function MagneticLink({
  to,
  children,
  className = "",
}: {
  to: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const { contextSafe } = useGSAP({ scope: ref });
  const move = (event: React.PointerEvent<HTMLAnchorElement>) => contextSafe(() => {
    if (
      event.pointerType !== "mouse" ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const box = event.currentTarget.getBoundingClientRect();
    gsap.to(ref.current, {
      x: (event.clientX - box.left - box.width / 2) * 0.08,
      y: (event.clientY - box.top - box.height / 2) * 0.08,
      duration: 0.3,
      overwrite: "auto",
    });
  })();
  const leave = () => contextSafe(() => {
    gsap.to(ref.current, { x: 0, y: 0, duration: 0.3, overwrite: "auto" });
  })();
  return (
    <Link
      ref={ref}
      href={to}
      className={`button ${className}`}
      onPointerMove={move}
      onPointerLeave={leave}
    >
      {children}
      <ArrowUpRight size={18} />
    </Link>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [status, setStatus] = useState("Copy");
  useEffect(() => {
    if (status === "Copy") return;
    const timer = setTimeout(() => setStatus("Copy"), 2400);
    return () => clearTimeout(timer);
  }, [status]);
  return (
    <button
      className="copy-button"
      aria-label={status === "Copy" ? "Copy message" : status}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setStatus("Copied");
        } catch {
          setStatus("Select text to copy");
        }
      }}
    >
      {status === "Copied" ? <Check size={13} /> : <Copy size={13} />}
      <output>{status}</output>
    </button>
  );
}

export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const dismissBackdrop = (event: MouseEvent) => {
      if (event.target === dialog) onClose();
    };
    dialog.addEventListener("click", dismissBackdrop);
    return () => dialog.removeEventListener("click", dismissBackdrop);
  }, [onClose]);
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="dialog-title"
      onCancel={onClose}
    >
      <div className="dialog-inner">
        <div className="dialog-heading">
          <h2 id="dialog-title">{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

export function ErrorNotice({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="notice error" role="alert">
      <span>{message}</span>
      {retry && (
        <button className="text-button" onClick={retry}>
          Try again ↗
        </button>
      )}
    </div>
  );
}
