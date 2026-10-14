import type { ReactNode } from "react";
import { ArrowRightIcon } from "@radix-ui/react-icons";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";

export function BentoGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid w-full grid-cols-1 gap-4 md:grid-cols-3",
        "bento-grid",
        className,
      )}
    >
      {children}
    </div>
  );
}
export function BentoCard({
  name,
  className,
  background,
  description,
  href,
  cta,
  number,
  captured = false,
}: {
  name: string;
  className?: string;
  background: ReactNode;
  description: string;
  href: string;
  cta: string;
  number?: string;
  captured?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-label={`${cta}: ${name}, ${description}${captured ? ", captured" : ""}`}
      className={cn(
        "group relative flex flex-col justify-between overflow-hidden rounded-xl",
        "bento-card",
        captured && "bento-captured",
        className,
      )}
    >
      <div className="bento-background" aria-hidden="true">
        {background}
      </div>
      <div className="bento-top">
        <span>{number}</span>
        <span>{captured ? "Captured" : ""}</span>
      </div>
      <div className="bento-content">
        <h3>{name}</h3>
        <p>{description}</p>
      </div>
      <div className="bento-action" aria-hidden="true">
        <span className={buttonVariants({ variant: "ghost", size: "sm" })}>
          {cta}
          <ArrowRightIcon className="ml-2 h-4 w-4" />
        </span>
      </div>
    </Link>
  );
}
