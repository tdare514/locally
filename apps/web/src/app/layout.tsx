import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Locally",
  description:
    "Import local audio files, tag them, and organise them for Spotify's Local Files.",
  openGraph: {
    title: "Locally",
    description:
      "Import local audio files, tag them, and organise them for Spotify's Local Files.",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full" data-theme="dark">
      <body className="min-h-full h-full bg-[var(--bg)] text-[var(--text)] antialiased font-sans">
        {children}
      </body>
    </html>
  );
}
