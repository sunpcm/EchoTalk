import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthGate } from "@/components/auth/AuthGate";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <AuthGate>
    <App />
  </AuthGate>,
);
