import { memo } from "react";
import { LoaderCircle, Mic, MicOff, Send } from "lucide-react";
import { useT } from "../../utils/i18n";

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
  const { t } = useT();

  return (
    <form
      onSubmit={onSubmit}
      className={`chat-composer-form ${centered ? "is-centered" : ""}`}
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
              ? t("chat.listening")
              : isTranscribing
                ? t("chat.transcribing")
                : t("chat.composerPlaceholder")
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
            className={`chat-icon-btn chat-voice-btn glass-interactive ${isRecording ? "recording" : ""}`}
            title={
              isTranscribing
                ? t("chat.cancelTranscription")
                : isRecording
                  ? t("chat.stopRecording")
                  : t("chat.startVoiceInput")
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
            title={t("chat.send")}
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
