import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Bun QR Code Scanner",
  description: "QR Code scanner powered by Next.js and Bun",
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
