"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";

const platformPillars = [
  {
    label: "Renderer",
    value: "WebGPU-first",
    detail: "PlayCanvas Gaussian splat rendering with a quiet WebGL2 fallback path.",
  },
  {
    label: "Simulation",
    value: "WASD / Arrows",
    detail: "Human-scale walking, orbit look, and room-to-room jumps inside one full-screen simulation.",
  },
  {
    label: "Hardening",
    value: "Alpha-tuned",
    detail: "Noise clipping and splat coverage tuning for denser, calmer architectural reads.",
  },
  {
    label: "Delivery",
    value: "Export-ready",
    detail: "App Router build integrity, Git LFS asset handling, and static-export compatibility.",
  },
] as const;

const systemSheet = [
  {
    eyebrow: "Spatial Runtime",
    title: "A browser-native digital twin cockpit",
    body:
      "AetherView stages Gaussian splat scenes inside a premium HUD so the 3D content stays dominant while the interface remains accessible to architects, product teams, and stakeholders.",
  },
  {
    eyebrow: "Interaction Model",
    title: "Walk, orbit, then disappear the HUD.",
    body:
      "Preset room jumps provide curated vantage points, while WASD and arrow-key movement let a viewer inspect scale, circulation, and adjacency like a walk-through rather than a static render review. Zen Mode collapses the HUD when the scene needs your full attention.",
  },
  {
    eyebrow: "Rendering Policy",
    title: "Hardened for noisy scans",
    body:
      "Alpha clipping reduces smoky fringe artifacts, tuned splat scaling fills brittle wall gaps, and tighter update thresholds keep the scene cleaner during motion without abandoning the fallback path.",
  },
] as const;

const deploymentStrip = [
  "Next.js 14 App Router",
  "PlayCanvas GSplat",
  "Static export compatible",
  "Git LFS asset pipeline",
] as const;

