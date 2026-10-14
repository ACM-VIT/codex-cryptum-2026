import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
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
import { api } from "../lib/api";
import { SandboxLeaderboard } from "../components/sandbox-leaderboard";

export function Arena() {
  const { id } = useParams<{ id: string }>();
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
        <Link className="button" href="/arena">
          Explore the ten layers <ArrowUpRight size={16} />
        </Link>
      </div>
    );
  const sandbox = challenge.interaction === "sandbox";
  const flagCompletion = challenge.completionMethod === "flag";
  const send = async () => {
    if (sandbox || !prompt.trim() || busy || exhausted) return;
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
    if (!flagCompletion || !flag.trim() || busy) return;
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
        <Link className="challenge-back" href="/arena">
          <ArrowLeft size={16} /> Back to challenges
        </Link>
        <Link
          className="challenge-close icon-button"
          href="/arena"
          aria-label="Close challenge and return to challenges"
        >
          <X size={22} />
        </Link>
      </div>
      <section className="challenge-overview" aria-labelledby="challenge-title">
        <h1 id="challenge-title">{challenge.title}</h1>
        <p className="challenge-description">{challenge.description}</p>
        <div className="challenge-badges" aria-label="Challenge mode and status">
          <span className="difficulty">{sandbox ? "Application sandbox" : "Prompt injection"}</span>
          <span className="difficulty">{flagCompletion ? "Submit a flag" : "Verify an exploit"}</span>
          <span className="difficulty">{challenge.difficulty}</span>
          {session.solved.includes(id) && <span className="difficulty difficulty-intro">Completed</span>}
        </div>
        <ol className="challenge-steps" aria-label="How to complete this challenge">
          {sandbox ? (
            <>
              <li><strong>Inspect the board.</strong> Review the isolated sandbox teams, IDs, and scores below.</li>
              <li><strong>Edit another sandbox team’s score.</strong> Select its row, choose a score that puts it first, and apply the sandbox PATCH.</li>
              <li><strong>Verify completion.</strong> Check the exploit to earn points. No chat or flag is needed; official standings cannot be edited here.</li>
            </>
          ) : (
            <>
              <li><strong>Send a prompt.</strong> Test the assistant’s defenses in the conversation below.</li>
              <li><strong>Inspect the response.</strong> Look for the flag and refine your approach if it stays protected.</li>
              <li><strong>Submit the flag.</strong> Choose Enter flag and paste the recovered value to verify your solve.</li>
            </>
          )}
        </ol>
        <div className="challenge-overview-actions">
          <span className="challenge-points">{challenge.points} points</span>
          {flagCompletion && <button
            type="button"
            className="button button-outline"
            aria-expanded={flagOpen}
            aria-controls="flag-entry"
            onClick={() => setFlagOpen((open) => !open)}
          >
            {flagOpen ? "Cancel" : "Enter flag"}
          </button>}
        </div>
        {flagCompletion && flagOpen && (
          <form
            className="challenge-flag-form"
            id="flag-entry"
            onSubmit={submit}
          >
            <label htmlFor="flag">Flag</label>
            <Input
              size="lg"
              id="flag"
              value={flag}
              onChange={(event) => setFlag(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              maxLength={512}
              placeholder="Paste your flag"
            />
            <button className="button" disabled={!flag.trim() || busy}>
              {submitting ? "Verifying…" : "Submit flag"}
            </button>
          </form>
        )}
        {feedback && (
          <output className={`flag-feedback ${accepted ? "success-text" : "error-text"}`}>
            {feedback}
          </output>
        )}
      </section>
      {sandbox ? <SandboxLeaderboard showOrganizerTools={false} /> : <section
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
              Send your first prompt, then inspect the assistant’s response for a flag.
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
              <output className="conversation-empty">
                Waiting for a response…
              </output>
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
      </section>}
      {!sandbox && resetting && (
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
