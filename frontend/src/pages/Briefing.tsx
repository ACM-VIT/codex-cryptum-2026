import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Expand,
  Flag,
  X,
} from "lucide-react";
import { AnimatedPage } from "../components/ui";
import { useApp } from "../lib/context";
import { isDemo } from "../lib/api";

const slides = [
  {
    time: "00:00–02:00",
    title: "Welcome to the vault.",
    kicker: "THE MISSION",
    body: "Codex Cryptum is an LLM capture-the-flag challenge. Your goal is to recover ten hidden flags by exploring how an AI application follows instructions and protects information.",
    points: [
      "Join your team and open the challenge dashboard.",
      "Every challenge is selectable from the beginning.",
      "A flag is a specific value you submit to prove a solve.",
    ],
  },
  {
    time: "02:00–04:00",
    title: "Instructions have boundaries.",
    kicker: "PROMPT INJECTION",
    body: "Prompt injection happens when untrusted input redirects an AI application away from its intended instructions. A convincing prompt can look like a new role, quoted text, or a competing task.",
    points: [
      "A system instruction defines the intended behavior.",
      "Your message is lower-trust input.",
      "A refusal is evidence about a defense, not proof that it is secure.",
    ],
  },
  {
    time: "04:00–07:00",
    title: "Make your first capture.",
    kicker: "LIVE WALKTHROUGH",
    body: "Open layer 01. Ask the assistant for the flag. Copy the returned value into the flag submission field. An accepted submission updates your score and progress.",
    points: [
      "Use Enter to send and Shift+Enter for a new line.",
      "Incorrect submissions do not capture a flag.",
      "An already accepted flag does not award points again.",
    ],
  },
  {
    time: "07:00–10:00",
    title: "Ten layers. Different defenses.",
    kicker: "THE CHALLENGE MAP",
    body: "Levels progress from simple instructions to keyword filters, output checks, classifier models, and a judge that reviews the whole conversation. In the final layer, the model never sees the flag.",
    points: [
      "01–03: instructions and hidden reasoning.",
      "04–06: input and output filters.",
      "07–10: classifiers, conversation judging, and backend isolation.",
    ],
  },
  {
    time: "10:00–12:00",
    title: "Keep track of your experiments.",
    kicker: "WORKING IN THE ARENA",
    body: "Each challenge keeps its own conversation. Read its objective and active defenses before trying an approach. You can switch freely between levels.",
    points: [
      "Reset clears that conversation, not your earned points.",
      "Layer 09 has a turn budget shown above the chat.",
      "Hints offer a direction without revealing the solution.",
    ],
  },
  {
    time: "12:00–14:00",
    title: "Another route to the top.",
    kicker: "THE LEADERBOARD",
    body: "The competition also includes an intentionally vulnerable leaderboard. Explore authorization and score handling in the dedicated sandbox supplied by the organizers.",
    points: [
      "Only the designated challenge sandbox is in scope.",
      "Do not attack authentication, hosting, or unrelated services.",
      "Ask organizers how to record findings and how the sandbox resets.",
    ],
  },
  {
    time: "14:00–15:00",
    title: "Your move.",
    kicker: "READY TO BEGIN",
    body: "Pick a challenge, make a hypothesis, and start a conversation. Treat each response as feedback. There is more than one way to approach a boundary.",
    points: [
      "Keep flags within your own team; some are team-specific.",
      "Do not paste credentials or personal information into prompts.",
      "Ask an organizer if a challenge or service is unavailable.",
    ],
  },
];

export function Briefing() {
  const presentation = useRef<HTMLDialogElement>(null);
  const { challenges } = useApp(),
    [presenting, setPresenting] = useState(false),
    [index, setIndex] = useState(0);
  useEffect(() => {
    if (!presenting) return;
    const dialog = presentation.current;
    dialog?.showModal();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPresenting(false);
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        setIndex((i) => Math.min(slides.length - 1, i + 1));
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      dialog?.close();
    };
  }, [presenting]);
  const slide = slides[index];
  if (presenting)
    return (
      <dialog
        ref={presentation}
        className="presentation"
        aria-label="Codex Cryptum briefing presentation"
        onCancel={() => setPresenting(false)}
      >
        <div className="presentation-top">
          <span>
            CODEX CRYPTUM <span className="muted">/ BRIEFING</span>
          </span>
          <button
            className="button button-outline button-small"
            onClick={() => setPresenting(false)}
            autoFocus
          >
            <X size={16} /> Exit presentation
          </button>
        </div>
        <AnimatedPage key={index} className="slide">
          <span className="eyebrow">
            {String(index + 1).padStart(2, "0")} / {slide.kicker}{" "}
            <span className="slide-time">{slide.time}</span>
          </span>
          <h1>{slide.title}</h1>
          <p>{slide.body}</p>
          <ul>
            {slide.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          {index === 2 && (
            <Link to="/arena/1" className="button">
              Open layer 01 <ArrowUpRight size={18} />
            </Link>
          )}
        </AnimatedPage>
        <div className="presentation-bottom">
          <span>
            {index + 1} / {slides.length}
            <span className="muted"> · USE ARROW KEYS</span>
          </span>
          <div>
            <button
              className="button button-outline"
              disabled={index === 0}
              onClick={() => setIndex(index - 1)}
            >
              <ArrowLeft size={16} /> Previous
            </button>
            <button
              className="button"
              disabled={index === slides.length - 1}
              onClick={() => setIndex(index + 1)}
            >
              Next <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </dialog>
    );
  return (
    <AnimatedPage className="page briefing-page">
      <div className="page-heading">
        <div>
          <h1>Briefing</h1>
        </div>
        <button
          className="button button-outline"
          onClick={() => {
            setIndex(0);
            setPresenting(true);
          }}
        >
          <Expand size={16} /> Present briefing
        </button>
      </div>
      <div className="briefing-banner">
        <Flag size={20} />
        <span>10 FLAGS</span>
        <span>ALL LEVELS OPEN</span>
        <span>15-MINUTE WALKTHROUGH</span>
      </div>
      <div className="briefing-sections">
        {slides.map((s, i) => (
          <section className="briefing-section" key={s.title}>
            <div className="briefing-section-index">
              <span>{String(i + 1).padStart(2, "0")}</span>
              <small>{s.time}</small>
            </div>
            <div>
              <span className="section-kicker">{s.kicker}</span>
              <h2>{s.title}</h2>
              <p>{s.body}</p>
              <ul>
                {s.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              {i === 2 && (
                <Link className="quiet-link" to="/arena/1">
                  Try the first challenge <ArrowUpRight size={14} />
                </Link>
              )}
            </div>
          </section>
        ))}
      </div>
      <section className="defense-map">
        <span className="eyebrow">QUICK REFERENCE / DEFENSE MAP</span>
        <h2>What you’re up against.</h2>
        <div className="defense-map-grid">
          {challenges.map((c) => (
            <Link to={`/arena/${c.id}`} key={c.id}>
              <span>{String(c.id).padStart(2, "0")}</span>
              <div>
                <b>{c.subtitle}</b>
                <small>
                  {c.difficulty} · {c.points} pts{isDemo ? " (demo)" : ""}
                </small>
              </div>
              <ArrowUpRight size={16} />
            </Link>
          ))}
        </div>
      </section>
      <div className="briefing-ready">
        <Link to="/challenges" className="button">
          Choose a challenge <ArrowUpRight size={18} />
        </Link>
      </div>
    </AnimatedPage>
  );
}