export function AetherViewLanding(): JSX.Element {
  const shouldReduceMotion = useReducedMotion();

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#030303] text-white">
      <motion.div
        aria-hidden="true"
        className="absolute inset-[-12%] bg-[radial-gradient(circle_at_top,rgba(142,168,255,0.22),transparent_28%),radial-gradient(circle_at_82%_18%,rgba(212,190,152,0.14),transparent_18%),radial-gradient(circle_at_bottom,rgba(255,255,255,0.08),transparent_20%),linear-gradient(180deg,rgba(3,3,4,0.92),rgba(3,3,4,0.72))]"
        animate={
          shouldReduceMotion
            ? undefined
            : {
                scale: [1, 1.06, 1.02],
                x: ["0%", "-2%", "1%"],
                y: ["0%", "1.5%", "0%"],
              }
        }
        transition={
          shouldReduceMotion
            ? undefined
            : {
                duration: 18,
                repeat: Number.POSITIVE_INFINITY,
                repeatType: "mirror",
                ease: "easeInOut",
              }
        }
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,4,5,0.24),rgba(4,4,5,0.68))]" />

      <div className="relative z-10">
        <section className="mx-auto flex min-h-screen w-full max-w-[1400px] flex-col justify-center gap-14 px-6 py-12 lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16 lg:px-10">
          <motion.div
            initial={shouldReduceMotion ? false : { opacity: 0, y: 32, filter: "blur(14px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={
              shouldReduceMotion
                ? { duration: 0.01 }
                : { type: "spring", stiffness: 86, damping: 18, mass: 0.94 }
            }
            className="max-w-3xl self-center"
          >
            <div className="inline-flex rounded-full border border-white/10 bg-black/30 px-4 py-2 text-[0.68rem] uppercase tracking-[0.34em] text-[#8ea8ff] backdrop-blur-3xl">
              AetherView / Spatial Simulation
            </div>
            <h1 className="mt-6 text-balance text-[clamp(3.2rem,8vw,6.8rem)] font-semibold leading-[0.92] tracking-[-0.07em] text-white">
              Walk a digital twin like a premium spatial product.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-white/66">
              AetherView turns a Gaussian splat capture into a cinematic browser
              simulation with hardened rendering, room-to-room camera choreography,
              and a calm HUD built for presentation instead of engineering clutter.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/viewer"
                className="focus-ring inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.1] px-7 py-3 text-sm font-medium text-white transition-all duration-300 ease-out hover:scale-[1.02] hover:border-white/20 hover:bg-white/[0.14] hover:shadow-[0_24px_80px_rgba(0,0,0,0.35)]"
              >
                Begin Simulation
              </Link>
              <a
                href="#system-sheet"
                className="focus-ring inline-flex items-center justify-center rounded-full border border-white/10 bg-black/25 px-7 py-3 text-sm font-medium text-white/82 transition-all duration-300 ease-out hover:scale-[1.02] hover:border-[#8ea8ff]/30 hover:bg-white/[0.06]"
              >
                View Project One-Pager
              </a>
            </div>

            <div className="mt-10 flex flex-wrap gap-2">
              {deploymentStrip.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-white/10 bg-black/25 px-4 py-2 font-[family-name:var(--font-mono)] text-[0.7rem] uppercase tracking-[0.22em] text-white/52 backdrop-blur-3xl"
                >
                  {item}
                </span>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={shouldReduceMotion ? false : { opacity: 0, y: 26, scale: 0.98, filter: "blur(16px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            transition={
              shouldReduceMotion
                ? { duration: 0.01 }
                : { type: "spring", stiffness: 88, damping: 18, mass: 0.96, delay: 0.1 }
            }
            className="relative self-center"
          >
            <div className="glass-panel relative overflow-hidden rounded-[2rem] p-4">
              <div className="absolute inset-x-10 top-0 h-24 rounded-full bg-[radial-gradient(circle,rgba(142,168,255,0.18),transparent_70%)] blur-3xl" />
              <div className="relative rounded-[1.7rem] border border-white/8 bg-[linear-gradient(180deg,rgba(7,7,8,0.82),rgba(4,4,5,0.58))] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[0.68rem] uppercase tracking-[0.3em] text-white/40">
                      Launch frame
                    </p>
                    <p className="mt-2 text-lg tracking-[-0.04em] text-white">
                      Premium Spatial HUD
                    </p>
                  </div>
                  <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 font-[family-name:var(--font-mono)] text-[0.68rem] uppercase tracking-[0.24em] text-[#d4be98]">
                    /viewer
                  </span>
                </div>

                <div className="mt-4 overflow-hidden rounded-[1.5rem] border border-white/8">
                  <Image
                    src="/assets/viewpoints/kitchen-preview.svg"
                    alt="AetherView kitchen preview"
                    width={720}
                    height={460}
                    unoptimized
                    className="h-auto w-full object-cover"
                  />
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[1.3rem] border border-white/8 bg-white/[0.04] p-4">
                    <p className="text-[0.62rem] uppercase tracking-[0.28em] text-white/38">
                      Active mode
                    </p>
                    <p className="mt-3 font-[family-name:var(--font-mono)] text-base text-white">
                      WebGPU / fallback-safe
                    </p>
                  </div>
                  <div className="rounded-[1.3rem] border border-white/8 bg-white/[0.04] p-4">
                    <p className="text-[0.62rem] uppercase tracking-[0.28em] text-white/38">
                      Navigation
                    </p>
                    <p className="mt-3 font-[family-name:var(--font-mono)] text-base text-white">
                      WASD / Arrows / Zen
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </section>

        <section
          id="system-sheet"
          className="mx-auto w-full max-w-[1400px] px-6 pb-20 lg:px-10"
        >
          <div className="glass-panel rounded-[2.2rem] px-6 py-7 lg:px-8 lg:py-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <p className="text-[0.68rem] uppercase tracking-[0.34em] text-[#8ea8ff]">
                  Project One-Pager
                </p>
                <h2 className="mt-4 text-[clamp(2rem,4vw,3.6rem)] font-semibold leading-[0.96] tracking-[-0.05em] text-white">
                  WebGPU-first product engineering for spatial review.
                </h2>
              </div>
              <p className="max-w-xl text-sm leading-7 text-white/62">
                AetherView combines a production-safe Next.js shell, PlayCanvas GSplat
                rendering, Git LFS asset handling, and presentation-grade UI so one link
                can act as both technical proof and product demo.
              </p>
            </div>

            <div className="mt-8 grid gap-4 lg:grid-cols-3">
              {systemSheet.map((item) => (
                <article
                  key={item.title}
                  className="rounded-[1.7rem] border border-white/8 bg-white/[0.04] p-5"
                >
                  <p className="text-[0.62rem] uppercase tracking-[0.28em] text-[#d4be98]">
                    {item.eyebrow}
                  </p>
                  <h3 className="mt-3 text-2xl leading-tight tracking-[-0.04em] text-white">
                    {item.title}
                  </h3>
                  <p className="mt-4 text-sm leading-7 text-white/62">{item.body}</p>
                </article>
              ))}
            </div>

            <div className="mt-8 grid gap-4 lg:grid-cols-4">
              {platformPillars.map((pillar) => (
                <article
                  key={pillar.label}
                  className="rounded-[1.5rem] border border-white/8 bg-black/20 p-5"
                >
                  <p className="text-[0.62rem] uppercase tracking-[0.28em] text-white/36">
                    {pillar.label}
                  </p>
                  <p className="mt-3 font-[family-name:var(--font-mono)] text-base uppercase tracking-[0.16em] text-white">
                    {pillar.value}
                  </p>
                  <p className="mt-3 text-sm leading-7 text-white/60">
                    {pillar.detail}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
