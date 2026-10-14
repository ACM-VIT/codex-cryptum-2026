import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "./App";
import "@fontsource/big-shoulders-display/latin-500";
import "@fontsource/big-shoulders-display/latin-600";
import "@fontsource/big-shoulders-display/latin-700";
import "@fontsource/big-shoulders-display/latin-800";
import "@fontsource/big-shoulders-display/latin-900";
import "@fontsource/fraunces/latin-400";
import "@fontsource/fraunces/latin-400-italic";
import "@fontsource/spline-sans-mono/latin-400";
import "@fontsource/spline-sans-mono/latin-500";
import "@fontsource/spline-sans-mono/latin-600";
import "@fontsource/spline-sans-mono/latin-700";
import "./tailwind.css";
import "./styles.css";
import "./cryptum.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
