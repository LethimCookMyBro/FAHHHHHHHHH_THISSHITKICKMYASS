import api, { retryApiRequest } from "../utils/api";

export const chatService = {
  async fetchProfileAndSessions() {
    return Promise.all([
      retryApiRequest(() => api.get("/api/auth/me"), {
        retries: 2,
        baseDelayMs: 550,
      }),
      retryApiRequest(() => api.get("/api/chat/sessions"), {
        retries: 2,
        baseDelayMs: 550,
      }),
    ]);
  },

  async fetchFallbackSessions() {
    return retryApiRequest(() => api.get("/api/chat/sessions"), {
      retries: 1,
      baseDelayMs: 500,
    });
  },

  async fetchSessionMessages(sessionId) {
    return retryApiRequest(() => api.get(`/api/chat/sessions/${sessionId}`), {
      retries: 1,
      baseDelayMs: 500,
    });
  },

  async sendMessage(message, sessionId) {
    return retryApiRequest(
      () =>
        api.post("/api/chat", {
          message,
          session_id: sessionId,
        }),
      {
        retries: 0,
        baseDelayMs: 650,
      },
    );
  },

  async deleteSession(sessionId) {
    return api.delete(`/api/chat/sessions/${sessionId}`);
  },

  async getSourceDocument(source) {
    return api.get(`/api/chat/sources/${encodeURIComponent(source)}`, {
      responseType: "blob",
    });
  },
};
