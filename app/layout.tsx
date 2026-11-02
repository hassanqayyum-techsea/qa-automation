import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

// Odyssey's theme reads --font-geist but doesn't load the font itself.
const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Repo Pulse", template: "%s · Repo Pulse" },
  description: "Read-only GitHub analytics and live browser tests",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

// Applies Odyssey's dark-mode class before first paint and follows OS changes.
const themeScript = `(()=>{const m=matchMedia("(prefers-color-scheme: dark)");const s=()=>document.documentElement.classList.toggle("dark-mode",m.matches);s();m.addEventListener("change",s)})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geist.variable} antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="bg-primary">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
