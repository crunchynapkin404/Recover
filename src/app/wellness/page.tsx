import { redirect } from "next/navigation";

// Wellness logging is now handled by /journal
// Keep this route alive so old bookmarks redirect
export default function WellnessPage() {
  redirect("/journal");
}
