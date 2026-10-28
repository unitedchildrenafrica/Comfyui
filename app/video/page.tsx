import { Suspense } from "react";
import { VideoForm } from "./VideoForm";

export default function VideoPage() {
  return (
    <Suspense>
      <VideoForm />
    </Suspense>
  );
}
