import { StrictMode } from "react";
import "./lib/compat";
import { createRoot } from "react-dom/client";
import App from "./App";
import AdminPage from "./components/AdminPage";
import "./styles/tokens.css";
import "./styles/app.css";

import ErrorBoundary from "./components/ErrorBoundary";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary>
      {window.location.pathname === "/admin" ? <AdminPage /> : <App />}
    </ErrorBoundary>
  </StrictMode>,
);
