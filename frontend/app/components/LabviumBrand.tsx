import "./labvium-brand.css";

const assetBase = process.env.NEXT_PUBLIC_BANDAL_DEMO === "1"
  ? (process.env.NEXT_PUBLIC_BANDAL_DEMO_BASE || "/ku-ai").replace(/\/$/, "")
  : "";

export function LabviumBrand({ variant = "default" }: { variant?: "default" | "compact" | "hero" }) {
  return <span className={`labvium-brand labvium-brand--${variant}`}>
    <img className="labvium-brand__symbol" src={`${assetBase}/brand/labvium-symbol-v1.png`} width={48} height={48} alt="" draggable={false} />
    <span className="labvium-wordmark">LabVium</span>
  </span>;
}
