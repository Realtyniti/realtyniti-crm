import type { MetadataRoute } from "next";

/** Lets Android and iPhone install the CRM as an app ("Add to Home screen"). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "RealtyNiti CRM",
    short_name: "RealtyNiti",
    description: "Every RealtyNiti lead on one card.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0e1b33",
    theme_color: "#0e1b33",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Leads", url: "/leads", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Add a lead", url: "/leads/new", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
