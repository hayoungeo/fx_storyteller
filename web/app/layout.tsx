import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Exchange Signal | 근거 기반 환율 뉴스 AI",
  description: "뉴스, 거시 지표, 변동성 데이터를 사용자의 자산과 목적에 맞춰 설명합니다.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  openGraph: {
    title: "Exchange Signal",
    description: "내 자산과 목적에 맞춘 근거 기반 환율 뉴스 분석",
    type: "website",
    images: [{ url: "/og.png", width: 1736, height: 907, alt: "Exchange Signal — Evidence Before Opinion" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Exchange Signal",
    description: "내 자산과 목적에 맞춘 근거 기반 환율 뉴스 분석",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
