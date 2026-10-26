import { NewLeadForm } from "./form";

export default function NewLeadPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Add a lead</h1>
      <NewLeadForm />
    </div>
  );
}
