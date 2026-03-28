import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { ThemeProvider } from "./features/theme/ThemeProvider.jsx";
import "./styles/tailwind.css";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <ThemeProvider>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </ThemeProvider>,
);
