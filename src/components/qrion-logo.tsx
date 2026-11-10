import Image from "next/image";

/**
 * Qrion wordmark. The artwork already contains both the mark and the lettering,
 * so the brand block is one image instead of an icon plus a text node.
 */
export function QrionLogo({ className = "brand__logo" }: { className?: string }) {
  return (
    <Image
      src="/qrion-logo2.png"
      alt="Qrion"
      width={1081}
      height={347}
      className={className}
      priority
    />
  );
}
