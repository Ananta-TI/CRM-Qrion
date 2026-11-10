import type { Metadata, Viewport } from "next";
import { Urbanist } from "next/font/google";
import "./globals.css";
import { HeaderProvider } from "@/components/header-context";

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

/** The design system specifies Urbanist, variable weight. */
const urbanist = Urbanist({
  variable: "--font-urbanist",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Qrion — Internal Complaint CRM",
    template: "%s · Qrion",
  },
  description:
    "Platform penanganan keluhan internal: triage otomatis, SLA, dan penugasan ke programmer.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id" className={urbanist.variable} data-scroll-behavior="smooth">
      <body>
        {/* Decorative background: three blurred radial blobs. */}
        <div className="mesh" aria-hidden="true">
          <i className="mesh__a" />
          <i className="mesh__b" />
          <i className="mesh__c" />
        </div>

        <a className="skip" href="#main">
          Lewati ke konten
        </a>

        <HeaderProvider>{children}</HeaderProvider>
      </body>
    </html>
  );
}
