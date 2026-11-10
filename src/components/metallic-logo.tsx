"use client";

import { useSyncExternalStore } from "react";

import MetallicPaint from "@/components/metallic-paint";

/**
 * Spun-metal Qrion mark for the purple auth panel.
 *
 * The shader costs a WebGL context, a 1k texture and a one-off Poisson solve,
 * and the panel stacks away below 941px — so the effect only mounts when there
 * is a desktop-sized viewport to show it in.
 */
const QUERY = "(min-width: 941px)";

const subscribe = (onChange: () => void) => {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};
const getSnapshot = () => window.matchMedia(QUERY).matches;
const getServerSnapshot = () => false;

export function MetallicLogo() {
  const enabled = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (!enabled) return null;

  return (
    <MetallicPaint
      imageSrc="/icon.png"
      color="#ffffff"
      density={2.6}
      softness={0.46}
      dispersion={1}
      distortion={0.12}
      edgeBend={0.29}
      angle={55}
      scale={1}
      speed={0.65}
      rotation={0}
      mouseTilt={0.2}
      intro
    />
  );
}
