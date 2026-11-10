"use client";

import Aurora from "@/components/aurora";

/**
 * Animated backdrop for the auth screens: two slow aurora layers of brand
 * colour — iris light falling across the top, a mint glow rising from the
 * bottom — that both drift toward the pointer.
 *
 * `lightMode` turns them into soft tints over the paper white instead of an
 * additive glow, and `dpr` is capped at 1. This is atmosphere behind a login
 * form, not a hero: keep the opacities low so the copy keeps its contrast.
 */
export function AuthBackdrop() {
  return (
    <div className="auth__backdrop" aria-hidden="true">
      <div className="auth__backdrop__layer">
        <Aurora
          colorStops={["#a99bf8", "#5b49c8", "#4a3fa0"]}
          /* Golden section of the viewport height: the iris light falls to
             exactly 38.2% down the page. */
          height={0.382}
          amplitude={1.1}
          blend={0.65}
          glow={0.6}
          brightness={1}
          layers={2}
          scale={1.05}
          speed={0.45}
          opacity={0.62}
          mouseInteraction
          lightMode
          dpr={1}
        />
      </div>
      <div className="auth__backdrop__layer auth__backdrop__layer--low">
        <Aurora
          colorStops={["#51c590", "#7cc9a8", "#5b49c8"]}
          direction="bottom"
          /* The mint mirror of the same section, rising from the bottom. */
          height={0.236}
          amplitude={0.8}
          blend={0.5}
          glow={0.35}
          brightness={1}
          layers={1}
          scale={1.2}
          speed={0.32}
          opacity={0.34}
          mouseInteraction={false}
          lightMode
          dpr={1}
        />
      </div>
    </div>
  );
}
