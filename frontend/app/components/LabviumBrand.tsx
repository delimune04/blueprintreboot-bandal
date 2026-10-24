import "./labvium-brand.css";

const assetBase = process.env.NEXT_PUBLIC_BANDAL_DEMO === "1"
  ? (process.env.NEXT_PUBLIC_BANDAL_DEMO_BASE || "/LabVium").replace(/\/$/, "")
  : "";

export function LabviumBrand({ variant = "default" }: { variant?: "default" | "compact" | "hero" }) {
  return <span className={`labvium-brand labvium-brand--${variant}`}>
    {/* A fixed-size SVG symbol: next/image would not optimise it, and the static hosted build has no image loader. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img className="labvium-brand__symbol" src={`${assetBase}/brand/labvium-symbol-v2.svg`} width={48} height={48} alt="" draggable={false} />
    <span className="labvium-wordmark">LabVium</span>
  </span>;
}
