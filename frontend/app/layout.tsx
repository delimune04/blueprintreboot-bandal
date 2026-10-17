import type { Metadata } from "next";
import { headers } from "next/headers";
import { AppShell } from "./components/AppShell";
import { LocaleProvider } from "./lib/i18n/LocaleProvider";
import { PRODUCT_NAME } from "./lib/i18n/catalog";
import "./globals.css";
import "./lib/continuity/continuity.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "127.0.0.1:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  const description = "논문 읽기, 근거 노트와 프로젝트를 연결하는 나의 연구 공간.";
  return {
    metadataBase: new URL(`${protocol}://${host}`),
    title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
    description,
    openGraph: { title: PRODUCT_NAME, description, images: [{ url: "/og-labvium.png", width: 1200, height: 630, alt: `${PRODUCT_NAME} 연구 공간` }] },
    twitter: { card: "summary_large_image", title: PRODUCT_NAME, description, images: ["/og-labvium.png"] },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">
        <LocaleProvider><AppShell>{children}</AppShell></LocaleProvider>
      </body>
    </html>
  );
}
