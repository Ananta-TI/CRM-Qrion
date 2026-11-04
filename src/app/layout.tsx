import type { Metadata, Viewport } from "next";
import { Urbanist } from "next/font/google";
import "./globals.css";
import { HeaderProvider } from "@/components/header-context";
import { ToastProvider } from "@/components/toast";

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
    default: "Qrion — Customer Complaint CRM",
    template: "%s · Qrion",
  },
  description:
    "Platform penanganan keluhan pelanggan: triage otomatis, SLA, eskalasi L1–L3, dan basis pengetahuan resolusi.",
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

        <HeaderProvider>
          <ToastProvider>{children}</ToastProvider>
        </HeaderProvider>
      </body>
    </html>
  );
}
