import { memo } from "react";
import { LoaderCircle, Mic, MicOff, Send } from "lucide-react";

function ChatComposer({
  centered = false,
  input,
  inputRef,
  onInputChange,
  onKeyDown,
  onSubmit,
  isLoading,
  isRecording,
  isTranscribing,
  startRecording,
  stopRecording,
  cancelTranscription,
}) {
  return (
    <form
      onSubmit={onSubmit}
      className={`chat-composer-form ${centered ? "max-w-[920px]" : ""}`}
    >
      <div className="chat-composer-shell glass-panel-strong glass-noise">
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            isRecording
              ? "Listening..."
              : isTranscribing
                ? "Transcribing..."
                : "Ask about PLC diagnostics, alarm root cause, or recovery actions..."
          }
          className="composer-textarea"
          disabled={isLoading || isRecording || isTranscribing}
        />

        <div className="chat-composer-actions">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (isTranscribing) cancelTranscription();
              else if (isRecording) stopRecording();
              else startRecording();
            }}
            disabled={isLoading}
            className={`chat-icon-btn glass-interactive ${isRecording ? "recording" : ""}`}
            title={
              isTranscribing
                ? "Cancel transcription"
                : isRecording
                  ? "Stop recording"
                  : "Start voice input"
            }
          >
            {isTranscribing ? (
              <LoaderCircle size={17} className="animate-spin" />
            ) : isRecording ? (
              <MicOff size={17} />
            ) : (
              <Mic size={17} />
            )}
          </button>

          <button
            type="submit"
            disabled={
              isLoading || !input.trim() || isRecording || isTranscribing
            }
            className="chat-send-btn glass-interactive"
            title="Send"
          >
            {isLoading ? (
              <LoaderCircle size={17} className="animate-spin" />
            ) : (
              <Send
                size={16}
                className={input.trim() ? "translate-x-[1px]" : ""}
              />
            )}
          </button>
        </div>
      </div>
    </form>
  );
}

export default memo(ChatComposer);
