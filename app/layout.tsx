import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "contras.fun — CS2 Inventory Viewer",
  description: "Connect through official Steam OpenID, view your CS2 inventory, browse the public catalog, and submit manual sale requests.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
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
