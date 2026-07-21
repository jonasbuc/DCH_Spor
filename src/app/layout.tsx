import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DcH Sporplanlægger",
  description: "Planlæg, tegn, validér og eksportér DcH B-spor på markarealer.",
  openGraph: {
    title: "DcH Sporplanlægger",
    description: "Matematisk sporplanlægning til DcH B-spor.",
    type: "website"
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="da">
      <body>{children}</body>
    </html>
  );
}
