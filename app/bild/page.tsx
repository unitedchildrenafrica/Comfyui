import { Suspense } from "react";
import { ImageForm } from "./ImageForm";

export default function BildPage() {
  return (
    <Suspense>
      <ImageForm />
    </Suspense>
  );
}
