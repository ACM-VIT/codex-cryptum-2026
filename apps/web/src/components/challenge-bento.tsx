import { BentoGrid, BentoCard } from "@/components/ui/bento-grid";
import { useApp } from "@/lib/context";
import type { Challenge } from "@/lib/contracts";

export function CardArt({ id }: { id: number }) {
  return (
    <svg viewBox="0 0 600 400" fill="none" preserveAspectRatio="xMidYMid slice">
      {id % 3 === 1
        ? Array.from({ length: 9 }, (_, i) => (
            <ellipse
              key={i}
              cx="390"
              cy="100"
              rx={60 + i * 22}
              ry={60 + i * 12}
              transform={`rotate(${-35 + i * 5} 390 100)`}
            />
          ))
        : id % 3 === 2
          ? Array.from({ length: 9 }, (_, i) => (
              <path
                key={i}
                d={`M-50 ${40 + i * 24}C100 ${-80 + i * 23} 350 ${280 + i * 8} 650 ${70 + i * 24}`}
              />
            ))
          : Array.from({ length: 7 }, (_, i) => (
              <rect
                key={i}
                x={220 + i * 19}
                y={-50 + i * 19}
                width={300 - i * 38}
                height={300 - i * 38}
                rx="16"
                transform="rotate(35 370 100)"
              />
            ))}
    </svg>
  );
}
export function ChallengeBento({ items }: { items: Challenge[] }) {
  const { session } = useApp();
  return (
    <BentoGrid>
      {items.map((c) => (
        <BentoCard
          key={c.id}
          name={c.title}
          number={String(c.id).padStart(2, "0")}
          description={`${c.points} pts · ${c.interaction === "sandbox" ? "Sandbox · Verify exploit" : "Chat · Submit flag"}`}
          href={`/arena/${c.id}`}
          cta={session ? (c.interaction === "sandbox" ? "Inspect sandbox" : "Start prompting") : "Sign in to open"}
          captured={session?.solved.includes(c.id)}
          background={<CardArt id={c.id} />}
          className={`bento-level-${c.id}`}
        />
      ))}
    </BentoGrid>
  );
}
