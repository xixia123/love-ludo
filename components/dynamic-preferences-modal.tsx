"use client";

import dynamic from "next/dynamic";

const PreferencesModal = dynamic(
  () => import("@/components/profile/preferences-modal"),
  { ssr: false }
);

export default function DynamicPreferencesModal() {
  return <PreferencesModal />;
}
