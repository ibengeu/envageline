import { createFileRoute } from "@tanstack/react-router";
import { ReaderApp } from "@/components/reader/reader-app";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return <ReaderApp />;
}
