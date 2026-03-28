/**
 * Custom hook for voice recording and transcription
 * Extracts voice recording logic from Chat component
 */

import { useState, useRef } from "react";
import { chatAPI, getApiErrorMessage } from "../utils/api";
import { useT } from "../utils/i18n";

const STT_HINT_PROMPT =
  "Industrial automation troubleshooting. Mitsubishi PLC, CC-Link IE Field Network, Modbus TCP, inverter, servo, ladder logic, alarm code, communication timeout, parameter error, safety gate, register R100 and R102, GX Works.";

export function useVoiceRecording(onTranscriptionComplete, language = "en") {
  const { t } = useT();
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const abortControllerRef = useRef(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const mimeTypeCandidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
      ];
      const supportedMimeType = mimeTypeCandidates.find(
        (value) =>
          typeof MediaRecorder.isTypeSupported === "function" &&
          MediaRecorder.isTypeSupported(value),
      );

      const mediaRecorder = new MediaRecorder(stream, {
        ...(supportedMimeType ? { mimeType: supportedMimeType } : {}),
        audioBitsPerSecond: 128000,
      });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setIsTranscribing(true);
        const resolvedMimeType = mediaRecorder.mimeType || "audio/webm";
        const audioBlob = new Blob(audioChunksRef.current, {
          type: resolvedMimeType,
        });

        abortControllerRef.current = new AbortController();

        try {
          const res = await chatAPI.transcribe(
            audioBlob,
            abortControllerRef.current.signal,
            language,
            STT_HINT_PROMPT,
          );
          if (res.data.text) {
            onTranscriptionComplete?.(res.data.text);
          }
        } catch (error) {
          if (error.name !== "CanceledError" && error.message !== "canceled") {
            console.error("Transcription error:", error);
            alert(
              getApiErrorMessage(
                error,
                t("chat.transcriptionFailed"),
              ),
            );
          }
        } finally {
          setIsTranscribing(false);
          abortControllerRef.current = null;
        }

        // Stop all tracks
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error("Microphone access error:", error);
      alert(t("chat.microphoneAccessFailed"));
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const cancelTranscription = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsTranscribing(false);
    }
  };

  return {
    isRecording,
    isTranscribing,
    startRecording,
    stopRecording,
    cancelTranscription,
  };
}

export default useVoiceRecording;
