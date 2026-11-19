import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import AdminPage from "./components/AdminPage";
import "./styles/tokens.css";
import "./styles/app.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    {window.location.pathname === "/admin" ? <AdminPage /> : <App />}
  </StrictMode>,
);
