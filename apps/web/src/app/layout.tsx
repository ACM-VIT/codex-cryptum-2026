import type { Metadata } from "next";
import { App } from "../App";
import "../fonts.css";
import "@fontsource/fraunces/latin-400.css";
import "@fontsource/fraunces/latin-400-italic.css";
import "@fontsource/spline-sans-mono/latin-400.css";
import "@fontsource/spline-sans-mono/latin-500.css";
import "@fontsource/spline-sans-mono/latin-600.css";
import "@fontsource/spline-sans-mono/latin-700.css";
import "../tailwind.css";
import "../styles.css";
import "../cryptum.css";

export const metadata: Metadata = {
  title: "Codex Cryptum",
  description: "Ten layers. Ten flags. An LLM capture-the-flag arena.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><div id="root"><App>{children}</App></div></body></html>;
}
