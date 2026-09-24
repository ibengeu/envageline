import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { AuthProvider } from "@/lib/auth/provider";
import { HOSTED_NARRATION } from "@/reader/speech/kokoro-endpoint";
import appCss from "../styles.css?url";

const APP_NAME = "Evangeline";
// The App Builder platform serves /__grok/*; a self-hosted build does not.
const PLATFORM_CHROME = import.meta.env.VITE_PLATFORM_CHROME !== "false";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      {
        name: "description",
        content: HOSTED_NARRATION
          ? "Listen to any PDF, read aloud with the words highlighted as they are spoken."
          : "Listen to any PDF. An on-device audible reader with highlighting.",
      },
      { name: "theme-color", content: "#0c0c0d" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&display=swap",
      },
      { rel: "stylesheet", href: appCss },
      ...(PLATFORM_CHROME
        ? [
            { rel: "manifest", href: "/__grok/manifest.webmanifest" },
            { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
          ]
        : []),
    ],
  }),
  component: () => (
    <html lang="en" className="antialiased" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="bg-bg text-fg">
        <PreviewHostBridge />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
