import {
  forwardRef,
  useLayoutEffect,
  useRef,
  useImperativeHandle,
} from "react";
import { ArrowUp, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface PromptInputBoxProps {
  value: string;
  onValueChange: (value: string) => void;
  onSend: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

// Text-chat adaptation of the supplied PromptInputBox. The event API accepts text.
export const PromptInputBox = forwardRef<
  HTMLTextAreaElement,
  PromptInputBoxProps
>(
  (
    {
      value,
      onValueChange,
      onSend,
      isLoading = false,
      disabled = false,
      placeholder = "Type your message…",
      className,
    },
    ref,
  ) => {
    const textarea = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(ref, () => {
      const element = textarea.current;
      if (!element) throw new Error("Prompt input is not mounted.");
      return element;
    });
    useLayoutEffect(() => {
      if (!textarea.current) return;
      textarea.current.style.height = "auto";
      textarea.current.style.height = `${Math.min(96, Math.max(48, textarea.current.scrollHeight))}px`;
    }, [value]);
    const blocked = disabled || isLoading;
    return (
      <form
        className={cn("ai-prompt-box", className)}
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim() && !blocked) onSend();
        }}
      >
        <textarea
          ref={textarea}
          aria-label="Message the challenge assistant"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={placeholder}
          maxLength={4000}
          disabled={blocked}
          rows={2}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="ai-prompt-actions">
          <span>Enter to send · Shift + Enter for a new line</span>
          <span className="prompt-count">{value.length} / 4000</span>
          <button
            type="submit"
            aria-label={isLoading ? "Sending message" : "Send message"}
            disabled={blocked || !value.trim()}
          >
            {isLoading ? (
              <LoaderCircle size={20} className="spin" />
            ) : (
              <ArrowUp size={20} />
            )}
          </button>
        </div>
      </form>
    );
  },
);
PromptInputBox.displayName = "PromptInputBox";
