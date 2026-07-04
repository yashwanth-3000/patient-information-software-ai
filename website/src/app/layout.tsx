import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "patient-information-software-ai | Care stays human",
  description:
    "A safety-first AI assistant for repetitive patient information workflows.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
