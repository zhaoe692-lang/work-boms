import React from "react";
import ReactDOM from "react-dom/client";
import "./tailwind.css";
import App from "./App";
import { WorldTreeGraph3D } from "./components/WorldTreeGraph3D";
import { I18nProvider } from "./shared/i18n";

const isWorldTreePrototype = new URLSearchParams(window.location.search).has("world-tree");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      {isWorldTreePrototype ? (
        <main className="world-tree-prototype-page">
          <WorldTreeGraph3D prototype />
        </main>
      ) : (
        <App />
      )}
    </I18nProvider>
  </React.StrictMode>,
);
