import {
  defineConfig,
  minimal2023Preset,
} from "@vite-pwa/assets-generator/config";

// The source art is full-bleed, so the maskable and Apple icons are filled with
// the same blue instead of the preset's white padding (iOS rounds corners itself).
const BACKGROUND = "#0b5cc2";

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: {
      ...minimal2023Preset.maskable,
      resizeOptions: { background: BACKGROUND, fit: "contain" },
      padding: 0.1,
    },
    apple: {
      ...minimal2023Preset.apple,
      resizeOptions: { background: BACKGROUND, fit: "contain" },
      padding: 0,
    },
  },
  images: ["public/icon.svg"],
});
