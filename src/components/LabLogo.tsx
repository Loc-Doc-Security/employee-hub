import { LOGO_SRC, PRODUCT_NAME } from "../lib/brand";

export default function LabLogo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const dim = size === "lg" ? "h-14" : size === "sm" ? "h-8" : "h-10";
  return <img src={LOGO_SRC} alt={PRODUCT_NAME} className={`${dim} w-auto object-contain`} />;
}