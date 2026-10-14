import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { PromptInputBox } from "@/components/ui/ai-prompt-box";
import {
  AnimatedPage,
  CopyButton,
  Dialog,
  ErrorNotice,
} from "../components/ui";
import { useApp } from "../lib/context";
import { api, isDemo } from "../lib/api";

export function Arena() {
  const { id } = useParams();
  return <ArenaContent key={id} id={Number(id)} />;
}

function ArenaContent({ id }: { id: number }) {
  const { session, setSession, challenges, busy, transact, toast } = useApp();
  const challenge = challenges.find((c) => c.id === id);
  const [prompt, setPrompt] = useState(""),
    [flag, setFlag] = useState("");
  const [error, setError] = useState(""),
    [feedback, setFeedback] = useState(""),
    [accepted, setAccepted] = useState(false);
  const [resetting, setResetting] = useState(false),
    [sending, setSending] = useState(false),
    [submitting, setSubmitting] = useState(false);
  const [flagOpen, setFlagOpen] = useState(false);
  const messages = session?.conversations[id] ?? [];
  const usedTurns = messages.filter((m) => m.role === "user").length;
  const exhausted =
    challenge?.turnLimit != null && usedTurns >= challenge.turnLimit;
  const end = useRef<HTMLDivElement>(null),
    composer = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const conversation = end.current?.parentElement;
    if (conversation) conversation.scrollTop = conversation.scrollHeight;
  }, [messages.length, sending]);
  if (!challenge || !session)
    return (
      <div className="page empty-page">
        <h1>Challenge not found.</h1>
        <Link className="button" to="/challenges">
          Explore the ten layers <ArrowUpRight size={16} />
        </Link>
      </div>
    );
  const send = async () => {
    if (!prompt.trim() || busy || exhausted) return;
    setError("");
    setSending(true);
    const content = prompt.trim();
    try {
      const result = await transact(() => api.chat(id, content));
      setSession(result);
      if (mounted.current) {
        setPrompt("");
        composer.current?.focus();
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
      else toast((e as Error).message);
    } finally {
      if (mounted.current) setSending(false);
    }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!flag.trim() || busy) return;
    setFeedback("");
    setSubmitting(true);
    try {
      const result = await transact(() => api.submit(id, flag.trim()));
      setSession(result.session);
      const text =
        result.status === "accepted"
          ? `Flag captured. +${challenge.points} points.`
          : result.status === "duplicate"
            ? "You already captured this flag. No additional points awarded."
            : "That flag isn’t correct. Check the value and try again.";
      if (mounted.current) {
        setFeedback(text);
        setAccepted(result.status !== "incorrect");
        if (result.status === "accepted") setFlag("");
      }
      if (result.status === "accepted")
        toast(
          `Layer ${String(id).padStart(2, "0")} captured · +${challenge.points} points`,
        );
    } catch (e) {
      if (mounted.current) {
        setFeedback((e as Error).message);
        setAccepted(false);
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  };
  return (
    <AnimatedPage className="challenge-page">
      <div className="challenge-panel-toolbar">
        <Link className="challenge-back" to="/challenges">
          <ArrowLeft size={16} /> Back to challenges
        </Link>
        <Link
          className="challenge-close icon-button"
          to="/challenges"
          aria-label="Close challenge and return to challenges"
        >
          <X size={22} />
        </Link>
      </div>
      <section className="challenge-overview" aria-labelledby="challenge-title">
        <h1 id="challenge-title">{challenge.title}</h1>
        <p className="challenge-description">{challenge.description}</p>
        <div className="challenge-overview-actions">
          <span className="challenge-points">{challenge.points} points</span>
          <button
            type="button"
            className="button button-outline"
            aria-expanded={flagOpen}
            aria-controls="flag-entry"
            onClick={() => setFlagOpen((open) => !open)}
          >
            {flagOpen ? "Cancel" : "Enter flag"}
          </button>
        </div>
        {flagOpen && (
          <form
            className="challenge-flag-form"
            id="flag-entry"
            onSubmit={submit}
          >
            <label htmlFor="flag">Flag</label>
            <Input
              size="lg"
              id="flag"
              autoFocus
              value={flag}
              onChange={(event) => setFlag(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              maxLength={512}
              placeholder={isDemo ? "DEMO{...}" : "Paste your flag"}
            />
            <button className="button" disabled={!flag.trim() || busy}>
              {submitting ? "Verifying…" : "Submit flag"}
            </button>
          </form>
        )}
        {feedback && (
          <p
            role="status"
            className={`flag-feedback ${accepted ? "success-text" : "error-text"}`}
          >
            {feedback}
          </p>
        )}
      </section>
      <section
        className="challenge-conversation"
        aria-labelledby="conversation-title"
      >
        <div className="conversation-heading">
          <h2 id="conversation-title">Chat</h2>
          <button
            className="text-button"
            disabled={busy || !messages.length}
            onClick={() => setResetting(true)}
          >
            Reset conversation
          </button>
        </div>
        {challenge.turnLimit != null && (
          <p className="conversation-limit">
            {Math.max(0, challenge.turnLimit - usedTurns)} of{" "}
            {challenge.turnLimit} turns remaining
          </p>
        )}
        <div
          className="conversation-messages"
          role="log"
          aria-label="Conversation"
          aria-live="polite"
          aria-relevant="additions text"
        >
          {!messages.length && (
            <p className="conversation-empty">
              Start a conversation with the challenge assistant.
            </p>
          )}
          {messages.map((message) => (
            <article key={message.id} className={`message ${message.role}`}>
              <div className="message-meta">
                <b>{message.role === "assistant" ? "Assistant" : "You"}</b>
              </div>
              <div className="message-content">{message.content}</div>
              {message.role === "assistant" && (
                <CopyButton text={message.content} />
              )}
            </article>
          ))}
          {sending && (
            <>
              <article className="message user">
                <div className="message-meta">
                  <b>You</b>
                </div>
                <div className="message-content">{prompt.trim()}</div>
              </article>
              <p role="status" className="conversation-empty">
                Waiting for a response…
              </p>
            </>
          )}
          <div ref={end} />
        </div>
        {error && <ErrorNotice message={error} />}
        {exhausted && (
          <p className="notice">
            Turn limit reached. Reset this conversation to try again.
          </p>
        )}
        <PromptInputBox
          ref={composer}
          value={prompt}
          onValueChange={setPrompt}
          onSend={() => void send()}
          isLoading={sending}
          disabled={busy || exhausted}
          placeholder={
            exhausted
              ? "Reset to start a new conversation…"
              : "Type your message…"
          }
        />
        {isDemo && (
          <p className="composer-note">
            Frontend preview · responses are scripted.
          </p>
        )}
      </section>
      {resetting && (
        <Dialog
          title="Start this conversation again?"
          onClose={() => setResetting(false)}
        >
          <p>
            Messages for layer {String(id).padStart(2, "0")} will be cleared.
            Captured flags, points, and your other conversations are kept.
          </p>
          <div className="dialog-actions">
            <button
              className="button button-outline"
              onClick={() => setResetting(false)}
            >
              Keep conversation
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={async () => {
                try {
                  setSession(await transact(() => api.reset(id)));
                  setResetting(false);
                  setError("");
                  setPrompt("");
                  toast("Conversation reset. A fresh start.");
                } catch (e) {
                  setResetting(false);
                  setError((e as Error).message);
                }
              }}
            >
              Reset conversation
            </button>
          </div>
        </Dialog>
      )}
    </AnimatedPage>
  );
}
